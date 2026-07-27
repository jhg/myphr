/**
 * La pantalla que abre el profesional (ADR 0011).
 *
 * Quien llega aquí **no tiene cuenta, no conoce esta aplicación y está en consulta**. La pantalla
 * está escrita para esa persona: una sola cosa que hacer (teclear el PIN), una espera explicada
 * mientras se deriva la clave, y después una tabla clínica que se puede leer o imprimir sin más
 * pasos.
 *
 * **Lo que esta página no hace, y es deliberado:**
 *
 * * No usa Livewire, ni Filament, ni gráficas, ni ninguna cookie. La ruta ya se quita de encima la
 *   sesión y el CSRF (`routes/web.php`), y `fetch` va con `credentials: 'omit'` para que ni siquiera
 *   se mande una cookie que el navegador tuviera de antes: una cookie aquí sería un identificador
 *   estable de un profesional, correlacionable entre los recortes de dos pacientes distintos.
 * * No enseña nada de la cuenta del paciente. No lo enseña porque no lo tiene: el servidor no manda
 *   ni nombre, ni correo, ni cuántos recortes hay. Lo único que llega es el paquete cifrado.
 * * No distingue causas de fallo. Enlace inexistente, caducado, revocado y PIN incorrecto dan el
 *   **mismo** mensaje, porque distinguirlos convertiría esta página en un oráculo de qué recortes
 *   siguen vivos. Lo que sí se puede decir, y se dice, es cuántos intentos se llevan hechos desde
 *   este navegador.
 *
 * **El orden criptográfico** (ADR 0011): `challenge` da la sal → Argon2id estira el PIN una sola vez
 * → de ese estiramiento salen el `pinTag` (que se manda) y, después, la `wrapKey` (que no sale de
 * aquí) → `open` devuelve envoltorio y paquete solo si el PIN cuadra → la `wrapKey` abre el
 * envoltorio y saca `CK` → `CK` abre el paquete. El servidor no ve el PIN, ni `S`, ni `CK`, ni una
 * sola línea del contenido.
 *
 * La lógica que se puede probar sin DOM vive en `clinicalReport.js` y en las funciones exportadas de
 * este módulo (`tests/js/readerPage.test.mjs`).
 */

import { canonicalDate } from '../crypto/canonicalDate.js';
import { EnvelopeError } from '../crypto/envelope.js';
import { openSharePackage, ShareEnvelopeError } from '../crypto/shareEnvelope.js';
import { derivePinTag, deriveWrapKey, normalizePin, PIN_LENGTH, stretchPinAsync } from '../crypto/shareKeys.js';
import { decodeShareFragment, openShareWrapper } from '../crypto/shareLink.js';
import { zeroize } from '../crypto/zeroize.js';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';
import { setLocale, t } from '../i18n/index.js';
import { describeEvent, reportHeadline, resolveCatalog, sortByDateDescending, typeSummary } from './clinicalReport.js';

/** Error de esta pantalla: lo provoca lo que se ha tecleado o lo que ha contestado el servidor. */
export class ReaderError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ReaderError';
    }
}

/**
 * Lee el fragmento de la URL, que es donde viajan `S` y el instante de generación.
 *
 * **El fragmento nunca llega al servidor**, y esa es justo la mitad que hace que un volcado de la
 * base de datos no baste para leer el recorte. Pero se pierde con facilidad: los reescritores de URL
 * del correo sanitario y los portales cautivos se comen el `#`, y entonces el enlace llega
 * incompleto. Por eso, si falta, se avisa **antes** de tocar el servidor: pedir el PIN para acabar
 * en un error de descifrado sería gastar un intento de los cinco por un problema que no es del PIN.
 *
 * @param {string} hash Valor de `location.hash`, con `#` o sin él.
 * @returns {{sendKey: Uint8Array, generatedAt: Date}}
 * @throws {ReaderError} Si no hay fragmento o no tiene la forma esperada.
 */
