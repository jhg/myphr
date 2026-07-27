/**
 * Componente Alpine de la pantalla de compartición (ADR 0011), el lado de quien es dueño de los
 * datos: elegir rango y tipos, generar el recorte, enseñar el enlace, el PIN y el QR, y listar y
 * revocar lo que sigue vivo.
 *
 * El contrato del DOM lo fija `resources/views/phr/pages/sharing.blade.php`. Como en el resto del
 * panel: nada de `wire:model` y ningún sobre en una propiedad de Livewire (ADR 0002). Aquí hay
 * además un motivo extra y más duro: el paquete lleva prefijo `s1.` y los dos guardarraíles del
 * ADR 0002 —`livewirePayloadGuard.js` en el cliente y `EncryptedPayloadGuardHook` en el servidor—
 * abortan cualquier cadena de más de 256 caracteres que no empiece por `v1.`. Un paquete que
 * viajase por Livewire lo abortarían los dos. Por eso sube por `POST /phr/shares`, el endpoint HTTP
 * propio que el propio ADR 0002 reserva para los blobs grandes, mientras que **leer** los eventos
 * sigue yendo por `$wire.fetchEvents`, que es la vía de siempre y devuelve sobres `v1.`.
 *
 * **Lo que el servidor ve de todo esto**: un blob, dos fechas y un identificador. Ni el rango, ni
 * los tipos, ni cuántos eventos van dentro. El rango y los tipos viajan cifrados dos veces, en el
 * paquete (para el profesional) y en el descriptor (para esta misma pantalla, que se pinta
 * descifrándolo). El servidor sí sabe **quién** comparte, **cuándo** y **cuántas veces**, y la
 * pantalla lo dice sin adornos en vez de dejarlo en la letra pequeña de un ADR.
 *
 * **El orden de las operaciones importa** y no es negociable: primero se descifran los eventos
 * elegidos, luego se cifra el paquete con `CK`, luego se estira el PIN con Argon2id, y solo al final
 * sube todo. Estirar el PIN antes de saber si el paquete cabe regalaría varios segundos de espera
 * para acabar en un error de tamaño.
 *
 * **Una compartición incompleta es peor que ninguna.** Si el recorrido de páginas se queda corto, la
 * generación **falla**; no se comparte lo que se pudo bajar con un aviso al lado. Es el mismo
 * argumento con el que el ADR descarta trocear el paquete: un historial coherente al que le falta la
 * semana de las hipoglucemias no se distingue de uno completo, y quien lo lee concluye que esa
 * semana no pasó nada. Por el mismo motivo, un evento que no descifra aborta la generación en vez de
 * quedarse fuera en silencio (ADR 0004: un fallo de descifrado es siempre visible).
 *
 * **La vista previa enseña el recorte con la misma pantalla del profesional** y no con una versión
 * resumida: monta `reader/clippingExplorer.js` sobre el **mismo** cuerpo de paquete que se cifraría
 * al generar ({@see buildSharePackageBody}). Es la única forma de que «lo que vas a enviar» sea
 * literalmente lo que la otra persona verá, y no cuesta ninguna exposición nueva: son eventos que ya
 * están descifrados en este navegador, no sube nada y todavía no existe ningún enlace.
 *
 * Las funciones exportadas antes de `sharePage()` son la lógica pura del componente, probable sin
 * Alpine ni DOM (`tests/js/sharePage.test.mjs`).
 */

import { renderSVG } from 'uqr';

import { AuthRequestError, deleteJson, getJson, postJson } from '../auth/http.js';
import { isUnlocked, ownerId } from '../auth/keyring.js';
import { encodeBase64Url } from '../crypto/base64url.js';
import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { sealSharePackage, ShareEnvelopeError } from '../crypto/shareEnvelope.js';
import {
    deriveShareLinkKeysAsync,
    generateContentKey,
    generatePin,
    generatePinSalt,
    generateSendKey,
} from '../crypto/shareKeys.js';
import { encodeShareFragment, sealShareWrapper } from '../crypto/shareLink.js';
import { zeroize } from '../crypto/zeroize.js';
import { currentLocale, formatDateTime, joinList, t } from '../i18n/index.js';
import { resolveCatalog } from '../reader/clinicalReport.js';
import { renderClippingExplorer } from '../reader/clippingExplorer.js';
import { dateRangeControl } from './dateRange.js';
import { openEvent } from './eventEnvelope.js';
import { progressMixin } from '../auth/progress.js';
import { openShareDescriptor, sealShareDescriptor } from './shareDescriptor.js';

/**
 * Tipos clínicos que se pueden compartir, en el orden en que se ofrecen.
 *
 * Son los valores del campo `type` del contenido de un evento (ADR 0006), no etiquetas: el servidor
 * no puede filtrar por tipo, así que filtrar es exactamente comparar esta cadena con la que sale de
 * descifrar cada sobre. Las etiquetas traducidas las pinta el servidor desde `Sharing::catalog()`,
 * y `tests/Feature/SharingPageTest.php` comprueba que las dos listas siguen coincidiendo: una
 * pantalla que ofrece un tipo que este módulo no reconoce genera recortes vacíos sin decirlo.
 *
 * @type {Readonly<list<string>>}
 */
