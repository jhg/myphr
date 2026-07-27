/**
 * Componente Alpine de la página de perfil (ADR 0002, ADR 0004, ADR 0007, ADR 0009).
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/profile.blade.php`: nada de `wire:model`
 * (ADR 0002), los campos se leen por `x-ref` y las URL llegan por `data-*` del formulario. Aquí no
 * hay ninguna llamada a Livewire: los ajustes suben ya cifrados a `PUT /phr/settings` y el cambio de
 * contraseña habla directamente con las rutas de `/phr/auth/password/*`.
 *
 * Además hay un bloque de **solo lectura** con las últimas medidas corporales (peso, estatura e
 * índice de masa corporal). No es un ajuste y por eso no tiene campos ni botón: esas medidas se
 * registran en la pantalla de peso y estatura, con su fecha, y ahí es donde se corrigen. Se calculan
 * aquí, en el navegador, descifrando los eventos que baja `$wire.fetchEvents` —la única llamada a
 * Livewire de este módulo—, porque el servidor no puede leerlas (ADR 0002, ADR 0004). El IMC se
 * enseña como cifra desnuda, sin categorías ni colores: el porqué clínico está en el JSDoc de
 * `health/bodyMassIndex.js`.
 *
 * Dos operaciones de escritura, dos botones y dos peticiones, deliberadamente separadas:
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

import { bodyMassIndex, heightKnownAt, measurementUnitLabel } from '../health/bodyMassIndex.js';
import { openEvent } from '../health/eventEnvelope.js';
import { parseNumericValue } from '../health/numericValue.js';
import { formatDateTime, formatNumber, t } from '../i18n/index.js';
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
 * Tamaño de página al leer eventos para el bloque de últimas medidas. Es el techo duro de
 * `HealthEventPage::MAX_FETCH_LIMIT`: aquí se busca hacia atrás en el tiempo hasta encontrar la
 * última pesada y la última estatura, y cuantas menos idas y vueltas, mejor.
 */
const MEASUREMENTS_PAGE_SIZE = 500;

/**
 * Cuántas páginas se recorren como mucho.
 *
 * Sin tope, una cuenta con años de comidas y glucemias y sin ninguna estatura recorrería el
 * historial entero descifrando sobre a sobre solo para acabar diciendo «todavía no». Con el tope, el
 * peor caso son 2500 eventos y el bloque dice lo mismo. Que una estatura de hace muchísimo no
 * aparezca es un mal menor frente a bloquear la pestaña: se registra de nuevo y vuelve a salir.
 */
const MEASUREMENTS_MAX_PAGES = 5;

/**
 * Resume las últimas medidas corporales a partir de los eventos de peso ya descifrados.
 *
 * El peso más reciente y la estatura más reciente pueden venir de registros distintos, y es lo
 * normal: la estatura es opcional en cada registro (ver `health/bodyWeightPage.js`). El IMC se
 * calcula con esa pareja, que es la mejor información disponible hoy.
 *
 * **Sin ninguna estatura no hay IMC**: devuelve `null`, y la pantalla no enseña cifra. Nunca un
 * cero ni una estatura media inventada.
 *
 * @param {list<{occurredAt: string, content: object}>} weightEvents Eventos `bodyWeight` descifrados.
 * @returns {{weight: {value: string, unit: string, occurredAt: string}|null,
 *           height: {value: string, unit: string, occurredAt: string}|null,
 *           bmi: number|null}}
 */
