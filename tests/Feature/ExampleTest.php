<?php

declare(strict_types=1);

/**
 * The site root no longer serves Laravel's stock welcome page (English without `__()` and ramp steps
 * DESIGN.md forbids): it redirects to the panel, which is the whole application. See the comment in
 * `routes/web.php`.
 */
test('the site root redirects to the panel', function () {
    $this->get('/')->assertRedirect('/phr');
});
