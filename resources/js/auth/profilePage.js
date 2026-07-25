/**
 * Componente Alpine de la página de perfil (ADR 0002, ADR 0004, ADR 0007, ADR 0009).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/profile.blade.php`: nada de `wire:model`
 * (ADR 0002), los campos se leen por `x-ref` y las URL llegan por `data-*` del formulario. Aquí no
 * hay ninguna llamada a Livewire: los ajustes suben ya cifrados a `PUT /phr/settings` y el cambio de
 * contraseña habla directamente con las rutas de `/phr/auth/password/*`.
 *
 * Dos operaciones, dos botones y dos peticiones, deliberadamente separadas:
 *
 * * **Ajustes.** Idioma, unidad preferida y rango objetivo se guardan juntos, en una sola petición,
 *   porque el sobre cifrado es un documento único que se reemplaza entero (el servidor no puede
 *   parchear lo que no puede descifrar). El idioma viaja en claro en la misma petición para que no
 *   pueda quedar desincronizado con el resto.
 * * **Contraseña.** Es un re-registro OPAQUE completo con dos estiramientos de clave y una escritura
 *   transaccional. No comparte botón ni estado con los ajustes: mezclarlos haría que un error de
 *   validación de un rango abortase un cambio de contraseña ya a medias.
 *
 * **El rango objetivo empieza vacío y sin valor sugerido** (ADR 0007). Ni este módulo ni la
 * plantilla proponen números: un rango por defecto es una indicación clínica.
 *
 * Las funciones exportadas antes de `profilePage()` son la lógica pura, para poder probarlas sin
 * montar Alpine (`tests/js/profilePage.test.mjs`).
 */

import { parseNumericValue } from '../health/numericValue.js';
import { t } from '../i18n/index.js';
import { isUnlocked, ownerId } from './keyring.js';
import { AuthRequestError } from './http.js';
import { KEY_STRETCHING_SECONDS, progressMixin } from './progress.js';
import { SESSION_READY_EVENT } from './sessionBootstrap.js';
import { saveSettings, settings } from './settings.js';
import { changePassword } from './changePasswordPage.js';

/*
 * `saveSettings` y `changePassword` se importaban con `import()` dentro de cada manejador. Los dos
 * motivos que lo justificaban ya no valen: los ficheros existen —no los está escribiendo nadie en
 * paralelo— y no diferían ni un byte. `settings.js` lo importan de forma estática `lock.js`,
 * `loginPage.js`, `recovery.js` y `setPasswordPage.js`, así que Vite avisaba con
 * `[INEFFECTIVE_DYNAMIC_IMPORT]` y lo dejaba donde estaba; y `changePasswordPage-*.js` se compilaba
 * a 0.02 kB con un único `import "./app-*.js"` dentro, es decir el WebAssembly de OPAQUE ya viajaba
 * en el bundle principal. Lo único que quedaba era mover el fallo de carga del módulo del arranque
 * al clic del usuario, sin ahorrar nada.
 */

/** Unidad marcada de entrada cuando no hay preferencia guardada (la misma que `glucosePage.js`). */
const DEFAULT_UNIT = 'mg/dL';

/** Unidades válidas, en los códigos UCUM de `App\Catalog\UcumUnit`. */
const UNITS = Object.freeze(['mg/dL', 'mmol/L']);

/**
 * Valida y normaliza el rango objetivo de glucemia tal cual se teclea en el formulario.
 *
 * Los dos límites en blanco significan «no configurado», que es un estado legítimo y el de partida
 * de toda cuenta (ADR 0007): devuelve `null`, y quien llama lo traduce a borrar la clave del sobre.
 * Un solo límite relleno es un error del formulario y nunca un rango a medias: un rango con un
 * extremo inventado es una indicación clínica falsa.
 *
 * El límite de 2 decimales y la coma decimal los resuelve `parseNumericValue`, la misma función que
 * usan las pantallas de evento, para no tener dos criterios de qué es un número.
 *
 * @param {object} params
 * @param {string} params.lowRaw Valor crudo del `<input type="number">` del límite inferior.
 * @param {string} params.highRaw Valor crudo del límite superior.
 * @param {string} params.unit Código UCUM de la unidad en la que están escritos los dos límites.
 * @returns {{low: number, high: number, unit: string}|null} `null` si no hay rango configurado.
 * @throws {Error} Con mensaje en el idioma activo si el rango está a medias, desordenado o no es numérico.
 */
