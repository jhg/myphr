import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import { bunny } from 'laravel-vite-plugin/fonts';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js', 'resources/css/filament/phr/theme.css'],
            refresh: true,
            // Fuentes autoalojadas. Vite las descarga en el build y las sirve desde
            // public/build, así que en tiempo de ejecución no hay peticiones a terceros.
            // Cada familia publica una variable CSS --font-<slug> que consume el tema.
            fonts: [
                // MediCare+ (DESIGN.md § Typography): titulares, cuerpo y monoespaciada.
                // Instrument Sans, la familia del esqueleto de Laravel, ya no se descarga: no es
                // ninguna de las tres de DESIGN.md y ninguna vista la referencia.
                bunny('Figtree', {
                    weights: [600, 700], // Subhead semibold; Display y Headline bold
                }),
                bunny('Open Sans', {
                    weights: [400, 500, 600, 700], // Body; Caption; labels y botones; Overline
                }),
                bunny('IBM Plex Mono', {
                    weights: [400], // Code: números de historia, códigos y dosis
                }),
            ],
        }),
        tailwindcss(),
    ],
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
