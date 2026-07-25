<?php

declare(strict_types=1);

/**
 * Guardarraíl permanente de Spec 0001 §5 (pasos 2 y 17), §9 y ADR 0003.
 *
 * La contraseña y la clave maestra viven en el scope de un módulo ES y en el nodo del DOM del que
 * se leen, y en ningún sitio más. Cuatro mecanismos las sacarían de ahí sin que nadie lo note:
 *
 * * `wire:model` mete el valor en el `snapshot` de Livewire, que viaja al servidor y queda en la
 *   instantánea de DOM que el componente retiene.
 * * `$entangle` es lo mismo desde el lado de Alpine: sincroniza la propiedad con el servidor.
 * * `$persist` de Alpine escribe en `localStorage` por defecto.
 * * `localStorage` sobrevive al cierre de la pestaña y del navegador, así que cualquier material
 *   escrito ahí deja de estar atado a la vida de la sesión (ADR 0003).
 *
 * Este test escanea el código de cliente entero (todo `resources/js` y todo `resources/views`), no
 * solo los ficheros que hoy tocan la contraseña: la regla es más fácil de sostener si no depende de
 * acertar qué fichero es «el del password». Las menciones en comentarios sí se permiten, porque
 * documentar por qué algo está prohibido es justo lo que mantiene viva la prohibición.
 */
const FORBIDDEN_CLIENT_STATE_PATTERNS = [
    'wire:model' => '/wire:model/i',
    '$entangle' => '/\$entangle\b/',
    '$persist' => '/\$persist\b/',
    'localStorage' => '/\blocalStorage\b/',
];

/**
 * Todos los ficheros de cliente, con su ruta relativa al repositorio.
 *
 * @return array<string, string> Ruta relativa => contenido.
 */
function clientSourceFiles(): array
{
    $roots = [base_path('resources/js'), base_path('resources/views')];
    $files = [];

    foreach ($roots as $root) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
        );

        /** @var SplFileInfo $file */
        foreach ($iterator as $file) {
            if (! in_array($file->getExtension(), ['js', 'mjs', 'php'], true)) {
                continue;
            }

            $path = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname());
            $files[$path] = (string) file_get_contents($file->getPathname());
        }
    }

    ksort($files);

    return $files;
}

/**
 * Quita los comentarios de un fichero Blade o JavaScript, para que una mención en prosa no cuente
 * como uso. Se conservan los saltos de línea para que el número de línea del hallazgo siga siendo
 * el del fichero real.
 */
function withoutComments(string $source): string
{
    $patterns = [
        '/\{\{--.*?--\}\}/s',   // Blade
        '/<!--.*?-->/s',        // HTML
        '/\/\*.*?\*\//s',       // Bloque de JS y de PHP
        '/(?<![:\\\\])\/\/[^\n]*/',  // Línea de JS y de PHP, sin tragarse `https://`
        '/(?<!\$)#[^\n\[][^\n]*/',   // Línea de PHP con `#`, sin tocar atributos `#[...]`
    ];

    foreach ($patterns as $pattern) {
        $source = (string) preg_replace_callback(
            $pattern,
            static fn (array $match): string => str_repeat("\n", substr_count($match[0], "\n")),
            $source
        );
    }

    return $source;
}

it('no deja que ningún fichero de cliente saque la contraseña del DOM o de memoria', function (): void {
    $offences = [];

    foreach (clientSourceFiles() as $path => $source) {
        $code = withoutComments($source);

        foreach (FORBIDDEN_CLIENT_STATE_PATTERNS as $label => $pattern) {
            if (preg_match($pattern, $code, $match, PREG_OFFSET_CAPTURE) !== 1) {
                continue;
            }

            $line = substr_count(substr($code, 0, (int) $match[0][1]), "\n") + 1;
            $offences[] = "{$path}:{$line} usa «{$label}»";
        }
    }

    expect($offences)->toBe([]);
});

/** El escaneo sirve de poco si mira una lista vacía o si el filtro de comentarios se come todo. */
it('escanea de verdad el código de cliente', function (): void {
    $files = clientSourceFiles();

    expect(count($files))->toBeGreaterThan(15)
        ->and($files)->toHaveKey('resources/js/auth/loginPage.js')
        ->and($files)->toHaveKey('resources/js/auth/setPasswordPage.js')
        ->and($files)->toHaveKey('resources/views/phr/auth/login.blade.php');

    expect(withoutComments((string) $files['resources/js/auth/loginPage.js']))
        ->toContain('export');
});

/** Y de menos aún si no detecta el uso que persigue. */
it('detecta cada patrón prohibido cuando aparece fuera de un comentario', function (string $snippet): void {
    $code = withoutComments($snippet);

    $hit = false;

    foreach (FORBIDDEN_CLIENT_STATE_PATTERNS as $pattern) {
        $hit = $hit || preg_match($pattern, $code) === 1;
    }

    expect($hit)->toBeTrue();
})->with([
    '<input wire:model="password">',
    'x-data="{ p: $entangle(\'password\') }"',
    'Alpine.$persist(key)',
    'window.localStorage.setItem("phr.rk", packet)',
]);

/** Y tampoco vale si cuenta como uso lo que solo es prosa. */
it('no cuenta las menciones en comentarios', function (string $snippet): void {
    expect(withoutComments($snippet))->not->toMatch('/wire:model|localStorage/');
})->with([
    "{{-- Nada de wire:model aquí --}}\n<input>",
    "/**\n * Nada de localStorage (ADR 0003).\n */\nexport const a = 1;",
    "// no uses wire:model\nconst a = 1;",
    "<!-- ni localStorage -->\n<div></div>",
]);