export const SHAREABLE_TYPES = Object.freeze([
    'glucose',
    'bloodPressure',
    'insulin',
    'meal',
    'bodyWeight',
    'temperature',
]);

/**
 * Tamaño de página del recorrido de eventos y tope de páginas.
 *
 * El producto (5.000 eventos) es el techo duro de un recorte. No sale de ningún cálculo de bytes
 * —de eso ya se encarga la escalera de relleno, que rechaza lo que no cabe en 4 MiB—, sino del
 * tiempo: cinco mil sobres son varios minutos de descifrado en un móvil, y a partir de ahí lo
 * honesto es pedir un rango más corto en vez de dejar la pestaña colgada.
 */
const FETCH_PAGE_SIZE = 250;
const MAX_FETCH_PAGES = 20;

/**
 * Tramos de la barra de progreso.
 *
 * El estiramiento del PIN se lleva el tramo largo porque es lo que de verdad tarda: Argon2id con
 * los parámetros del KSF de OPAQUE son entre uno y varios segundos, medidos (ADR 0011).
 */
const PROGRESS_FETCH = 0.15;
const PROGRESS_DECRYPT = 0.35;
const PROGRESS_PACKAGE = 0.5;
const PROGRESS_PIN_START = 0.5;
const PROGRESS_PIN_END = 0.9;
const PROGRESS_UPLOAD = 0.95;

/**
 * Lado mínimo del QR en píxeles CSS y borde en módulos (ADR 0011: corrección M, lado mínimo de
 * 400 px).
 *
 * El borde es de cuatro módulos y no del que trae `uqr` por defecto (uno): la «zona tranquila» que
 * el estándar exige son cuatro módulos, y sin ella muchos lectores fallan cuando el QR queda pegado
 * a un borde de contraste, que es justo lo que pasa en una tarjeta clara.
 */
export const QR_MIN_SIDE_PX = 400;
export const QR_BORDER_MODULES = 4;

/** Selección inicial de tipos: todos marcados. @returns {Record<string, boolean>} */
export function defaultTypeSelection() {
    return Object.fromEntries(SHAREABLE_TYPES.map((type) => [type, true]));
}

/**
 * Parte la selección en las dos listas que el ADR exige que viajen dentro del paquete.
 *
 * **Los excluidos van escritos, no implícitos.** «No hay comidas» y «las comidas no se
 * compartieron» son dos cosas distintas y la diferencia es clínica: una ausencia se lee como un
 * cero. El profesional tiene que poder ver que faltan porque no se enviaron.
 *
 * @param {Record<string, boolean>} selection
 * @returns {{included: list<string>, excluded: list<string>}}
 */
export function partitionTypes(selection) {
    const included = SHAREABLE_TYPES.filter((type) => selection?.[type] === true);
    const excluded = SHAREABLE_TYPES.filter((type) => selection?.[type] !== true);

    return { included, excluded };
}

/**
 * Instante de caducidad de un recorte, a partir del TTL elegido.
 *
 * Lo calcula el cliente y no el servidor porque entra en la derivación de `wrapKey` y en el dato
 * asociado del envoltorio (`canonicalDate(expiresAt)`), así que hace falta **antes** de cifrar. El
 * servidor solo comprueba que corresponde a una de las tres opciones de la lista cerrada
 * (`App\Sharing\ShareTtl`), con quince minutos de holgura para el Argon2id y la subida.
 *
 * @param {string} token Token del TTL (`1h`, `24h`, `7d`).
 * @param {list<{token: string, hours: number}>} catalog Lista cerrada que pinta el servidor.
 * @param {Date} [referenceInstant]
 * @returns {Date}
 * @throws {ShareScreenError} Si el token no está en la lista.
 */
export function expiryFor(token, catalog, referenceInstant = new Date()) {
    const option = (catalog ?? []).find((candidate) => candidate.token === token);

    if (option === undefined) {
        throw new ShareScreenError(t('share.error.badTtl'));
    }

    return new Date(referenceInstant.getTime() + option.hours * 60 * 60 * 1000);
}

/**
 * Cuerpo en claro del paquete (ADR 0011): rango exacto, instante de generación, número de eventos y
 * las dos listas de tipos.
 *
 * `eventCount` no es redundante con `events.length`: es el compromiso que `assertShareBody()`
 * comprueba al abrir, y es lo que sustituye al manifiesto que haría falta si el paquete se
 * trocease.
 *
 * @param {object} params
 * @param {list<{occurredAt: string, content: object}>} params.events Eventos ya descifrados y
 *        filtrados, del más reciente al más antiguo.
 * @param {list<string>} params.included
 * @param {list<string>} params.excluded
 * @param {{from: string|null, to: string|null}} params.range
 * @param {Date|number|string} params.generatedAt
 * @returns {object}
 */
export function buildSharePackageBody({ events, included, excluded, range, generatedAt }) {
    return {
        v: 1,
        generatedAt: canonicalDate(generatedAt),
        range: { from: range.from ?? null, to: range.to ?? null },
        includedTypes: [...included],
        excludedTypes: [...excluded],
        eventCount: events.length,
        events: events.map((event) => ({ occurredAt: event.occurredAt, content: event.content })),
    };
}

