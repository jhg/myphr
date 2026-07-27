<?php

declare(strict_types=1);

/**
 * Shared clipping configuration (ADR 0011).
 *
 * There is only one secret here, and it belongs to the **decoy salt** used by `challenge`. When the
 * link does not exist, has expired or was revoked, that route still returns a 16-byte salt derived
 * by HMAC from this key over the `linkId`, so that a dead link and a live one give answers you
 * cannot tell apart.
 *
 * It gets its own entry instead of hanging off `APP_KEY` because the ADR asks for it explicitly:
 * anyone rotates `APP_KEY` on a reinstall, and with it the decoy salt of a given `linkId` would
 * change. That would make dead links distinguishable from live ones again by comparing two
 * deployments, which is exactly the property the decoy salt exists to provide.
 */
return [

    /**
     * HMAC key for the decoy salt, 32 bytes as base64url.
     *
     * If it is missing, `opaque.enumeration_key` is used instead (see `App\Sharing\DecoySalt`). That
     * key plays the same role in OPAQUE —making what does not exist indistinguishable— and is
     * mandatory in any install that can log in at all. There is no default: if that one is missing
     * too, `challenge` fails loudly instead of degrading silently.
     */
    'decoy_salt_key' => env('SHARE_DECOY_SALT_KEY'),

];
