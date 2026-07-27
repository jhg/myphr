<?php

declare(strict_types=1);

/**
 * Guardrail: no string literal in `app/Filament/` or in `app/Providers/` may contain Spanish text
 * (detected by characters specific to the language) outside a call to `__()`. It uses PHP's
 * tokenizer instead of a regex over the raw file so it can safely ignore comments, PHPDoc and the
 * argument of `__()` itself.
 *
 * The only deliberate exception is the native name of a language in its own selector
 * (`app/Filament/Pages/Profile.php`), which is never translated: showing a translated "Español"
 * would stop identifying the language for anyone who does not read the current one.
 *
 * `app/Providers/` is in the sweep because the panel user menu is declared there
 * (`PhrPanelProvider::userMenuItems()`), and `->label('Mi perfil')` slipped through that gap,
 * visible from every screen and in Spanish for every supported language.
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
        ->toBe([], "Found Spanish text not wrapped in __():\n".implode("\n", $violations));
});