/**
 * Contenido del descriptor: lo mismo que el paquete cuenta de sí mismo, **sin los eventos** y con
 * `CK` dentro.
 *
 * `CK` vive aquí y en ningún otro sitio del servidor, y es lo que permitiría re-armar un enlace sin
 * rehacer el recorte. Va en base64url porque el descriptor es JSON.
 *
 * @param {object} params
 * @param {Uint8Array} params.contentKey
 * @param {object} params.body Cuerpo del paquete, del que se copian rango, tipos y fechas.
 * @param {Date|number|string} params.expiresAt
 * @returns {object}
 */
export function buildShareDescriptor({ contentKey, body, expiresAt }) {
    return {
        v: 1,
        contentKey: encodeBase64Url(contentKey),
        generatedAt: body.generatedAt,
        expiresAt: canonicalDate(expiresAt),
        range: body.range,
        includedTypes: body.includedTypes,
        excludedTypes: body.excludedTypes,
        eventCount: body.eventCount,
    };
}

/**
 * URL completa del enlace, con `S` y el instante de generación en el fragmento.
 *
 * El fragmento **no viaja al servidor**: es la mitad que hace que un volcado de la base de datos no
 * baste para leer el recorte. Sí acaba en el historial del navegador del profesional y en cualquier
 * captura que haga, y eso la pantalla lo dice.
 *
 * El instante de generación va ahí, y no lo pone el servidor, porque el lector lo necesita para
 * reconstruir el dato asociado del paquete **antes** de descifrar y ninguna columna lo guarda: el
 * porqué completo está en `SEND_FRAGMENT_LENGTH` (`crypto/shareLink.js`).
 *
 * @param {object} params
 * @param {string} params.template URL de la página del lector con `{link}` por rellenar.
 * @param {string} params.linkId
 * @param {Uint8Array} params.sendKey
 * @param {Date|number} params.generatedAt
 * @returns {string}
 */
export function shareUrlFor({ template, linkId, sendKey, generatedAt }) {
    return `${template.replace('{link}', linkId)}#${encodeShareFragment({ sendKey, generatedAt })}`;
}

/**
 * SVG del QR del enlace **completo**, fragmento incluido: un QR con la mitad de la URL no abre
 * nada, y el fragmento es justo la mitad que los reescritores de URL del correo sanitario se comen,
 * que es la razón de ofrecer el QR.
 *
 * Corrección de errores M (ADR 0011): aguanta un 15 % de daño, que es lo que cubre un reflejo o un
 * dedo en la pantalla, sin inflar el número de módulos como haría H. Con una URL de ~110 caracteres
 * salen 43x43 módulos (versión 6), y la capacidad de esa versión en modo byte son 134 bytes: queda
 * holgura para un dominio bastante más largo antes de subir de versión.
 *
 * @param {string} url
 * @returns {string} SVG completo, sin recursos externos.
 */
export function qrSvgFor(url) {
    return renderSVG(url, {
        ecc: 'M',
        border: QR_BORDER_MODULES,
        /**
         * Tamaño intrínseco holgado por encima del mínimo del ADR: el SVG escala, pero partir de un
         * lado grande evita que un navegador redondee los módulos a medio píxel y emborrone los
         * bordes, que es lo que hace fallar una lectura a un metro.
         */
        pixelSize: 12,
        /**
         * Blanco y negro literales, no tokens del tema. El QR **no** conmuta con el modo oscuro
         * (ADR 0011): un código invertido lo leen algunos móviles y otros no, y el que falla lo hace
         * en la consulta, con el profesional delante. El fondo blanco va dentro del propio SVG para
         * que la tarjeta oscura no se vea a través.
         */
        whiteColor: '#FFFFFF',
        blackColor: '#000000',
    });
}

/** Error propio de esta pantalla: lo provoca lo elegido, no la criptografía ni la red. */
export class ShareScreenError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ShareScreenError';
    }
}

/**
 * Traduce un fallo a algo que se pueda leer.
 *
 * Los tres casos con nombre propio existen porque tienen arreglo distinto: el tope se arregla
 * revocando, el tamaño acortando el rango y el descifrado volviendo a entrar.
 *
 * @param {unknown} failure
 * @returns {string}
 */
export function describeShareError(failure) {
    if (failure instanceof ShareScreenError) {
        return failure.message;
    }

    if (failure instanceof EnvelopeError) {
        return t('common.undecryptable');
    }

    if (failure instanceof ShareEnvelopeError) {
        return t('share.error.tooLarge');
    }

    if (failure instanceof AuthRequestError) {
        if (failure.code === 'share_limit_reached') {
            return t('share.error.limit');
        }

        return failure.status === null ? t('common.network') : t('share.error.upload');
    }

    if (failure instanceof Error && failure.message !== '') {
        return failure.message;
    }

    return t('share.error.generic');
}

/**
 * Texto del rango de un recorte, ya descifrado, para la lista.
 *
 * Un rango abierto por arriba o por abajo se dice con palabras («todo el historial», «desde el …»)
 * en vez de dejar un hueco: un guion suelto no distingue «sin límite» de «no lo sé».
 *
 * @param {{from: string|null, to: string|null}} range
 * @returns {string}
 */