export function readFragment(hash) {
    const raw = typeof hash === 'string' ? hash.replace(/^#/, '').trim() : '';

    if (raw === '') {
        throw new ReaderError(t('reader.error.noFragment'));
    }

    try {
        return decodeShareFragment(raw);
    } catch {
        throw new ReaderError(t('reader.error.badFragment'));
    }
}

/**
 * PIN tal cual se teclea: seis dígitos, sin espacios y sin separadores.
 *
 * Se limpia antes de comprobar porque quien lo dicta suele decirlo en dos mitades («cuatro dos uno,
 * ocho cero tres») y quien lo teclea escribe el espacio. Rechazar eso sería gastar un intento por un
 * espacio.
 *
 * @param {string} value
 * @returns {string} Exactamente `PIN_LENGTH` dígitos.
 * @throws {ReaderError} Si no lo es.
 */
export function sanitizePin(value) {
    const digits = (typeof value === 'string' ? value : '').replace(/[\s-]/g, '');

    if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(digits)) {
        throw new ReaderError(t('reader.error.badPin', { length: PIN_LENGTH }));
    }

    return normalizePin(digits);
}

/**
 * Mensaje de un intento fallido.
 *
 * Dice cuántos intentos se llevan hechos **desde este navegador**, con esas palabras, y no «te
 * quedan N»: el contador de verdad vive en una columna del servidor y no sale de ahí, porque
 * responder «te quedan 4» sobre un enlace que nunca existió delataría cuáles existen. Contarlos aquí
 * no es un oráculo de nada y sí es lo que la persona necesita para saber si le queda margen.
 *
 * @param {number} used Intentos fallidos en esta pestaña.
 * @param {number} max Tope de intentos del enlace (`ShareLink::MAX_ATTEMPTS`).
 * @returns {string}
 */
export function attemptMessage(used, max) {
    if (used >= max) {
        return `${t('reader.error.generic')} ${t('reader.error.attemptsSpent', { max })}`;
    }

    return `${t('reader.error.generic')} ${t('reader.error.attempts', { used, max })}`;
}

/**
 * Traduce cualquier fallo a algo que se pueda leer, sin decir nunca de qué fallo se trata cuando la
 * causa está del lado del enlace.
 *
 * `EnvelopeError` y `ShareEnvelopeError` sí tienen mensaje propio: a esas alturas el PIN ya era
 * correcto (el servidor entregó el paquete), así que lo que falla es la integridad de lo entregado y
 * eso hay que decirlo en voz alta y nunca enseñar el contenido a medias (ADR 0004).
 *
 * @param {unknown} failure
 * @returns {string}
 */
export function describeReaderError(failure) {
    if (failure instanceof ReaderError) {
        return failure.message;
    }

    if (failure instanceof EnvelopeError || failure instanceof ShareEnvelopeError) {
        return t('reader.error.tampered');
    }

    return t('reader.error.network');
}

/**
 * Petición JSON contra las dos rutas públicas del lector.
 *
 * `credentials: 'omit'` no es cosmética: sin ella el navegador mandaría cualquier cookie que ya
 * tuviera de este dominio —la sesión del panel, si quien abre el enlace es a la vez usuario— y esa
 * cookie ataría la lectura de un recorte a una cuenta concreta en los registros de cualquier
 * intermediario. No hay CSRF porque no hay sesión que falsificar (ADR 0011).
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{status: number, data: object|null}>}
 */
async function post(url, body) {
    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Accept: '*/*' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ReaderError(t('reader.error.network'));
    }

    const text = await response.text();
    let data = null;

    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }

    return { status: response.status, data };
}

