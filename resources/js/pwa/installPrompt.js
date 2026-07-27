/**
 * Botón para instalar el panel en la pantalla de inicio.
 *
 * **Por qué hace falta un botón nuestro.** La aplicación ya es instalable —manifiesto, iconos y el
 * service worker de `public/sw.js`, que no cachea nada a propósito—, pero ofrecer la instalación se
 * lo dejábamos entero al navegador, y ahí cada uno hace lo que quiere: Chrome la esconde en el menú
 * de tres puntos, Edge en la barra de direcciones, y **Safari de iOS no la ofrece jamás**. En iOS la
 * única vía es «Compartir» → «Añadir a pantalla de inicio», que quien no lo sepa no encuentra. Un
 * botón visible en el panel unifica las tres situaciones en un solo sitio.
 *
 * **Por qué la decisión vive aquí y no en el menú de usuario de Filament.** Ese menú se construye en
 * PHP al registrar el panel, y aquí no hay nada que el servidor pueda saber: si el navegador acepta
 * instalar depende de un evento del cliente (`beforeinstallprompt`) que llega —o no— después de
 * pintar, y de si la aplicación ya está instalada, que solo sabe `matchMedia`. Un item de menú
 * renderizado en servidor aparecería también en Firefox de escritorio, donde pulsar no puede hacer
 * absolutamente nada.
 *
 * **Las dos ramas, y por qué son distintas de verdad:**
 *
 * 1. *Chromium* (Chrome, Edge, Android). Dispara `beforeinstallprompt`. Se le llama
 *    `preventDefault()` para que el navegador no saque su propio aviso —tendríamos dos ofertas
 *    compitiendo— y se guarda el evento, que es lo único capaz de abrir el diálogo real. Un evento
 *    **se gasta al usarlo**: tras `prompt()` no sirve para una segunda vez, así que se descarta y el
 *    botón desaparece, acepte o rechace la persona. El navegador enviará uno nuevo si vuelve a
 *    considerar la instalación oportuna.
 * 2. *Safari de iOS* (iPhone y iPad). `beforeinstallprompt` **no existe** en WebKit y no hay ninguna
 *    API que abra el diálogo de instalación: no es que no la usemos, es que no la hay. Ahí el botón
 *    no puede instalar nada, y lo único honesto que puede hacer es decir dónde está la opción del
 *    sistema. Por eso esta rama enseña texto en vez de llamar a nada.
 *
 * En cualquier otro caso el botón no se pinta. Sin evento y sin iOS no hay nada que ofrecer, y un
 * botón que al pulsarlo explica que no puede hacer su trabajo es peor que ningún botón.
 *
 * El evento guardado vive en el scope de este módulo, no en el componente de Alpine, y esa es la
 * razón de que el módulo exista aparte de la plantilla: el panel navega como SPA y sustituye el
 * `<body>` entero, así que el componente se reconstruye en cada pantalla mientras que el evento
 * —que llega una sola vez, normalmente al abrir— tiene que sobrevivir a esas navegaciones. Es el
 * mismo motivo por el que la clave maestra vive en el scope de `auth/keyring.js` (ADR 0003).
 */

/**
 * El `BeforeInstallPromptEvent` que el navegador nos cedió, o `null` si no ha llegado o ya se gastó.
 *
 * @type {{prompt: () => Promise<unknown>}|null}
 */
let deferredPrompt = null;

/**
 * Evento propio con el que se avisa al botón ya pintado de que la disponibilidad de la instalación
 * ha cambiado (llegó la oferta del navegador, o la aplicación acaba de instalarse).
 */
const AVAILABILITY_EVENT = 'phr:install-availability';

/**
 * ¿Se está ejecutando ya como aplicación instalada?
 *
 * Dos comprobaciones porque son dos mundos: `display-mode: standalone` es el estándar que responde
 * Chromium, y `navigator.standalone` es la propiedad no estándar de WebKit, la única señal en iOS.
 * Si alguna dice que sí, no hay nada que instalar y el botón sobra.
 *
 * @param {Window} win
 * @returns {boolean}
 */
