<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * `credential_identifier` from `docs/OPAQUE.md` §13.1.
 *
 * ```
 * credential_identifier = HMAC-SHA-256(OPAQUE_ENUMERATION_KEY, normalize(login))   // 32 bytes
 * ```
 *
 * Deterministic and **the same value for real and non-existent accounts**: that is what makes an
 * attacker who replays the same `blinded_message` before and after a signup get the same
 * `evaluated_message` (RFC 9807 §10.9). That is why it cannot be random per registration or be
 * regenerated on a password change.
 *
 * Normalization comes from {@see LoginNormalizer} and from nowhere else (§13.1.1): if the database
 * lookup and this HMAC diverge, an enumeration oracle appears in two requests.
 */
final readonly class CredentialIdentifier
{
    /** Output length, in bytes (§13.1). */
    public const int LENGTH = OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES;

    /** Length required of `OPAQUE_ENUMERATION_KEY`, in bytes. */
    public const int KEY_LENGTH = 32;

    /**
     * @param  string  $enumerationKey  `OPAQUE_ENUMERATION_KEY` in binary, 32 bytes. It must differ
     *                                  from `APP_KEY`, from the `oprf_seed` and from the static key.
     *
     * @throws InvalidConfigurationException If the key is not 32 bytes long.
     */
    public function __construct(private string $enumerationKey)
    {
        if (strlen($this->enumerationKey) !== self::KEY_LENGTH) {
            throw new InvalidConfigurationException(
                'OPAQUE_ENUMERATION_KEY must be '.self::KEY_LENGTH.' bytes, got '
                .strlen($this->enumerationKey).'.'
            );
        }
    }

    /**
     * Builds the deriver from `config('opaque')`.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException If the key is missing, is not canonical base64url or is not 32 bytes long.
     */
    public static function fromConfig(array $config): self
    {
        $key = $config['enumeration_key'] ?? null;

        if (! is_string($key) || $key === '') {
            throw new InvalidConfigurationException('OPAQUE_ENUMERATION_KEY is missing.');
        }

        try {
            $decoded = Base64Url::decodeExactly($key, self::KEY_LENGTH, 'OPAQUE_ENUMERATION_KEY');
        } catch (InvalidMessageException $exception) {
            throw new InvalidConfigurationException(
                'OPAQUE_ENUMERATION_KEY is not canonical base64url of '.self::KEY_LENGTH.' bytes.',
                0,
                $exception
            );
        }

        return new self($decoded);
    }

    /**
     * Derives the identifier of any login, whether the account exists or not (§13.1).
     *
     * @param  string  $login  Identifier exactly as the person typed it; it is normalized here.
     * @return string 32 raw bytes. It never goes through `mb_*` functions.
     */
    public function for(string $login): string
    {
        return hash_hmac('sha256', LoginNormalizer::normalize($login), $this->enumerationKey, true);
    }
}