/**
 * Abre el recorte entero: PIN → sal → Argon2id → comprobante → paquete → contenido en claro.
 *
 * Todo el material de clave se borra en el `finally` con `zeroize` (ADR 0004): el estiramiento del
 * PIN abre el envoltorio y `CK` abre el paquete, así que dejarlos en memoria después de usarlos es
 * dejar el recorte abierto en un dispositivo que no es de nadie de esta conversación.
 *
 * @param {object} params
 * @param {{challenge: string, open: string}} params.endpoints
 * @param {string} params.linkId
 * @param {string} params.pin Ya saneado por `sanitizePin`.
 * @param {Uint8Array} params.sendKey `S`, del fragmento.
 * @param {Date} params.generatedAt Instante de generación, del fragmento.
 * @param {(fraction: number) => void} [params.onProgress] Avance real del Argon2id.
 * @returns {Promise<object>} Cuerpo en claro del paquete.
 */
export async function openClipping({ endpoints, linkId, pin, sendKey, generatedAt, onProgress }) {
    /** @type {Uint8Array|null} */
    let stretched = null;
    /** @type {Uint8Array|null} */
    let pinTag = null;
    /** @type {Uint8Array|null} */
    let wrapKey = null;
    /** @type {Uint8Array|null} */
    let contentKey = null;

    try {
        const challenge = await post(endpoints.challenge, {});

        if (challenge.status !== 200 || typeof challenge.data?.pinSalt !== 'string') {
            throw new ReaderError(t('reader.error.network'));
        }

        /**
         * La sal llega siempre, exista el enlace o no: para un enlace muerto el servidor devuelve
         * una señuelo determinista, para que esta pantalla no pueda distinguirlos. Aquí eso se
         * traduce en que el Argon2id corre igual y el fallo llega después, en `open`.
         */
        const pinSalt = decodeBase64Url(challenge.data.pinSalt, 'pin salt');

        stretched = await stretchPinAsync({ pin, pinSalt, onProgress });
        pinTag = derivePinTag({ stretched, pinSalt, linkId });

        const opened = await post(endpoints.open, { pinTag: encodeBase64Url(pinTag) });

        if (opened.status !== 200 || typeof opened.data?.package !== 'string') {
            throw new ReaderError('');
        }

        const { wrapper, package: packageEnvelope, shareId, expiresAt } = opened.data;

        /**
         * `expiresAt` y `shareId` los pone el servidor y entran en los datos asociados de las dos
         * capas, así que no hace falta confiar en ellos: si mintiera en cualquiera de los dos, el
         * envoltorio o el paquete dejarían de abrir y saldría el aviso de integridad. El instante de
         * generación no viene de ahí: viene del fragmento, que el servidor nunca ve.
         */
        wrapKey = deriveWrapKey({ stretched, sendKey, pinSalt, linkId, expiresAt });

        contentKey = openShareWrapper({
            wrapKey,
            wrapper,
            linkId,
            expiresAt,
            packageEnvelope,
        });

        return await openSharePackage({
            contentKey,
            envelope: packageEnvelope,
            shareId,
            generatedAt: canonicalDate(generatedAt),
        });
    } finally {
        for (const material of [stretched, pinTag, wrapKey, contentKey]) {
            if (material !== null) {
                zeroize(material);
            }
        }
    }
}

/**
 * Arranca la pantalla sobre el DOM de `resources/views/share/reader.blade.php`.
 *
 * El contrato es el conjunto de `data-phr-reader-*` de esa vista. Si alguno faltara, la página se
 * pintaría y no respondería nada, así que se leen todos aquí arriba y de una vez.
 *
 * @param {Document} document
 * @param {Window} window
 * @returns {void}
 */
