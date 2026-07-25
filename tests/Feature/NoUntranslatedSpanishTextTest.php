<?php

declare(strict_types=1);

/**
 * Guardarraíl: ningún literal de cadena en `app/Filament/` ni en `app/Providers/` puede contener
 * texto en castellano (detectado por caracteres propios del idioma) fuera de una llamada a `__()`.
 * Usa el tokenizer de
 * PHP en vez de una regex sobre el fichero crudo para poder ignorar con seguridad comentarios,
 * PHPDoc y el propio argumento de `__()`.
 *
 * La única excepción deliberada es el nombre nativo de un idioma en su propio selector
 * (`app/Filament/Pages/Profile.php`), que no se traduce nunca: mostrar «Español» traducido dejaría
 * de identificar el idioma para quien no lee el idioma en curso.
 *
 * `app/Providers/` entra en el barrido porque el menú de usuario del panel se declara ahí
 * (`PhrPanelProvider::userMenuItems()`), y por ese hueco pasó `->label('Mi perfil')`, visible desde
 * cualquier pantalla y en castellano para los tres idiomas.
 */
test('no Spanish text is hardcoded outside __() in app/Filament and app/Providers', function () {
    $spanishCharsPattern = '/[áéíóúñÁÉÍÓÚÑ¿¡]/u';

    $exemptLiterals = [
        'app/Filament/Pages/Profile.php' => ['Español'],
    ];

    $basePath = base_path();

    $files = new AppendIterator;

    foreach (['/app/Filament', '/app/Providers'] as $root) {
        $files->append(new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($basePath.$root, FilesystemIterator::SKIP_DOTS)
        ));
    }

    $violations = [];

    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $relativePath = ltrim(str_replace($basePath, '', $file->getPathname()), '/');
        $tokens = token_get_all(file_get_contents($file->getPathname()));

        $line = 1;
        $insideDunderCallDepth = null;
        $parenDepth = 0;
        $pendingDunderCall = false;

        foreach ($tokens as $token) {
            if (is_array($token)) {
                [$id, $text] = $token;
                $tokenLine = $token[2];

                if ($id === T_COMMENT || $id === T_DOC_COMMENT) {
                    $line = $tokenLine + substr_count($text, "\n");

                    continue;
                }

                if ($id === T_WHITESPACE) {
                    $line = $tokenLine + substr_count($text, "\n");

                    continue;
                }

                if ($id === T_STRING && $text === '__') {
                    $pendingDunderCall = true;
                    $line = $tokenLine;

                    continue;
                }

                if ($id === T_CONSTANT_ENCAPSED_STRING || $id === T_ENCAPSED_AND_WHITESPACE) {
                    $isExempt = $insideDunderCallDepth !== null;

                    if (! $isExempt && preg_match($spanishCharsPattern, $text) === 1) {
                        $literal = trim($text, "'\"");

                        $skip = in_array($literal, $exemptLiterals[$relativePath] ?? [], true);

                        if (! $skip) {
                            $violations[] = sprintf('%s:%d: %s', $relativePath, $tokenLine, $text);
                        }
                    }

                    $line = $tokenLine + substr_count($text, "\n");
                    $pendingDunderCall = false;

                    continue;
                }

                $line = $tokenLine;
                $pendingDunderCall = false;

                continue;
            }

            // Simple char tokens: '(' , ')', etc.
            if ($token === '(') {
                if ($pendingDunderCall) {
                    $insideDunderCallDepth = $parenDepth;
                }
                $pendingDunderCall = false;
                $parenDepth++;

                continue;
            }

            if ($token === ')') {
                $parenDepth--;

                if ($insideDunderCallDepth !== null && $parenDepth <= $insideDunderCallDepth) {
                    $insideDunderCallDepth = null;
                }

                continue;
            }

            $pendingDunderCall = false;
        }
    }

    expect($violations)
        ->toBe([], "Se encontró texto en castellano sin envolver en __():\n".implode("\n", $violations));
});
