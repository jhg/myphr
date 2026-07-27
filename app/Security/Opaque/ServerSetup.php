<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Persistent state of the OPAQUE server (`docs/OPAQUE.md` §12).
 *
 * ```
 * oprf_seed[Nh=64]               PRK each user's OPRF key is derived from (§8.3)
 * server_private_key[Nsk=32]     the already derived SCALAR, not the seed it came from
 * server_public_key[Npk=32]      derived from the private key at boot
 * fake_registration_record[192]  materialized fake record (§13.2)
 * server_identity                stable, versioned UTF-8 string (§6.4)
 * context                        preamble string; empty in this profile (§2, §11.5)
 * ```
 *
 * `OPAQUE_SERVER_PRIVATE_KEY` stores the **scalar**, not the 32-byte seed of
 * `DeriveDiffieHellmanKeyPair`: both are "32 bytes as base64url" and mixing
 * them up produces a public key different from the one clients already have
 * authenticated in their envelopes, with no visible error until every login
 * fails.
 *
 * Loading from configuration is strict and happens at boot (§12.2): canonical
 * base64url, exact lengths, canonicity of the private scalar and a matching
 * profile. Any deviation throws {@see InvalidConfigurationException}. This
 * class **does not generate secrets**: if configuration is missing, it fails;
 * generating them is the explicit job of `php artisan opaque:setup`.
 */
final class ServerSetup
{
    /**
     * @param  string  $oprfSeed  `oprf_seed`, exactly 64 bytes (`Nh`).
     * @param  string  $serverPrivateKey  Server static scalar, 32 canonical non-zero bytes.
     * @param  string  $serverPublicKey  Public key derived from the scalar, 32 bytes.
     * @param  RegistrationRecord  $fakeRegistrationRecord  Fake record from §13.2.
     * @param  string  $serverIdentity  `server_identity` of `CleartextCredentials`, 1..65535 bytes.
     * @param  string  $context  Preamble `context`; empty in this profile.
     * @param  string  $profile  Name of the cryptographic profile (§2).
     *
     * @throws InvalidConfigurationException If a length, the profile, the identity
     *                                       or the context are invalid, or if the
     *                                       private scalar is not canonical.
     */
    public function __construct(
        public readonly string $oprfSeed,
        public readonly string $serverPrivateKey,
        public readonly string $serverPublicKey,
        public readonly RegistrationRecord $fakeRegistrationRecord,
        public readonly string $serverIdentity,
        public readonly string $context = '',
        public readonly string $profile = OpaqueProfile::NAME,
    ) {
        if ($this->profile !== OpaqueProfile::NAME) {
            throw new InvalidConfigurationException(
                'OPAQUE profile must be '.OpaqueProfile::NAME.", got {$this->profile}."
            );
        }

        self::ensureConfiguredLength(
            $this->oprfSeed,
            OpaqueProfile::OPRF_SEED_BYTES,
            'OPAQUE_OPRF_SEED'
        );
        self::ensureConfiguredLength(
            $this->serverPrivateKey,
            OpaqueProfile::NSK,
            'OPAQUE_SERVER_PRIVATE_KEY'
        );
        self::ensureConfiguredLength(
            $this->serverPublicKey,
            OpaqueProfile::NPK,
            'OPAQUE_SERVER_PUBLIC_KEY'
        );

        try {
            Ristretto255::validateScalar($this->serverPrivateKey);
            Ristretto255::validatePoint($this->serverPublicKey);
        } catch (InvalidPointException $exception) {
            throw new InvalidConfigurationException(
                'OPAQUE_SERVER_PRIVATE_KEY is not a canonical non-zero ristretto255 scalar, '
                    .'or its public key is not a valid element.',
                0,
                $exception
            );
        }

        if (! BinaryCodec::constantTimeEquals(
            Ristretto255::scalarMultiplyBase($this->serverPrivateKey),
            $this->serverPublicKey
        )) {
            throw new InvalidConfigurationException(
                'OPAQUE_SERVER_PUBLIC_KEY does not match the public key derived from OPAQUE_SERVER_PRIVATE_KEY.'
            );
        }

        if ($this->serverIdentity === '') {
            throw new InvalidConfigurationException('OPAQUE_SERVER_IDENTITY must not be empty.');
        }

        if (strlen($this->serverIdentity) > OpaqueProfile::MAX_IDENTITY_BYTES) {
            throw new InvalidConfigurationException(
                'OPAQUE_SERVER_IDENTITY must not exceed '.OpaqueProfile::MAX_IDENTITY_BYTES.' bytes.'
            );
        }

        if ($this->context !== '') {
            throw new InvalidConfigurationException(
                'OPAQUE_CONTEXT must be empty in profile '.OpaqueProfile::NAME.' (the name declares ctx0).'
            );
        }
    }

