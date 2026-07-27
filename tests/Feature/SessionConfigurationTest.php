<?php

declare(strict_types=1);

/**
 * Configuration guardrail from
 * `docs/specs/0001-account-provisioning-and-session-bootstrap.md` §9.
 *
 * With the `cookie` driver the session contents travel to the browser on every
 * request, and the browser would end up holding both halves of the master key
 * at once (ADR 0003). The session secret lives inside the session payload, so
 * the driver is not a deployment detail.
 */
it('never uses the cookie session driver', function (): void {
    expect(config('session.driver'))->not->toBe('cookie');
});

it('keeps the cookie driver out of the environment files', function (): void {
    foreach (['.env', '.env.example'] as $file) {
        $contents = @file_get_contents(base_path($file));

        if ($contents === false) {
            continue;
        }

        expect($contents)->not->toContain('SESSION_DRIVER=cookie');
    }
});
