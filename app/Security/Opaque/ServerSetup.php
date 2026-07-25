<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Estado persistente del servidor OPAQUE (`docs/OPAQUE.md` §12).
 *
 * ```
 * oprf_seed[Nh=64]               PRK de la que se deriva la clave OPRF de cada usuario (§8.3)
 * server_private_key[Nsk=32]     el ESCALAR ya derivado, no la semilla de la que salió
 * server_public_key[Npk=32]      derivada de la privada en el arranque
 * fake_registration_record[192]  registro ficticio materializado (§13.2)
 * server_identity                cadena UTF-8 estable y versionada (§6.4)
 * context                        cadena del preamble; vacía en este perfil (§2, §11.5)
 * ```
 *
 * `OPAQUE_SERVER_PRIVATE_KEY` guarda el **escalar**, no la semilla de 32
 * bytes de `DeriveDiffieHellmanKeyPair`: ambos son «32 bytes en base64url» y
 * confundirlos produce una clave pública distinta de la que los clientes ya
 * tienen autenticada en sus envelopes, sin ningún error visible hasta que
 * fallan todos los logins.
 *
 * La carga desde configuración es estricta y ocurre en el arranque (§12.2):
 * base64url canónico, longitudes exactas, canonicidad del escalar privado y
 * perfil coincidente. Cualquier desviación lanza
 * {@see InvalidConfigurationException}. Esta clase **no genera secretos**: si
 * falta configuración, falla; generarlos es tarea explícita de
 * `php artisan opaque:setup`.
 */
final class ServerSetup
{
    /**
     * @param  string  $oprfSeed  `oprf_seed`, exactamente 64 bytes (`Nh`).
     * @param  string  $serverPrivateKey  Escalar estático del servidor, 32 bytes canónicos y no cero.
     * @param  string  $serverPublicKey  Clave pública derivada del escalar, 32 bytes.
     * @param  RegistrationRecord  $fakeRegistrationRecord  Registro ficticio de §13.2.
     * @param  string  $serverIdentity  `server_identity` de `CleartextCredentials`, 1..65535 bytes.
     * @param  string  $context  `context` del preamble; vacío en este perfil.
     * @param  string  $profile  Nombre del perfil criptográfico (§2).
     *
     * @throws InvalidConfigurationException Si alguna longitud, el perfil, la
     *                                       identidad o el contexto no son válidos,
     *                                       o si el escalar privado no es canónico.
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
     * Construye el setup a partir de la configuración de la aplicación
     * (§12.2), con validación estricta pensada para ejecutarse en el arranque.
     *
     * Claves esperadas, todas obligatorias salvo `server_public_key` y
     * `context`:
     *
     * ```
     * profile                   nombre del perfil (§2)
     * oprf_seed                 base64url de 64 bytes
     * server_private_key        base64url de 32 bytes, el escalar
     * server_public_key         base64url de 32 bytes, opcional; si está, debe
     *                           coincidir con la derivada del escalar
     * fake_registration_record  base64url de 192 bytes (§13.2)
     * server_identity           cadena UTF-8 no vacía
     * context                   cadena, vacía en este perfil
     * ```
     *
     * @param  array<string, mixed>  $config  Normalmente `config('opaque')`.
     *
     * @throws InvalidConfigurationException Si falta una clave, no es cadena,
     *                                       no es base64url canónico, no tiene la
     *                                       longitud exacta, el escalar no es
     *                                       canónico o el registro ficticio no valida.
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
     * Lee una clave obligatoria de tipo cadena.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException Si falta o no es una cadena.
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
     * Lee una clave opcional de tipo cadena; ausente equivale a cadena vacía.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws InvalidConfigurationException Si está presente y no es una cadena.
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
     * Decodifica una clave de configuración en base64url canónico y exige la
     * longitud binaria exacta (§5, §12.2).
     *
     * @param  array<string, mixed>  $config
     * @param  int<1, max>  $expectedLength
     *
     * @throws InvalidConfigurationException Si falta, no es cadena, no es
     *                                       base64url canónico o la longitud no coincide.
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
     * Comprueba una longitud de configuración, traduciendo el error a
     * {@see InvalidConfigurationException}: un tamaño incorrecto aquí es un
     * fallo de despliegue, no un mensaje remoto malformado (§18).
     *
     * @param  int<1, max>  $expectedLength
     *
     * @throws InvalidConfigurationException Si la longitud no coincide.
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