export function parseGlucoseTargetRange({ lowRaw, highRaw, unit }) {
    const low = parseNumericValue(String(lowRaw ?? '').trim(), t('field.rangeLow'));
    const high = parseNumericValue(String(highRaw ?? '').trim(), t('field.rangeHigh'));

    if (low === '' && high === '') {
        return null;
    }

    if (low === '' || high === '') {
        throw new Error(t('profile.error.rangeIncomplete'));
    }

    if (!UNITS.includes(unit)) {
        throw new Error(t('profile.error.rangeUnit'));
    }

    const lowNumber = Number(low);
    const highNumber = Number(high);

    if (lowNumber <= 0 || highNumber <= 0) {
        throw new Error(t('profile.error.rangeZero'));
    }

    if (lowNumber >= highNumber) {
        throw new Error(t('profile.error.rangeOrder'));
    }

    /**
     * El rango guarda su propia unidad: `{low: 70, high: 180}` a secas es ambiguo, y en cuanto la
     * unidad de presentación cambia se vuelve peligroso. Como no se convierte entre unidades (ADR
     * 0007), quien lo lea compara la unidad y, si no coincide, no calcula el porcentaje.
     */
    return { low: lowNumber, high: highNumber, unit };
}

/**
 * Construye el parche que se mezcla sobre los ajustes en memoria antes de sellarlos.
 *
 * Una clave con valor `null` **borra** esa clave del documento, que es como se deja de tener rango
 * objetivo. Nunca se escribe un objeto vacío ni un `null` como marcador de «sin configurar»: la
 * ausencia de la clave ya es ese estado (ADR 0007).
 *
 * @param {object} params
 * @param {string} params.glucoseUnit Código UCUM de la unidad preferida.
 * @param {string} params.lowRaw
 * @param {string} params.highRaw
 * @param {string} params.rangeUnit
 * @returns {{glucoseUnit: string, glucoseTargetRange: {low: number, high: number, unit: string}|null}}
 * @throws {Error} Con mensaje en el idioma activo si algún campo no vale.
 */
export function buildSettingsPatch({ glucoseUnit, lowRaw, highRaw, rangeUnit }) {
    if (!UNITS.includes(glucoseUnit)) {
        throw new Error(t('profile.error.unit'));
    }

    return {
        glucoseUnit,
        glucoseTargetRange: parseGlucoseTargetRange({ lowRaw, highRaw, unit: rangeUnit }),
    };
}

/**
 * Traduce un fallo al mensaje que ve la persona. Nunca detalle técnico.
 *
 * @param {unknown} failure
 * @param {string} fallback
 * @returns {string}
 */