export function summarizeBodyMeasurements(weightEvents) {
    let weight = null;
    let weightTime = -Infinity;

    for (const event of weightEvents) {
        const time = Date.parse(event.occurredAt);

        if (Number.isNaN(time) || time < weightTime) {
            continue;
        }

        const { data } = event.content;

        weight = { value: data.value, unit: data.unit, occurredAt: event.occurredAt };
        weightTime = time;
    }

    /** Sin cota superior (`null`): el perfil enseña la estatura más reciente de todas. */
    const height = heightKnownAt(weightEvents, null);

    return { weight, height, bmi: bodyMassIndex({ weight, height }) };
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

        /**
         * Bloque de últimas medidas, ya como texto: la plantilla solo hace `x-text`. Arrancan con el
         * aviso de sesión bloqueada y no en blanco, porque hasta que no hay clave no se puede
         * descifrar nada y un hueco vacío se leería como «no tienes registros».
         */
        lastWeightText: t('common.locked.summary'),
        lastWeightDate: '',
        lastHeightText: t('common.locked.summary'),
        lastHeightDate: '',
        bodyMassIndexText: t('common.locked.summary'),
        bodyMassIndexDate: '',
        measurementsError: '',

        init() {
            this.initialLocale = this.$refs.locale.value;

            if (isUnlocked()) {
                this.fillFromSettings();
                void this.loadBodyMeasurements();

                return;
            }

            /**
             * Los ajustes viven descifrados en memoria y llegan al terminar el arranque de sesión
             * (§6.2). Hasta entonces los campos se quedan como los pintó el servidor, que para la
             * unidad y el rango es «vacío», nunca un valor inventado. Las últimas medidas dependen
             * de la misma clave, así que esperan al mismo momento.
             */
            document.addEventListener(SESSION_READY_EVENT, () => {
                this.fillFromSettings();
                void this.loadBodyMeasurements();
            }, { once: true });
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

        /**
         * Lee, descifra y resume las últimas medidas corporales.
         *
         * El servidor no puede filtrar por tipo (ADR 0006: el tipo va dentro del sobre), así que se
         * piden páginas de eventos hacia atrás en el tiempo y se descarta aquí todo lo que no sea
         * `bodyWeight`. Se para en cuanto se tienen las dos cosas —último peso y última estatura—,
         * que en una cuenta que registra la estatura de vez en cuando es casi siempre la primera
         * página.
         *
         * Un sobre que no abre no tumba nada: se salta. Es lo mismo que hacen las pantallas de
         * historial (ADR 0004), y aquí importa menos todavía, porque el bloque solo enseña la última
         * medida y no un recuento.
         */
        async loadBodyMeasurements() {
            this.measurementsError = '';

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    this.showBodyMeasurements(null);

                    return;
                }

                const weightEvents = [];
                let cursor = null;

                for (let page = 0; page < MEASUREMENTS_MAX_PAGES; page += 1) {
                    /** Mismo orden posicional que `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                    const rawEvents = await this.$wire.fetchEvents(cursor, MEASUREMENTS_PAGE_SIZE);

                    for (const rawEvent of rawEvents) {
                        try {
                            const content = openEvent({
                                userId,
                                occurredAt: rawEvent.occurredAt,
                                envelope: rawEvent.payload,
                            });

                            if (content?.type === 'bodyWeight') {
                                weightEvents.push({ occurredAt: rawEvent.occurredAt, content });
                            }
                        } catch {
                            /** Un sobre ilegible se salta, no rompe la pantalla (ADR 0004). */
                        }
                    }

                    /** Menos filas que el tamaño de página significa que no hay más historial. */
                    if (rawEvents.length < MEASUREMENTS_PAGE_SIZE) {
                        break;
                    }

                    const summarySoFar = summarizeBodyMeasurements(weightEvents);

                    if (summarySoFar.weight !== null && summarySoFar.height !== null) {
                        break;
                    }

                    cursor = rawEvents[rawEvents.length - 1].occurredAt;
                }

                this.showBodyMeasurements(summarizeBodyMeasurements(weightEvents));
            } catch (failure) {
                this.showBodyMeasurements(null);
                this.measurementsError = describe(failure, t('profile.error.measurementsGeneric'));
            }
        },

        /**
         * Vuelca el resumen en los textos del bloque.
         *
         * `null` significa «no se pudo calcular» (sesión bloqueada o error) y se dice con la frase de
         * sesión bloqueada, no con un hueco. Lo que sí falta de verdad —no hay ningún peso, no hay
         * ninguna estatura— se dice con «todavía no hay registro», que es distinto y verdadero.
         *
         * @param {{weight: object|null, height: object|null, bmi: number|null}|null} summary
         */
        showBodyMeasurements(summary) {
            if (summary === null) {
                this.lastWeightText = t('common.locked.summary');
                this.lastHeightText = t('common.locked.summary');
                this.bodyMassIndexText = t('common.locked.summary');
                this.lastWeightDate = '';
                this.lastHeightDate = '';
                this.bodyMassIndexDate = '';

                return;
            }

            const { weight, height, bmi } = summary;

            this.lastWeightText = weight === null
                ? t('profile.body.none')
                : `${weight.value} ${measurementUnitLabel(weight.unit)}`;
            this.lastWeightDate = weight === null ? '' : formatDateTime(weight.occurredAt);

            this.lastHeightText = height === null
                ? t('profile.body.none')
                : `${height.value} ${measurementUnitLabel(height.unit)}`;
            this.lastHeightDate = height === null ? '' : formatDateTime(height.occurredAt);

            /**
             * Sin estatura no hay IMC, y se dice por qué en vez de dejar el hueco: la persona puede
             * hacer algo al respecto (registrar una estatura), así que merece saberlo.
             */
            this.bodyMassIndexText = bmi === null ? t('profile.body.noBmi') : formatNumber(bmi);
            this.bodyMassIndexDate = bmi === null ? '' : t('profile.body.fromRecords');
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