export function isInstalled(win) {
    if (win?.navigator?.standalone === true) {
        return true;
    }

    return win?.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

/**
 * ¿Es un iPhone o un iPad?
 *
 * El iPad con iPadOS miente en el `userAgent` y se presenta como un Mac de escritorio, así que la
 * cadena no basta: se le suma que un Mac de verdad no tiene pantalla táctil, de ahí el
 * `maxTouchPoints`. No se distingue el navegador porque en iOS **todos** son WebKit por obligación
 * de plataforma: Chrome y Firefox de iPhone tienen exactamente la misma limitación que Safari.
 *
 * @param {Window} win
 * @returns {boolean}
 */
export function isIos(win) {
    const nav = win?.navigator;

    if (nav === undefined || nav === null) {
        return false;
    }

    const agent = String(nav.userAgent ?? '');

    if (/iPhone|iPad|iPod/.test(agent)) {
        return true;
    }

    return /Macintosh/.test(agent) && Number(nav.maxTouchPoints ?? 0) > 1;
}

/**
 * Qué puede ofrecer el botón ahora mismo.
 *
 * Función pura y separada de todo lo demás para poder probar las cuatro situaciones sin navegador.
 * El orden importa: «ya instalada» gana siempre, porque en iOS instalada se sigue detectando iOS.
 *
 * @param {{installed: boolean, ios: boolean, hasPrompt: boolean}} signals
 * @returns {'hidden'|'prompt'|'ios'}
 */
export function installMode({ installed, ios, hasPrompt }) {
    if (installed) {
        return 'hidden';
    }

    if (hasPrompt) {
        return 'prompt';
    }

    return ios ? 'ios' : 'hidden';
}

/**
 * Empieza a escuchar al navegador. Se llama una vez desde `app.js`, al evaluar el módulo.
 *
 * Tiene que engancharse lo antes posible: `beforeinstallprompt` se dispara sin avisar y no se
 * repite, así que un oyente puesto cuando Alpine monta el botón llegaría tarde en la primera carga.
 *
 * @param {Window} win
 * @returns {void}
 */
export function captureInstallPrompt(win) {
    win.addEventListener('beforeinstallprompt', (event) => {
        /** Sin esto el navegador saca su propio aviso y habría dos ofertas de instalación a la vez. */
        event.preventDefault();
        deferredPrompt = event;
        win.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT));
    });

    /**
     * Instalada desde el propio botón o desde el menú del navegador: el evento guardado ya no sirve
     * y el botón tiene que irse sin esperar a que se recargue la página.
     */
    win.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        win.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT));
    });
}

/**
 * Componente Alpine del botón (`x-data="phrInstallButton"`).
 *
 * @param {Window} [win]
 * @returns {object}
 */
export function installButton(win = window) {
    return {
        /** @type {'hidden'|'prompt'|'ios'} */
        mode: 'hidden',

        /**
         * Indicación de iOS, visible solo tras pulsar: es una respuesta, no un aviso permanente.
         *
         * El texto no se construye aquí, lo escribe la plantilla con `__()`: es una frase fija, sin
         * datos, y pintarla en Blade la deja en el mismo sitio que el resto del texto del panel en
         * lugar de repartir la traducción entre `lang/` y los catálogos del cliente.
         */
        hintVisible: false,

        /** Oyente vivo en `window`, guardado para poder retirarlo al destruir el componente. */
        onAvailability: null,

        init() {
            this.refresh();

            /**
             * El evento puede llegar después de montar el botón —lo normal en una recarga— y también
             * antes, si se navegó a otra pantalla. Se cubren los dos: aquí la llegada tardía, y en
             * `refresh()` la que ya estaba guardada al montar.
             */
            this.onAvailability = () => this.refresh();
            win.addEventListener(AVAILABILITY_EVENT, this.onAvailability);
        },

        /**
         * El oyente está en `window`, que sobrevive a la navegación SPA, mientras que el componente
         * se reconstruye en cada pantalla: sin retirarlo se acumularía un oyente por pantalla
         * visitada, todos apuntando a componentes ya desmontados.
         */
        destroy() {
            win.removeEventListener(AVAILABILITY_EVENT, this.onAvailability);
            this.onAvailability = null;
        },

        refresh() {
            this.mode = installMode({
                installed: isInstalled(win),
                ios: isIos(win),
                hasPrompt: deferredPrompt !== null,
            });

            if (this.mode !== 'ios') {
                this.hintVisible = false;
            }
        },

        async install() {
            if (this.mode === 'ios') {
                /** En iOS no hay diálogo que abrir: solo se puede señalar dónde está la opción. */
                this.hintVisible = !this.hintVisible;

                return;
            }

            const event = deferredPrompt;

            if (event === null) {
                this.mode = 'hidden';

                return;
            }

            /**
             * Se descarta **antes** de esperar la respuesta: el evento ya está gastado en cuanto se
             * llama a `prompt()`, y dejarlo mientras el diálogo está abierto permitiría un segundo
             * clic que fallaría con una excepción del navegador.
             */
            deferredPrompt = null;
            this.mode = 'hidden';

            try {
                await event.prompt();
            } catch {
                /**
                 * Rechazar el diálogo, o pulsar dos veces demasiado rápido, lanza. No hay nada que
                 * contar: la persona acaba de ver el diálogo y sabe mejor que nosotros qué eligió.
                 */
            }
        },
    };
}
