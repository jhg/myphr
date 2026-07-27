<?php

declare(strict_types=1);

namespace App\Sharing;

use App\Models\ShareLink;
use App\Security\Opaque\Base64Url;
use App\Security\Opaque\InvalidConfigurationException;
use App\Security\Opaque\InvalidMessageException;

/**
 * Decoy salt for `challenge` (ADR 0011).
 *
 * `challenge` returns the `pin_salt` of a live link. If it returned a 404 when the link does not
 * exist, has expired or was revoked, anyone with a list of identifiers would know which ones are
 * still open, and along the way that this person shared something that week. So it always returns a
 * salt of the same shape: the real one if the link is alive, and otherwise one derived by HMAC from
 * a server key over the `linkId`.
 *
 * Two properties the decoy has to satisfy, and the design follows from them:
 *
 * * **Deterministic**: asking twice about the same dead identifier has to give the same salt. A
 *   different random one on each request would give the dead link away on the second try.
 * * **Stable across deployments**: that is why the key does not hang off `APP_KEY`, which is
 *   regenerated on a reinstall. If it changed, comparing today's salt with yesterday's would
 *   separate live from dead links again.
 *
 * The key comes from `config('share.decoy_salt_key')`; if that is not configured, from
 * `config('opaque.enumeration_key')`, which does exactly the same job at login —making an account
 * that does not exist indistinguishable— and is mandatory in any install that can authenticate. If
 * neither is present, this fails loudly: a decoy salt derived from an empty key would be the same on
 * every install in the world and would protect nothing.
 */
final readonly class DecoySalt
{
    /** Domain label, so this HMAC does not collide with any other use of the same key. */
    private const string LABEL = 'myphr/share-decoy-salt/v1';

    /**
     * 16-byte decoy salt for a link identifier, the same size as the real one.
     *
     * @param  string  $linkId  Identifier exactly as it arrived, without assuming it is a UUID: a
     *                          string of any shape also has to get an answer.
     */
    public function for(string $linkId): string
    {
        $mac = hash_hmac('sha256', self::LABEL."\0".$linkId, $this->key(), true);

        return substr($mac, 0, ShareLink::PIN_SALT_BYTES);
    }

    /**
     * @throws InvalidConfigurationException If there is no usable key.
     */
    private function key(): string
    {
        $configured = config('share.decoy_salt_key');
        $fallback = config('opaque.enumeration_key');

        foreach ([$configured, $fallback] as $candidate) {
            if (! is_string($candidate) || $candidate === '') {
                continue;
            }

            try {
                return Base64Url::decodeExactly($candidate, 32, 'decoy salt key');
            } catch (InvalidMessageException $error) {
                throw new InvalidConfigurationException($error->getMessage(), previous: $error);
            }
        }

        throw new InvalidConfigurationException(
            'SHARE_DECOY_SALT_KEY is missing (or, failing that, OPAQUE_ENUMERATION_KEY): without it the decoy salt protects nothing.',
        );
    }
}