export function startReaderPage(document, window) {
    const config = JSON.parse(document.querySelector('[data-phr-reader-config]').textContent);
    const catalog = JSON.parse(document.querySelector('[data-phr-reader-catalog]').textContent);

    const nodes = {
        unlock: document.querySelector('[data-phr-reader-unlock]'),
        form: document.querySelector('[data-phr-reader-form]'),
        pin: document.querySelector('[data-phr-reader-pin]'),
        submit: document.querySelector('[data-phr-reader-submit]'),
        error: document.querySelector('[data-phr-reader-error]'),
        progress: document.querySelector('[data-phr-reader-progress]'),
        progressBar: document.querySelector('[data-phr-reader-progress-bar]'),
        progressStage: document.querySelector('[data-phr-reader-progress-stage]'),
        report: document.querySelector('[data-phr-reader-report]'),
        locales: document.querySelector('[data-phr-reader-locales]'),
        print: document.querySelector('[data-phr-reader-print]'),
    };

    const state = {
        locale: setLocale(config.locale),
        /** Cuerpo del paquete ya descifrado. Vive en memoria de esta pestaña y muere al recargar. */
        body: null,
        attempts: 0,
        busy: false,
        /** @type {{sendKey: Uint8Array, generatedAt: Date}|null} */
        fragment: null,
        error: '',
    };

    /**
     * El fragmento se lee **una sola vez** y se borra de la barra de direcciones acto seguido con
     * `history.replaceState` (ADR 0011). No lo saca del historial del navegador —eso no lo puede
     * hacer una página—, pero sí evita que quede a la vista en la pantalla de un ordenador de
     * consulta y que se copie sin querer al compartir la dirección.
     */
    try {
        state.fragment = readFragment(window.location.hash);
    } catch (failure) {
        state.error = describeReaderError(failure);
    }

    window.history.replaceState(null, '', window.location.pathname);

    renderStaticText();
    renderLocaleChoices();
    renderError();

    nodes.form.addEventListener('submit', (event) => {
        event.preventDefault();
        void unlock();
    });

    nodes.print.addEventListener('click', () => window.print());

    /** Textos fijos de la cáscara. Se pintan desde aquí para que el selector de idioma los cambie. */
    function renderStaticText() {
        for (const element of document.querySelectorAll('[data-phr-reader-text]')) {
            element.textContent = t(element.dataset.phrReaderText);
        }

        document.documentElement.lang = state.locale.replace('_', '-');
        nodes.pin.setAttribute('inputmode', 'numeric');
        nodes.pin.setAttribute('maxlength', String(PIN_LENGTH + 2));
    }

    /**
     * Selector de idioma.
     *
     * La página llega en el idioma del `Accept-Language` del profesional, que es el del navegador y
     * no necesariamente el suyo: en una consulta el equipo suele estar en el idioma que dejó puesto
     * quien lo instaló. El selector cambia el idioma **sin recargar y sin pedir nada al servidor**,
     * porque el catálogo trae los tres dentro, y sin escribir ninguna preferencia en ninguna parte:
     * una cookie de idioma sería justo la cookie que esta ruta se quita de encima.
     */
    function renderLocaleChoices() {
        nodes.locales.replaceChildren();

        for (const option of catalog.locales) {
            const button = document.createElement('button');

            button.type = 'button';
            button.textContent = option.label;
            button.setAttribute('aria-pressed', String(option.code === state.locale));
            button.className = option.code === state.locale
                ? 'min-h-9 rounded-control border-[1.5px] border-accent bg-accent px-3 py-1.5 text-button text-accent-ink'
                : 'min-h-9 rounded-control border-[1.5px] border-border-strong px-3 py-1.5 text-button text-accent hover:bg-surface-hover';
            button.addEventListener('click', () => {
                state.locale = setLocale(option.code);
                renderStaticText();
                renderLocaleChoices();
                renderError();
                renderReport();
            });

            nodes.locales.appendChild(button);
        }
    }

    function renderError() {
        nodes.error.textContent = state.error;
        nodes.error.hidden = state.error === '';
    }

    /**
     * Argon2id con los parámetros del KSF de OPAQUE tarda entre uno y varios segundos, y en un
     * equipo de consulta puede tardar bastante más. Sin nada en pantalla eso se lee como una página
     * colgada, así que la barra avanza con el progreso **real** que reporta el estiramiento y el
     * texto dice qué está pasando: que está descifrando, no que se ha parado.
     *
     * @param {string} stage
     * @param {number} fraction
     */
    function renderProgress(stage, fraction) {
        nodes.progress.hidden = !state.busy;
        nodes.progressStage.textContent = stage;
        nodes.progressBar.style.transform = `scaleX(${fraction})`;
        nodes.progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    }

    async function unlock() {
        if (state.busy || state.fragment === null) {
            return;
        }

        state.error = '';
        renderError();

        let pin = '';

        try {
            pin = sanitizePin(nodes.pin.value);
        } catch (failure) {
            state.error = describeReaderError(failure);
            renderError();

            return;
        }

        state.busy = true;
        nodes.submit.disabled = true;
        renderProgress(t('reader.stage.deriving'), 0.05);

        try {
            const body = await openClipping({
                endpoints: config.endpoints,
                linkId: config.linkId,
                pin,
                sendKey: state.fragment.sendKey,
                generatedAt: state.fragment.generatedAt,
                onProgress: (fraction) => renderProgress(t('reader.stage.deriving'), 0.05 + fraction * 0.85),
            });

            renderProgress(t('reader.stage.decrypting'), 1);

            state.body = body;
            nodes.unlock.hidden = true;
            renderReport();
        } catch (failure) {
            /**
             * Un `ReaderError` sin mensaje es el fallo genérico del servidor: no existe, caducó, se
             * revocó o el PIN no era. Los cuatro llegan aquí exactamente igual, y aquí se les añade
             * lo único que sí se puede contar, que son los intentos hechos desde este navegador.
             */
            if (failure instanceof ReaderError && failure.message === '') {
                state.attempts += 1;
                state.error = attemptMessage(state.attempts, config.maxAttempts);
            } else {
                state.error = describeReaderError(failure);
            }

            renderError();
        } finally {
            /** El PIN no se queda en el campo: la pestaña puede quedar abierta en una sala común. */
            nodes.pin.value = '';
            state.busy = false;
            nodes.submit.disabled = false;
            nodes.progress.hidden = true;
        }
    }

    /** Pinta el informe clínico entero. Se vuelve a llamar al cambiar de idioma. */
    function renderReport() {
        if (state.body === null) {
            return;
        }

        const resolved = resolveCatalog(catalog, state.locale);

        nodes.report.hidden = false;
        nodes.report.replaceChildren(
            reportHeader(resolved, state.body),
            reportTable(resolved, state.body),
        );
    }

    /**
     * Cabecera del informe: **siempre** el número de eventos, el rango y el instante de generación,
     * más las dos listas de tipos. No se pliega y no se resume: es lo que permite ver que un recorte
     * llegó truncado, y es lo que impide leer una ausencia como un cero clínico.
     *
     * @param {object} resolved
     * @param {object} body
     * @returns {HTMLElement}
     */
    function reportHeader(resolved, body) {
        const headline = reportHeadline(body);
        const types = typeSummary(resolved, body);

        const section = document.createElement('section');
        section.className = 'rounded-card border border-border bg-surface p-card shadow-sm';

        const title = document.createElement('h2');
        title.className = 'font-display text-headline text-ink';
        title.textContent = headline.count;
        section.appendChild(title);

        for (const line of [headline.range, headline.generatedAt, types.included, types.excluded]) {
            if (line === null) {
                continue;
            }

            const paragraph = document.createElement('p');
            paragraph.className = 'mt-1 text-body text-ink-secondary';
            paragraph.textContent = line;
            section.appendChild(paragraph);
        }

        const disclaimer = document.createElement('p');
        disclaimer.className = 'mt-3 text-body-sm text-ink-secondary';
        disclaimer.textContent = t('reader.header.snapshot');
        section.appendChild(disclaimer);

        return section;
    }

    /**
     * Tabla clínica, ordenada por fecha y con una fila por registro.
     *
     * Es una `<table>` de verdad y no una lista de tarjetas: se lee en columnas, se compara de un
     * vistazo y sale en papel como sale una tabla, que es donde acaba esto cuando alguien lo mete en
     * una historia clínica.
     *
     * @param {object} resolved
     * @param {object} body
     * @returns {HTMLElement}
     */
    function reportTable(resolved, body) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mt-6 overflow-x-auto rounded-card border border-border bg-surface shadow-sm';

        const table = document.createElement('table');
        table.className = 'w-full border-collapse text-body-sm';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');

        for (const key of ['reader.table.when', 'reader.table.what', 'reader.table.value', 'reader.table.details', 'reader.table.loinc']) {
            const cell = document.createElement('th');
            cell.scope = 'col';
            cell.className = 'border-b border-border px-4 py-3 text-left text-overline text-ink-secondary uppercase';
            cell.textContent = t(key);
            headRow.appendChild(cell);
        }

        head.appendChild(headRow);
        table.appendChild(head);

        const tbody = document.createElement('tbody');

        for (const event of sortByDateDescending(Array.isArray(body.events) ? body.events : [])) {
            tbody.appendChild(reportRow(describeEvent(resolved, event)));
        }

        if (tbody.children.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');

            cell.colSpan = 5;
            cell.className = 'px-4 py-3 text-body text-ink-secondary';
            cell.textContent = t('reader.table.empty');
            row.appendChild(cell);
            tbody.appendChild(row);
        }

        table.appendChild(tbody);
        wrapper.appendChild(table);

        return wrapper;
    }

    /**
     * @param {object} row Salida de `describeEvent`.
     * @returns {HTMLTableRowElement}
     */
    function reportRow(row) {
        const element = document.createElement('tr');
        element.className = 'border-b border-border last:border-b-0 break-inside-avoid';

        const when = document.createElement('td');
        when.className = 'px-4 py-3 align-top font-mono text-body-sm text-ink whitespace-nowrap';
        when.textContent = row.tz === null ? row.occurredAtLabel : `${row.occurredAtLabel} (${row.tz})`;

        const what = document.createElement('td');
        what.className = 'px-4 py-3 align-top text-body-sm text-ink';
        what.textContent = row.typeLabel;

        const value = document.createElement('td');
        value.className = row.unreadable
            ? 'px-4 py-3 align-top text-body-sm text-error-ink'
            : 'px-4 py-3 align-top font-mono text-body text-ink whitespace-nowrap';
        value.textContent = row.value;

        const details = document.createElement('td');
        details.className = 'px-4 py-3 align-top text-body-sm text-ink-secondary';

        if (row.details.length > 0 || row.note !== null) {
            const list = document.createElement('ul');
            list.className = 'flex flex-col gap-0.5';

            for (const detail of row.details) {
                const item = document.createElement('li');
                item.textContent = detail;
                list.appendChild(item);
            }

            if (row.note !== null) {
                const item = document.createElement('li');
                item.className = 'text-ink';
                item.textContent = t('reader.detail.note', { note: row.note });
                list.appendChild(item);
            }

            details.appendChild(list);
        }

        const loinc = document.createElement('td');
        loinc.className = 'px-4 py-3 align-top text-caption text-ink-secondary';

        for (const entry of row.loinc) {
            const item = document.createElement('p');

            /**
             * El código va en monoespaciada (Do's #7) y el término oficial **no se traduce**
             * (ADR 0005): es el nombre con el que esta magnitud se identifica fuera de aquí.
             */
            const code = document.createElement('span');
            code.className = 'font-mono text-ink';
            code.textContent = entry.code;
            item.appendChild(code);

            if (entry.name !== null) {
                item.appendChild(document.createTextNode(` ${entry.name}`));
            }

            loinc.appendChild(item);
        }

        for (const cell of [when, what, value, details, loinc]) {
            element.appendChild(cell);
        }

        return element;
    }
}