function describe(failure, fallback) {
    if (failure instanceof AuthRequestError) {
        if (failure.status === null) {
            return t('common.network');
        }

        if (failure.status === 412 || failure.status === 428) {
            return t('profile.error.conflict');
        }

        if (failure.status === 401) {
            return t('changePassword.error.currentPassword');
        }

        if (failure.status === 409) {
            return t('profile.error.passwordExpired');
        }

        return fallback;
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return fallback;
}

/**
 * Factoría del componente Alpine. Se registra como `phrProfilePage`.
 *
 * @returns {object}
 */
export function profilePage() {
    return {
        ...progressMixin(),

        /** Cambio de contraseña en marcha. La barra de progreso se muestra con esta bandera. */
        busy: false,

        savingSettings: false,
        settingsError: '',
        settingsSaved: false,
        passwordError: '',
        passwordChanged: false,

        /** Idioma con el que se pintó la página, para saber si hay que recargar tras guardar. */
        initialLocale: '',

        init() {
            this.initialLocale = this.$refs.locale.value;

            if (isUnlocked()) {
                this.fillFromSettings();

                return;
            }

            /**
             * Los ajustes viven descifrados en memoria y llegan al terminar el arranque de sesión
             * (§6.2). Hasta entonces los campos se quedan como los pintó el servidor, que para la
             * unidad y el rango es «vacío», nunca un valor inventado.
             */
            document.addEventListener(SESSION_READY_EVENT, () => this.fillFromSettings(), { once: true });
        },

        /**
         * Vuelca en el formulario los ajustes descifrados. Lo que no está configurado se queda en
         * blanco: rellenar el rango con cualquier cosa sería inventarse una indicación clínica.
         */
        fillFromSettings() {
            const current = settings() ?? {};

            this.$refs.glucoseUnit.value = current.glucoseUnit ?? DEFAULT_UNIT;

            const range = current.glucoseTargetRange ?? null;

            this.$refs.rangeLow.value = range === null ? '' : String(range.low);
            this.$refs.rangeHigh.value = range === null ? '' : String(range.high);
            this.$refs.rangeUnit.value = range?.unit ?? this.$refs.glucoseUnit.value;
        },

        /** Guarda las tres secciones de ajustes en una única petición. */
        async submitSettings() {
            if (this.savingSettings) {
                return;
            }

            this.savingSettings = true;
            this.settingsError = '';
            this.settingsSaved = false;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new Error(t('common.locked.settings'));
                }

                const patch = buildSettingsPatch({
                    glucoseUnit: this.$refs.glucoseUnit.value,
                    lowRaw: this.$refs.rangeLow.value,
                    highRaw: this.$refs.rangeHigh.value,
                    rangeUnit: this.$refs.rangeUnit.value,
                });

                const locale = this.$refs.locale.value;

                await saveSettings({
                    patch,
                    userId,
                    locale,
                    url: this.$refs.settingsForm.dataset.settingsUrl,
                });

                this.settingsSaved = true;

                /**
                 * El marco de Filament (menú, migas, títulos) ya está pintado en el idioma
                 * anterior y lo resuelve el servidor, así que un cambio de idioma solo se ve
                 * entero recargando. Se hace después del 2xx, nunca antes.
                 */
                if (locale !== this.initialLocale) {
                    window.location.reload();
                }
            } catch (failure) {
                this.settingsError = describe(failure, t('profile.error.settingsGeneric'));
            } finally {
                this.savingSettings = false;
            }
        },

        /**
         * Cambia la contraseña: reautenticación con la actual, re-registro OPAQUE con la nueva y
         * reenvoltura de la clave maestra, todo en `changePassword`.
         *
         * Aquí solo se leen los campos, se vacían en el acto y se pinta el progreso. Las tres
         * contraseñas no pasan por el estado de Alpine: viven en variables locales de esta función
         * y se sueltan al terminar.
         */
        async submitPassword() {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.passwordError = '';
            this.passwordChanged = false;
            this.resetProgress();

            let currentPassword = this.$refs.currentPassword.value;
            let newPassword = this.$refs.newPassword.value;
            const confirmation = this.$refs.newPasswordConfirmation.value;

            this.$refs.currentPassword.value = '';
            this.$refs.newPassword.value = '';
            this.$refs.newPasswordConfirmation.value = '';

            try {
                if (currentPassword === '' || newPassword === '') {
                    throw new Error(t('changePassword.error.empty'));
                }

                if (newPassword !== confirmation) {
                    throw new Error(t('changePassword.error.mismatch'));
                }

                await this.advance(t('stage.preparing'), 0.05);

                await changePassword({
                    currentPassword,
                    newPassword,
                    urls: { ...this.$refs.passwordForm.dataset },
                    onStage: (stage) => this.announce(stage),
                });

                await this.advance(t('stage.done'), 1);

                this.passwordChanged = true;
            } catch (failure) {
                this.passwordError = describe(failure, t('profile.error.passwordGeneric'));
                this.resetProgress();
            } finally {
                currentPassword = '';
                newPassword = '';
                this.busy = false;
            }
        },

        /**
         * Pinta una etapa del cambio de contraseña. Los dos tramos de Argon2id se anuncian por
         * separado y con su duración estimada: si la barra los tratara como uno solo, la persona
         * vería la misma pausa dos veces sin explicación y volvería a pulsar el botón.
         *
         * @param {string} stage Nombre de etapa que emite `changePassword`.
         * @returns {Promise<void>}
         */
        announce(stage) {
            const plan = {
                reauth: [t('profile.stage.reauth'), 0.3, KEY_STRETCHING_SECONDS],
                opening: [t('profile.stage.opening'), 0.4],
                stretching: [t('profile.stage.stretching'), 0.75, KEY_STRETCHING_SECONDS],
                wrapping: [t('profile.stage.wrapping'), 0.85],
                saving: [t('stage.saving'), 0.95],
            }[stage];

            if (plan === undefined) {
                return Promise.resolve();
            }

            return this.advance(...plan);
        },
    };
}