    /**
     * Builds the setup from the application configuration (§12.2), with strict
     * validation meant to run at boot.
     *
     * Expected keys, all mandatory except `server_public_key` and `context`:
     *
     * ```
     * profile                   profile name (§2)
     * oprf_seed                 64 bytes as base64url
     * server_private_key        32 bytes as base64url, the scalar
     * server_public_key         32 bytes as base64url, optional; if present, it must
     *                           match the one derived from the scalar
     * fake_registration_record  192 bytes as base64url (§13.2)
     * server_identity           non-empty UTF-8 string
     * context                   string, empty in this profile
     * ```
     *
     * @param  array<string, mixed>  $config  Normally `config('opaque')`.
     *
     * @throws InvalidConfigurationException If a key is missing, is not a string,
     *                                       is not canonical base64url, does not
     *                                       have the exact length, the scalar is
     *                                       not canonical or the fake record does
     *                                       not validate.
     */
    public static function fromConfig(array $config): self
    {
        $profile = self::requireString($config, 'profile');
        $oprfSeed = self::decodeExactly($config, 'oprf_seed', OpaqueProfile::OPRF_SEED_BYTES);
        $serverPrivateKey = self::decodeExactly($config, 'server_private_key', OpaqueProfile::NSK);

        try {
            Ristretto255::validateScalar($serverPrivateKey);
            $derivedPublicKey = Ristretto255::scalarMultiplyBase($serverPrivateKey);
        } catch (InvalidPointException $exception) {
            throw new InvalidConfigurationException(
                'Configuration key opaque.server_private_key is not a canonical non-zero ristretto255 scalar.',
                0,
                $exception
            );
        }

        if (isset($config['server_public_key']) && $config['server_public_key'] !== '') {
            $configuredPublicKey = self::decodeExactly($config, 'server_public_key', OpaqueProfile::NPK);

            if (! BinaryCodec::constantTimeEquals($configuredPublicKey, $derivedPublicKey)) {
                throw new InvalidConfigurationException(
                    'Configuration key opaque.server_public_key does not match the key derived from '
                        .'opaque.server_private_key.'
                );
            }
        }

        $fakeRecordBytes = self::decodeExactly(
            $config,
            'fake_registration_record',
            OpaqueProfile::REGISTRATION_RECORD_BYTES
        );

        try {
            $fakeRecord = RegistrationRecord::parse($fakeRecordBytes);
        } catch (OpaqueException $exception) {
            throw new InvalidConfigurationException(
                'Configuration key opaque.fake_registration_record is not a valid registration record.',
                0,
                $exception
            );
        }

        return new self(
            $oprfSeed,
            $serverPrivateKey,
            $derivedPublicKey,
            $fakeRecord,
            self::requireString($config, 'server_identity'),
            self::optionalString($config, 'context'),
            $profile,
        );
    }

    /**
     * Reads a mandatory string key.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException If it is missing or is not a string.
     */
    private static function requireString(array $config, string $key): string
    {
        $value = $config[$key] ?? null;

        if (! is_string($value) || $value === '') {
            throw new InvalidConfigurationException("Configuration key opaque.{$key} is missing or not a string.");
        }

        return $value;
    }

    /**
     * Reads an optional string key; absent means the empty string.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException If it is present and is not a string.
     */
    private static function optionalString(array $config, string $key): string
    {
        $value = $config[$key] ?? '';

        if (! is_string($value)) {
            throw new InvalidConfigurationException("Configuration key opaque.{$key} must be a string.");
        }

        return $value;
    }

    /**
     * Decodes a configuration key as canonical base64url and requires the exact
     * binary length (§5, §12.2).
     *
     * @param  array<string, mixed>  $config
     * @param  int<1, max>  $expectedLength
     *
     * @throws InvalidConfigurationException If it is missing, is not a string, is
     *                                       not canonical base64url or the length does not match.
     */
    private static function decodeExactly(array $config, string $key, int $expectedLength): string
    {
        $encoded = self::requireString($config, $key);

        try {
            return Base64Url::decodeExactly($encoded, $expectedLength, "opaque.{$key}");
        } catch (InvalidMessageException $exception) {
            throw new InvalidConfigurationException(
                "Configuration key opaque.{$key} must be canonical base64url of exactly {$expectedLength} bytes.",
                0,
                $exception
            );
        }
    }

    /**
     * Checks a configuration length, translating the error into
     * {@see InvalidConfigurationException}: a wrong size here is a deployment
     * fault, not a malformed remote message (§18).
     *
     * @param  int<1, max>  $expectedLength
     *
     * @throws InvalidConfigurationException If the length does not match.
     */
    private static function ensureConfiguredLength(string $value, int $expectedLength, string $name): void
    {
        $actualLength = strlen($value);

        if ($actualLength !== $expectedLength) {
            throw new InvalidConfigurationException(
                "{$name} must be {$expectedLength} bytes, got {$actualLength}."
            );
        }
    }
}