export function describeRange(range) {
    const from = range?.from ?? null;
    const to = range?.to ?? null;

    if (from === null && to === null) {
        return t('share.range.all');
    }

    if (to === null) {
        return t('share.range.from', { from: formatDateTime(from) });
    }

    if (from === null) {
        return t('share.range.to', { to: formatDateTime(to) });
    }

    return t('share.range.between', { from: formatDateTime(from), to: formatDateTime(to) });
}

/**
 * Factoría del componente Alpine. Se registra como `phrSharePage` en `resources/js/app.js`; si
 * falta allí, la pantalla se pinta y ningún botón responde, sin error visible.
 *
 * @returns {object}
 */
export function sharePage() {
    return {
        ...progressMixin(),

        /**
         * El periodo arranca en «último mes», y se pide explícitamente en vez de heredar el defecto
         * común del control: aquí lo que está en juego no es lo que se ve, sino lo que sale de
         * casa. Un defecto que comparta el historial entero regalaría años de datos a quien solo
         * quería enseñar las últimas semanas, y eso no se puede deshacer, porque revocar no borra lo
         * que la otra persona ya se descargó. Un mes cubre el caso normal de una consulta; ampliar
         * el rango cuesta un clic y el periodo en vigor está escrito en el propio control.
         */
        ...dateRangeControl({ preset: 'month' }),

        /** Catálogo público en claro que pinta el servidor: tipos, TTL, endpoints y topes. */
        config: null,

        /** Tipos marcados. Es estado de interfaz, no dato clínico: puede ir con `x-model`. */
        types: defaultTypeSelection(),

        /** TTL elegido; el por defecto lo dice el servidor (24 horas, ADR 0011). */
        ttl: '',

        error: '',
        busy: false,

        /**
         * Resultado de la última generación: enlace, PIN y caducidad. Vive **solo** en memoria de
         * esta pestaña y desaparece al recargar. El PIN no se guarda en ninguna parte, ni aquí ni
         * en el servidor, que solo tiene un comprobante del que no se puede volver atrás sin
         * romper Argon2id.
         *
         * @type {{shareId: string, url: string, pin: string, expiresAt: string,
         *         expiresAtLabel: string, eventCount: number}|null}
         */
        result: null,

        /** Si el QR está en pantalla. Mientras lo esté, el PIN se esconde (ADR 0011). */
        qrVisible: false,

        /**
         * Vista previa: si está montada, y su controlador para poder desmontarla.
         *
         * El recorte previsualizado **no se guarda en ninguna propiedad**: se pinta y se olvida. Es
         * lo mismo que hace el resto de esta pantalla con los eventos descifrados, y por el mismo
         * motivo (ADR 0002): una propiedad de un componente Livewire acaba en el snapshot.
         *
         * @type {{repaint: () => Promise<void>, destroy: () => void}|null}
         */
        preview: null,
        previewVisible: false,
        previewBusy: false,
        previewError: '',

        /** Confirmación de copiado del enlace, efímera. */
        copied: false,
        copiedTimer: null,

        /** Identificador del recorte cuya revocación está pendiente de confirmar. */
        confirmingRevoke: '',

        /** Recortes activos ya descifrados, para la lista. @type {list<object>} */
        shares: [],
        sharesError: '',
        sharesLoading: false,

        init() {
            this.config = JSON.parse(document.querySelector('[data-phr-share-catalog]').textContent);
            this.ttl = this.config.defaultTtl;

            /**
             * **La vista previa se cae en cuanto deja de corresponder a lo que se enviaría.**
             *
             * Es la única superficie de consentimiento informado de todo el flujo, y va bajo un
             * encabezado que dice, con esas palabras, «esto es exactamente lo que verá el
             * profesional». Sin esto, marcar «Comidas» o cambiar a tres meses después de haber
             * previsualizado dejaba en pantalla el recorte anterior mientras se cifraba y se subía
             * otro; y aquí no hay marcha atrás, porque revocar no borra lo que la otra persona ya
             * descargó.
             *
             * Se esconde en vez de repintarse: repintar cuesta segundos y una petición por cada
             * casilla que alguien toque. Volver a pulsar el botón la trae de vuelta con lo de ahora.
             */
            for (const property of ['types', 'rangePreset', 'rangeFromDay', 'rangeToDay']) {
                this.$watch(property, () => this.hidePreview());
            }

            /**
             * El panel corre en modo SPA (`->spa()` en `PhrPanelProvider`), así que salir de esta
             * pantalla por un enlace del menú no dispara `unload` y `hidePreview()` no llegaría a
             * correr nunca. Livewire, además, copia `document.documentElement.outerHTML` a su caché
             * del botón «atrás» justo antes de navegar: sin este oyente, ahí quedaría una copia del
             * recorte descifrado —notas, valores, fechas— de una pantalla de la que ya se había ido.
             *
             * `once` porque al navegar este componente muere: el oyente tiene que durar exactamente
             * hasta la primera salida, y dejarlo puesto acumularía uno por visita, cada uno atado a
             * un componente ya difunto.
             */
            document.addEventListener('livewire:navigating', () => this.hidePreview(), { once: true });

            void this.loadShares();
        },

        /**
         * Contrato de `dateRangeControl()`: el mixin llama a `loadHistory()` al aplicar el rango.
         *
         * Aquí no hay historial que pintar —esta pantalla no enseña los registros, solo los
         * empaqueta—, así que lo único que hace es revalidar lo tecleado, que es lo que rellena o
         * limpia `rangeError`. Recortar de oficio al cambiar el rango sería peor: generar tarda
         * segundos y cuesta un enlace de los que hay tope, así que solo se hace bajo pulsación.
         */
        async loadHistory() {
            this.historyRange();
        },

        /** @returns {list<{token: string, label: string}>} Tipos marcados, con su etiqueta. */
        selectedTypeOptions() {
            return (this.config?.types ?? []).filter((option) => this.types[option.token] === true);
        },

        /**
         * Genera el recorte entero: descifra, empaqueta, estira el PIN, sube y enseña el resultado.
         *
         * Cada `zeroize` de abajo borra material de clave de la memoria del proceso en cuanto deja
         * de hacer falta (ADR 0004). No es cosmética: `CK` abre el paquete y `wrapKey` abre `CK`.
         */
        async generate() {
            if (this.busy) {
                return;
            }

            this.busy = true;
            this.error = '';
            this.result = null;
            this.qrVisible = false;
            this.resetProgress();

            /** @type {Uint8Array|null} */
            let contentKey = null;
            /** @type {Uint8Array|null} */
            let sendKey = null;
            /** @type {{pinTag: Uint8Array, wrapKey: Uint8Array}|null} */
            let linkKeys = null;

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new ShareScreenError(t('common.noSession'));
                }

                const { included, excluded } = partitionTypes(this.types);

                if (included.length === 0) {
                    throw new ShareScreenError(t('share.error.noTypes'));
                }

                const range = this.historyRange();

                if (this.rangeError !== '') {
                    throw new ShareScreenError(this.rangeError);
                }

                await this.advance(t('share.stage.reading'), PROGRESS_FETCH);

                const rawEvents = await this.fetchRangeEvents(range);

                await this.advance(t('share.stage.decrypting'), PROGRESS_DECRYPT);

                const events = this.decryptForSharing(rawEvents, userId, included);

                if (events.length === 0) {
                    throw new ShareScreenError(t('share.error.empty'));
                }

                await this.advance(t('share.stage.packing'), PROGRESS_PACKAGE);

                const generatedAt = new Date();
                const expiresAt = expiryFor(this.ttl, this.config.ttls, generatedAt);

                /**
                 * Los identificadores los genera el cliente, y tienen que ser UUID**v4**: el v7
                 * lleva el instante de creación en claro dentro de sí mismo, y estos acaban en la
                 * URL que se enseña y en la foto que el profesional guarda. `crypto.randomUUID()`
                 * es v4 por definición, y `App\Sharing\ClientUuid` comprueba la versión.
                 */
                const shareId = globalThis.crypto.randomUUID();
                const linkId = globalThis.crypto.randomUUID();

                const body = buildSharePackageBody({ events, included, excluded, range, generatedAt });

                contentKey = generateContentKey();

                const packageEnvelope = await sealSharePackage({ contentKey, shareId, body });

                const descriptor = sealShareDescriptor({
                    userId,
                    shareId,
                    descriptor: buildShareDescriptor({ contentKey, body, expiresAt }),
                });

                const pin = generatePin();
                const pinSalt = generatePinSalt();
                sendKey = generateSendKey();

                await this.advance(t('share.stage.pin'), PROGRESS_PIN_START);

                linkKeys = await deriveShareLinkKeysAsync({
                    pin,
                    pinSalt,
                    linkId,
                    expiresAt,
                    sendKey,
                    onProgress: (fraction) => {
                        this.progress = PROGRESS_PIN_START + fraction * (PROGRESS_PIN_END - PROGRESS_PIN_START);
                        this.progressSeconds = 0;
                    },
                });

                const wrapper = sealShareWrapper({
                    wrapKey: linkKeys.wrapKey,
                    contentKey,
                    linkId,
                    expiresAt,
                    packageEnvelope,
                });

                await this.advance(t('share.stage.uploading'), PROGRESS_UPLOAD);

                await postJson(this.config.endpoints.shares, {
                    id: shareId,
                    payload: packageEnvelope,
                    descriptor,
                    expiresAt: canonicalDate(expiresAt),
                    link: {
                        id: linkId,
                        pinSalt: encodeBase64Url(pinSalt),
                        pinTag: encodeBase64Url(linkKeys.pinTag),
                        wrapper,
                    },
                });

                this.result = {
                    shareId,
                    url: shareUrlFor({ template: this.config.readerUrlTemplate, linkId, sendKey, generatedAt }),
                    pin,
                    expiresAt: canonicalDate(expiresAt),
                    expiresAtLabel: formatDateTime(expiresAt),
                    eventCount: events.length,
                };

                await this.advance(t('share.stage.done'), 1);

                await this.loadShares();
            } catch (failure) {
                this.error = describeShareError(failure);
                this.resetProgress();
            } finally {
                if (contentKey !== null) {
                    zeroize(contentKey);
                }

                if (sendKey !== null) {
                    zeroize(sendKey);
                }

                if (linkKeys !== null) {
                    zeroize(linkKeys.wrapKey);
                    zeroize(linkKeys.pinTag);
                }

                this.busy = false;
            }
        },

        /**
         * Recorre el rango entero, página a página, con el mismo cursor que el panel de inicio: la
         * fecha del evento más antiguo de la página, que el servidor aplica con `<` estricto.
         *
         * Quedarse corto **es un error**, no un aviso: ver la cabecera del módulo.
         *
         * @param {{from: string|null, to: string|null}} range
         * @returns {Promise<list<{id: string, occurredAt: string, payload: string}>>}
         * @throws {ShareScreenError} Si el rango no cabe en el tope de páginas.
         */
        async fetchRangeEvents(range) {
            const rawEvents = [];
            let cursor = null;

            for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
                /** Mismo orden posicional que `HealthEventPage::fetchEvents(?string, int, ?string, ?string)`. */
                const pageEvents = await this.$wire.fetchEvents(cursor, FETCH_PAGE_SIZE, range.from, range.to);

                rawEvents.push(...pageEvents);

                if (pageEvents.length < FETCH_PAGE_SIZE) {
                    return rawEvents;
                }

                cursor = pageEvents[pageEvents.length - 1].occurredAt;
            }

            throw new ShareScreenError(t('share.error.tooManyEvents', { count: MAX_FETCH_PAGES * FETCH_PAGE_SIZE }));
        },

        /**
         * Descifra los sobres y se queda con los tipos elegidos.
         *
         * Un sobre que no abre **aborta**: en el historial se cuenta y se sigue, porque ahí la
         * persona ve la pantalla entera y el aviso al lado; en un recorte que va a viajar a otras
         * manos, un registro que falta es indistinguible de un registro que no existió.
         *
         * @param {list<{id: string, occurredAt: string, payload: string}>} rawEvents
         * @param {string} userId
         * @param {list<string>} included
         * @returns {list<{occurredAt: string, content: object}>}
         * @throws {ShareScreenError} Si algún sobre no abre.
         */
        decryptForSharing(rawEvents, userId, included) {
            const events = [];
            let failed = 0;

            for (const rawEvent of rawEvents) {
                let content;

                try {
                    content = openEvent({
                        userId,
                        occurredAt: rawEvent.occurredAt,
                        envelope: rawEvent.payload,
                    });
                } catch {
                    failed += 1;

                    continue;
                }

                if (included.includes(content?.type)) {
                    events.push({ occurredAt: rawEvent.occurredAt, content });
                }
            }

            if (failed > 0) {
                throw new ShareScreenError(t('share.error.undecryptable', { count: failed }));
            }

            return events;
        },

        /**
         * Enseña u oculta la vista previa: el recorte del rango y los tipos elegidos ahora mismo,
         * pintado con la **misma** pantalla que verá el profesional.
         *
         * Se hace bajo pulsación y no de oficio al cambiar el rango: descifrar un mes de eventos
         * cuesta segundos, y hacerlo cada vez que alguien toca una casilla convertiría la pantalla
         * en un tostador.
         *
         * **No es gratis, y conviene no decir que lo es.** No se sube ningún paquete, no se crea
         * ningún enlace y no se consume ninguno de los del tope; pero se leen los eventos del
         * servidor exactamente igual que al generar, con el `from`/`to` en claro (`occurred_at` es
         * columna en claro, ADR 0006). La diferencia con el panel es la atribución: el servidor sabe
         * qué componente llama, así que una previsualización abandonada le dice «estuvo preparando un
         * envío de este rango y al final no lo mandó». El descifrado, eso sí, sigue ocurriendo entero
         * aquí.
         */
        async togglePreview() {
            if (this.previewVisible) {
                this.hidePreview();

                return;
            }

            if (this.previewBusy) {
                return;
            }

            this.previewBusy = true;
            this.previewError = '';

            try {
                const userId = ownerId();

                if (!isUnlocked() || userId === null) {
                    throw new ShareScreenError(t('common.noSession'));
                }

                const { included, excluded } = partitionTypes(this.types);

                if (included.length === 0) {
                    throw new ShareScreenError(t('share.error.noTypes'));
                }

                const range = this.historyRange();

                if (this.rangeError !== '') {
                    throw new ShareScreenError(this.rangeError);
                }

                const events = this.decryptForSharing(await this.fetchRangeEvents(range), userId, included);

                if (events.length === 0) {
                    throw new ShareScreenError(t('share.error.empty'));
                }

                /**
                 * El **mismo** cuerpo que se cifraría al generar. Construirlo aquí de otra forma
                 * dejaría la vista previa enseñando algo que no es lo que se envía, que es
                 * exactamente lo que esta función existe para descartar.
                 */
                const body = buildSharePackageBody({
                    events,
                    included,
                    excluded,
                    range,
                    generatedAt: new Date(),
                });

                /**
                 * La sección se descubre **antes** de pintar, y con `$nextTick` para que Alpine haya
                 * aplicado ya el `x-show`. Chart.js mide el ancho del contenedor al construirse, y
                 * dentro de un elemento con `display: none` ese ancho es cero: el lienzo saldría de
                 * un píxel y no se recuperaría al mostrarlo.
                 */
                this.previewVisible = true;
                await this.$nextTick();

                this.preview = renderClippingExplorer(this.$refs.preview, {
                    body,
                    /**
                     * El vocabulario del lector (tokens de catálogo, términos LOINC y unidades) lo
                     * pinta el servidor en el catálogo de esta pantalla, en los tres idiomas, igual
                     * que en la página del lector. Aquí se resuelve al idioma en vigor del panel.
                     */
                    resolved: resolveCatalog(this.config.readerCatalog, currentLocale()),
                    chartPrefix: 'share-preview',
                });
            } catch (failure) {
                this.previewError = describeShareError(failure);
                this.hidePreview();
            } finally {
                this.previewBusy = false;
            }
        },

        /**
         * Desmonta la vista previa. Destruir las gráficas no es cosmética: dejarlas vivas sobre
         * lienzos que ya no están en el documento mantiene en memoria los valores en claro que
         * dibujaron.
         */
        hidePreview() {
            this.preview?.destroy();
            this.preview = null;
            this.previewVisible = false;
        },

        /** Enseña u oculta el QR. Al enseñarlo, el PIN desaparece de la pantalla (ADR 0011). */
        toggleQr() {
            this.qrVisible = !this.qrVisible;

            if (!this.qrVisible) {
                this.$refs.qr.replaceChildren();

                return;
            }

            /**
             * El SVG se inyecta como marcado y no con `x-html` sobre una propiedad: así el QR solo
             * existe en el DOM mientras está a la vista, y ocultarlo lo borra de verdad.
             */
            this.$refs.qr.innerHTML = qrSvgFor(this.result.url);

            const svg = this.$refs.qr.querySelector('svg');

            if (svg !== null) {
                svg.setAttribute('width', String(QR_MIN_SIDE_PX));
                svg.setAttribute('height', String(QR_MIN_SIDE_PX));
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', t('share.qr.alt'));
            }
        },

        /**
         * Copia **el enlace**, nunca el PIN.
         *
         * No es un olvido: el portapapeles es lo que se pega en la misma conversación donde se
         * acaba de pegar el enlace, y las dos mitades juntas en un mismo mensaje convierten el PIN
         * en decoración. El PIN se dicta, se teclea o se dice en voz alta.
         */
        async copyLink() {
            try {
                await globalThis.navigator.clipboard.writeText(this.result.url);

                clearTimeout(this.copiedTimer);
                this.copied = true;
                this.copiedTimer = setTimeout(() => {
                    this.copied = false;
                    this.copiedTimer = null;
                }, 4000);
            } catch {
                this.error = t('share.error.copy');
            }
        },

        /**
         * Carga la lista de recortes activos y la pinta descifrando cada descriptor.
         *
         * El servidor manda identificadores, fechas y sobres; el rango y los tipos salen de abrir el
         * descriptor aquí, que es el único sitio donde existe la clave maestra.
         */
        async loadShares() {
            this.sharesLoading = true;
            this.sharesError = '';

            try {
                if (!isUnlocked() || ownerId() === null) {
                    this.shares = [];
                    this.renderShares(t('common.locked.history'));

                    return;
                }

                const userId = ownerId();
                const response = await getJson(this.config.endpoints.shares);

                this.shares = response.shares.map((share) => {
                    try {
                        return {
                            ...share,
                            descriptor: openShareDescriptor({
                                userId,
                                shareId: share.id,
                                envelope: share.descriptor,
                            }),
                        };
                    } catch {
                        /**
                         * Un descriptor que no abre no se omite (ADR 0004): ese recorte sigue vivo
                         * en el servidor y sigue siendo legible por quien tenga enlace y PIN, así
                         * que esconderlo sería esconder algo que sigue compartido. Se pinta como
                         * fila de error, y con su botón de revocar, que es lo único que hace falta.
                         */
                        return { ...share, descriptor: null };
                    }
                });

                this.renderShares(null);
            } catch (failure) {
                this.sharesError = describeShareError(failure);
            } finally {
                this.sharesLoading = false;
            }
        },

        /**
         * Pide confirmación antes de revocar. Revocar es borrado físico e irreversible, así que un
         * clic suelto no puede bastar.
         *
         * @param {string} shareId
         */
        askRevoke(shareId) {
            this.confirmingRevoke = shareId;
            this.renderShares(null);
        },

        cancelRevoke() {
            this.confirmingRevoke = '';
            this.renderShares(null);
        },

        /** @param {string} shareId */
        async revoke(shareId) {
            this.sharesError = '';

            try {
                await deleteJson(`${this.config.endpoints.shares}/${shareId}`);

                this.confirmingRevoke = '';

                /**
                 * Si el enlace recién generado es el que se acaba de revocar, el panel del
                 * resultado desaparece: dejar en pantalla un enlace y un PIN que ya no abren nada
                 * es peor que no enseñarlos, porque se dan por buenos.
                 */
                if (this.result !== null && this.result.shareId === shareId) {
                    this.result = null;
                    this.qrVisible = false;
                    this.$refs.qr.replaceChildren();
                }

                await this.loadShares();
            } catch (failure) {
                this.sharesError = describeShareError(failure);
            }
        },

        /**
         * Pinta la lista en el DOM, como el resto de pantallas del panel: el contenido descifrado se
         * escribe desde JavaScript dentro de una región `wire:ignore`, para que un re-render de
         * Livewire no lo borre (ADR 0002).
         *
         * @param {string|null} notice Mensaje que sustituye a la lista (sin clave, por ejemplo).
         */
        renderShares(notice) {
            const container = this.$refs.shares;

            if (notice !== null) {
                container.replaceChildren(createNote(notice));

                return;
            }

            if (this.shares.length === 0) {
                container.replaceChildren(createNote(t('share.list.empty')));

                return;
            }

            const list = document.createElement('ul');
            list.className = 'flex flex-col';

            for (const share of this.shares) {
                list.appendChild(this.renderShareItem(share));
            }

            container.replaceChildren(list);
        },

        /**
         * Fila de un recorte activo, con la forma de DESIGN.md § Lists.
         *
         * @param {object} share
         * @returns {HTMLLIElement}
         */
        renderShareItem(share) {
            const item = document.createElement('li');
            item.className = 'flex min-h-12 flex-wrap items-start gap-4 border-b border-border px-4 py-3.5 last:border-b-0';

            const body = document.createElement('div');
            body.className = 'flex flex-1 flex-col gap-1';

            const headline = document.createElement('p');
            headline.className = 'text-body text-ink';

            if (share.descriptor === null) {
                headline.textContent = t('share.list.undecryptable');
                headline.classList.add('text-error-ink');
            } else {
                headline.textContent = describeRange(share.descriptor.range);
            }

            body.appendChild(headline);

            if (share.descriptor !== null) {
                const types = document.createElement('p');
                types.className = 'text-body-sm text-ink-secondary';
                types.textContent = t('share.list.types', {
                    types: joinList(share.descriptor.includedTypes.map((type) => this.typeLabel(type))),
                });
                body.appendChild(types);

                const counts = document.createElement('p');
                counts.className = 'text-caption text-ink-secondary';
                counts.textContent = t('share.list.records', { count: share.descriptor.eventCount });
                body.appendChild(counts);
            }

            const expiry = document.createElement('p');
            expiry.className = 'text-caption text-ink-secondary';
            expiry.textContent = t('share.list.expires', { at: formatDateTime(share.expiresAt) });
            body.appendChild(expiry);

            /**
             * `opened_at` es la marca del **primer** acceso, redondeada a la hora, y no un contador
             * de descargas: no existe tal contador, y la pantalla no puede insinuar que lo hay.
             */
            const opened = document.createElement('p');
            opened.className = 'text-caption text-ink-secondary';
            opened.textContent = share.openedAt === null
                ? t('share.list.notOpened')
                : t('share.list.opened', { at: formatDateTime(share.openedAt) });
            body.appendChild(opened);

            item.appendChild(body);
            item.appendChild(this.renderRevokeControls(share));

            return item;
        },

        /**
         * Botón de revocar, en dos tiempos. La confirmación no es un `confirm()` del navegador:
         * ese diálogo no se puede traducir ni estilar, y en móvil se puede desactivar.
         *
         * @param {object} share
         * @returns {HTMLElement}
         */
        renderRevokeControls(share) {
            const box = document.createElement('div');
            box.className = 'flex items-center gap-2';

            if (this.confirmingRevoke !== share.id) {
                const ask = document.createElement('button');
                ask.type = 'button';
                ask.className = 'inline-flex min-h-9 items-center justify-center rounded-control border-[1.5px] border-destructive px-4 py-2 text-button text-destructive-text hover:bg-error-surface focus-visible:shadow-error-halo focus-visible:outline-none';
                ask.textContent = t('share.list.revoke');
                ask.addEventListener('click', () => this.askRevoke(share.id));
                box.appendChild(ask);

                return box;
            }

            const warning = document.createElement('p');
            warning.className = 'text-helper text-error-ink';
            warning.textContent = t('share.list.confirmRevoke');
            box.appendChild(warning);

            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'inline-flex min-h-9 items-center justify-center rounded-control bg-destructive px-4 py-2 text-button text-destructive-ink hover:bg-destructive-hover focus-visible:shadow-error-halo focus-visible:outline-none';
            confirm.textContent = t('share.list.confirmRevokeAction');
            confirm.addEventListener('click', () => {
                void this.revoke(share.id);
            });
            box.appendChild(confirm);

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'inline-flex min-h-9 items-center justify-center rounded-control px-4 py-2 text-button text-accent hover:bg-surface-hover focus-visible:shadow-focus-blue focus-visible:outline-none';
            cancel.textContent = t('share.list.cancel');
            cancel.addEventListener('click', () => this.cancelRevoke());
            box.appendChild(cancel);

            return box;
        },

        /**
         * Etiqueta traducida de un tipo. Un token que el catálogo no conoce se enseña tal cual en
         * vez de desaparecer: un tipo compartido que no se nombra es un tipo que parece no estar.
         *
         * @param {string} token
         * @returns {string}
         */
        typeLabel(token) {
            return (this.config?.types ?? []).find((option) => option.token === token)?.label ?? token;
        },
    };
}

/**
 * Párrafo de aviso de la lista, en el texto secundario de DESIGN.md y nunca en un gris apagado
 * (Don'ts #10).
 *
 * @param {string} message
 * @returns {HTMLParagraphElement}
 */
function createNote(message) {
    const note = document.createElement('p');
    note.className = 'text-body text-ink-secondary';
    note.textContent = message;

    return note;
}
