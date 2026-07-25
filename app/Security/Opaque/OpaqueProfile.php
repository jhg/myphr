<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Perfil criptográfico único de este despliegue (`docs/OPAQUE.md` §2).
 *
 * `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1`:
 *
 * - OPAQUE RFC 9807, instanciación 3DH.
 * - OPRF RFC 9497, suite `ristretto255-SHA512`, `modeOPRF = 0x00`.
 * - Grupo AKE ristretto255 (RFC 9496), Hash SHA-512, KDF HKDF-SHA-512
 *   (RFC 5869), MAC HMAC-SHA-512 (RFC 2104).
 * - KSF Argon2id v0x13, m=65536 KiB, t=3, p=4: se ejecuta **sólo en el
 *   cliente**, el servidor nunca lo invoca.
 * - `context` del preamble vacío (`ctx0`).
 *
 * El nombre incluye los parámetros del KSF y el contexto porque RFC 9807 §7
 * define la configuración como la tupla (OPRF, KDF, MAC, Hash, KSF, Group,
 * Context): dos despliegues con distinto KSF son incompatibles y el fallo se
 * manifiesta como «contraseña incorrecta».
 *
 * No hay negociación de suites ni se aceptan identificadores enviados por el
 * cliente. Las longitudes de los mensajes de §6 se derivan de las constantes
 * de tamaño de §2 y se exponen aquí ya calculadas.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9807 RFC 9807 §2, §7
 */
final class OpaqueProfile
{
    /** Nombre versionado del perfil; se persiste junto a cada registro (§2). */
    public const string NAME = 'OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1';

    /** `Nh` — salida de Hash (SHA-512), en bytes. */
    public const int NH = 64;

    /** `Nx` — salida de Extract (HKDF-SHA-512), en bytes. */
    public const int NX = 64;

    /** `Nm` — salida de MAC (HMAC-SHA-512), en bytes. */
    public const int NM = 64;

    /** `Nn` — longitud de los nonces, en bytes. */
    public const int NN = 32;

    /** `Nseed` — longitud de las semillas, en bytes. */
    public const int NSEED = 32;

    /** `Npk` — clave pública ristretto255 serializada, en bytes. */
    public const int NPK = 32;

    /** `Nsk` — clave privada (escalar) ristretto255, en bytes. */
    public const int NSK = 32;

    /** `Noe` — elemento OPRF serializado, en bytes. */
    public const int NOE = 32;

    /** `Nok` — clave privada OPRF, en bytes. */
    public const int NOK = 32;

    /** `oprf_seed` del servidor: `Nh` bytes (§12). */
    public const int OPRF_SEED_BYTES = self::NH;

    /**
     * `credential_identifier`: 32 bytes fijos (§13.1).
     *
     * La longitud fija es obligatoria porque RFC 9807 §5.2.2 concatena
     * `credential_identifier || "OprfKey"` sin prefijo de longitud.
     */
    public const int CREDENTIAL_IDENTIFIER_BYTES = 32;

    /** `Envelope` = `envelope_nonce[Nn] || auth_tag[Nm]` (§6.1, RFC 9807 §4.1.1). */
    public const int ENVELOPE_BYTES = self::NN + self::NM;

    /** `RegistrationRequest` = `blinded_message[Noe]` (§6.1). */
    public const int REGISTRATION_REQUEST_BYTES = self::NOE;

    /** `RegistrationResponse` = `evaluated_message[Noe] || server_public_key[Npk]` (§6.1). */
    public const int REGISTRATION_RESPONSE_BYTES = self::NOE + self::NPK;

    /**
     * `RegistrationRecord` = `client_public_key[Npk] || masking_key[Nh] || envelope[96]`
     * (§6.1).
     */
    public const int REGISTRATION_RECORD_BYTES = self::NPK + self::NH + self::ENVELOPE_BYTES;

    /** `CredentialRequest` = `blinded_message[Noe]` (§6.2). */
    public const int CREDENTIAL_REQUEST_BYTES = self::NOE;

    /** `AuthRequest` = `client_nonce[Nn] || client_public_keyshare[Npk]` (§6.2). */
    public const int AUTH_REQUEST_BYTES = self::NN + self::NPK;

    /** `KE1` = `credential_request || auth_request` (§6.2). */
    public const int KE1_BYTES = self::CREDENTIAL_REQUEST_BYTES + self::AUTH_REQUEST_BYTES;

    /** `masked_response` = `pad XOR (server_public_key || envelope)`, `Npk + Nn + Nm` (§6.2). */
    public const int MASKED_RESPONSE_BYTES = self::NPK + self::ENVELOPE_BYTES;

    /**
     * `CredentialResponse` = `evaluated_message[Noe] || masking_nonce[Nn] || masked_response`
     * (§6.2).
     */
    public const int CREDENTIAL_RESPONSE_BYTES = self::NOE + self::NN + self::MASKED_RESPONSE_BYTES;

    /**
     * `AuthResponse` = `server_nonce[Nn] || server_public_keyshare[Npk] || server_mac[Nm]`
     * (§6.2).
     */
    public const int AUTH_RESPONSE_BYTES = self::NN + self::NPK + self::NM;

    /** `KE2` = `credential_response || auth_response` (§6.2). */
    public const int KE2_BYTES = self::CREDENTIAL_RESPONSE_BYTES + self::AUTH_RESPONSE_BYTES;

    /** `KE3` = `client_mac[Nm]` (§6.2). */
    public const int KE3_BYTES = self::NM;

    /** `ServerLoginState` = `expected_client_mac[Nm] || session_key[Nx]` (§6.3). */
    public const int SERVER_LOGIN_STATE_BYTES = self::NM + self::NX;

    /** Longitud máxima de un vector `<1..2^16-1>` de `CleartextCredentials` (§6.4). */
    public const int MAX_IDENTITY_BYTES = 0xFFFF;

    private function __construct() {}
}
