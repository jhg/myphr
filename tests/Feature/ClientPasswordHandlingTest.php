<?php

declare(strict_types=1);

/**
 * Permanent guardrail from Spec 0001 §5 (steps 2 and 17), §9 and ADR 0003.
 *
 * The password and the master key live in the scope of an ES module and in the DOM node they are
 * read from, and nowhere else. Four mechanisms would take them out of there without anyone noticing:
 *
 * * `wire:model` puts the value in the Livewire `snapshot`, which travels to the server and stays in
 *   the DOM snapshot the component keeps.
 * * `$entangle` is the same thing from the Alpine side: it syncs the property with the server.
 * * Alpine's `$persist` writes to `localStorage` by default.
 * * `localStorage` survives closing the tab and the browser, so any material written there stops
 *   being tied to the lifetime of the session (ADR 0003).
 *
 * This test scans the whole client codebase (all of `resources/js` and all of `resources/views`),
 * not only the files that touch the password today: the rule is easier to hold up if it does not
 * depend on guessing which file is "the password one". Mentions in comments are allowed, because
 * documenting why something is forbidden is exactly what keeps the ban alive.
 */
const FORBIDDEN_CLIENT_STATE_PATTERNS = [
    'wire:model' => '/wire:model/i',
    '$entangle' => '/\$entangle\b/',
    '$persist' => '/\$persist\b/',
    'localStorage' => '/\blocalStorage\b/',
];

/**
 * Every client file, with its path relative to the repository.
 *
 * @return array<string, string> Relative path => contents.
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
 * Strips the comments from a Blade or JavaScript file, so a mention in prose does not count as a
 * use. Line breaks are kept so the line number of a finding still matches the real file.
 */
function withoutComments(string $source): string
{
    $patterns = [
        '/\{\{--.*?--\}\}/s',   // Blade
        '/<!--.*?-->/s',        // HTML
        '/\/\*.*?\*\//s',       // Bloque de JS y de PHP
        '/(?<![:\\\\])\/\/[^\n]*/',  // JS and PHP line comments, without swallowing `https://`
        '/(?<!\$)#[^\n\[][^\n]*/',   // PHP line comment with `#`, without touching `#[...]` attributes
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

it('lets no client file take the password out of the DOM or memory', function (): void {
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

/** The scan is worth little if it looks at an empty list or if the comment filter eats everything. */
it('really scans the client code', function (): void {
    $files = clientSourceFiles();

    expect(count($files))->toBeGreaterThan(15)
        ->and($files)->toHaveKey('resources/js/auth/loginPage.js')
        ->and($files)->toHaveKey('resources/js/auth/setPasswordPage.js')
        ->and($files)->toHaveKey('resources/views/phr/auth/login.blade.php');

    expect(withoutComments((string) $files['resources/js/auth/loginPage.js']))
        ->toContain('export');
});

/** And even less if it does not detect the use it is after. */
it('detects every forbidden pattern when it appears outside a comment', function (string $snippet): void {
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

/** And it is no good either if it counts as a use what is only prose. */
it('does not count mentions inside comments', function (string $snippet): void {
    expect(withoutComments($snippet))->not->toMatch('/wire:model|localStorage/');
})->with([
    "{{-- No wire:model here --}}\n<input>",
    "/**\n * Nada de localStorage (ADR 0003).\n */\nexport const a = 1;",
    "// no uses wire:model\nconst a = 1;",
    "<!-- ni localStorage -->\n<div></div>",
]);

/**
 * No form in our own views may declare `method` or `action`.
 *
 * With those two attributes, a native submit (Enter before Alpine hydrates, an `app.js` that did not
 * load, a stale bundle after a deployment) sends the whole form to the OPAQUE endpoint over POST,
 * with the password in the clear in the body. CSRF answers 419, but the data has already travelled
 * and is already in the PHP process memory, exposed to any request body capture. The only barrier
 * would be `x-on:submit.prevent`, which does not exist until Alpine initializes.
 *
 * All the state of these forms travels through `x-ref` and `data-*` attributes, so neither the
 * `method`, nor the `action`, nor a `name` on a password field has any legitimate use here.
 */
it('lets no native form submit send anything to the server', function (): void {
    $offences = [];

    foreach (clientSourceFiles() as $path => $source) {
        if (! str_ends_with($path, '.blade.php')) {
            continue;
        }

        $code = withoutComments($source);

        preg_match_all('/<form\b[^>]*>/is', $code, $forms, PREG_OFFSET_CAPTURE);

        foreach ($forms[0] as [$tag, $offset]) {
            $line = substr_count(substr($code, 0, (int) $offset), "\n") + 1;

            foreach (['method', 'action'] as $attribute) {
                if (preg_match('/\s'.$attribute.'\s*=/i', $tag) === 1) {
                    $offences[] = "{$path}:{$line} declara «{$attribute}» en un <form>";
                }
            }
        }

        preg_match_all('/<input\b[^>]*>/is', $code, $inputs, PREG_OFFSET_CAPTURE);

        foreach ($inputs[0] as [$tag, $offset]) {
            if (preg_match('/type\s*=\s*"password"/i', $tag) !== 1) {
                continue;
            }

            if (preg_match('/\sname\s*=/i', $tag) === 1) {
                $line = substr_count(substr($code, 0, (int) $offset), "\n") + 1;
                $offences[] = "{$path}:{$line} declara «name» en un campo de contraseña";
            }
        }
    }

    expect($offences)->toBe([]);
});

/** The scan above is worth little if it does not look at real forms and does not detect the flaw. */
it('looks at the password forms and detects the forbidden attribute', function (): void {
    $blades = array_filter(
        clientSourceFiles(),
        static fn (string $path): bool => str_ends_with($path, '.blade.php'),
        ARRAY_FILTER_USE_KEY,
    );

    $forms = 0;
    $passwordInputs = 0;

    foreach ($blades as $source) {
        $code = withoutComments($source);
        $forms += preg_match_all('/<form\b[^>]*>/is', $code);
        $passwordInputs += preg_match_all('/<input\b[^>]*type\s*=\s*"password"[^>]*>/is', $code);
    }

    expect($forms)->toBeGreaterThanOrEqual(5)
        ->and($passwordInputs)->toBeGreaterThanOrEqual(5);

    $offending = '<form method="post" action="/phr/auth/opaque/login/start">'
        .'<input type="password" name="password"></form>';

    expect(preg_match('/<form\b[^>]*\smethod\s*=/i', $offending))->toBe(1)
        ->and(preg_match('/<input\b[^>]*type\s*=\s*"password"[^>]*\sname\s*=/i', $offending))->toBe(1);
});
