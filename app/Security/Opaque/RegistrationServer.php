<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Server side of the registration phase (`docs/OPAQUE.md` §10.2 and §10.4;
 * RFC 9807 §5.2.2).
 *
 * The server takes part in registration only twice: it evaluates the OPRF over
 * the client's blinded point and, later, receives the already built
 * `RegistrationRecord`. It never sees the password, nor
 * `randomized_password`, nor `export_key`, and it cannot open the `envelope`.
 */
final class RegistrationServer
{
    public function __construct(private readonly ServerSetup $setup) {}

    /**
     * `CreateRegistrationResponse(request, server_public_key, credential_identifier, oprf_seed)`
     * from RFC 9807 §5.2.2 (`docs/OPAQUE.md` §10.2).
     *
     * ```
     * seed = Expand(oprf_seed, concat(credential_identifier, "OprfKey"), Nok)
     * (oprf_key, _) = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")
     *
     * blinded_element   = DeserializeElement(request.blinded_message)
     * evaluated_element = BlindEvaluate(oprf_key, blinded_element)
     *
     * response = SerializeElement(evaluated_element) || server_public_key
     * ```
     *
     * `DeserializeElement` has already been done by {@see RegistrationRequest},
     * which validates the point on construction (length, canonicity, group
     * membership and rejection of the identity, RFC 9807 §10.7).
     *
     * The `credential_identifier` must be exactly 32 bytes
     * (`docs/OPAQUE.md` §13.1): RFC 9807 §5.2.2 concatenates it with `"OprfKey"`
     * without a length prefix, so variable lengths would open up domain
     * collisions.
     *
     * @param  RegistrationRequest  $request  Client message, 32 already validated bytes.
     * @param  string  $credentialIdentifier  Binary identifier of 32 bytes (§13.1).
     * @return RegistrationResponse Response of 64 bytes,
     *                              `evaluated_message || server_public_key`.
     *
     * @throws InvalidConfigurationException If the `credential_identifier` is not 32 bytes long.
     * @throws InvalidPointException If the OPRF evaluation yields the identity
     *                               or some group operation fails.
     * @throws OpaqueException If `DeriveKeyPair` exhausts the counter (negligible
     *                         probability; §10.2 says to pick another
     *                         `credential_identifier` and retry).
     */
    public function createRegistrationResponse(
        RegistrationRequest $request,
        string $credentialIdentifier,
    ): RegistrationResponse {
        $identifierLength = strlen($credentialIdentifier);

        if ($identifierLength !== OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES) {
            throw new InvalidConfigurationException(
                'Credential identifier must be '.OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES
                    ." bytes, got {$identifierLength}."
            );
        }

        $oprfKey = Oprf::deriveOprfKey($this->setup->oprfSeed, $credentialIdentifier);

        $evaluatedMessage = Oprf::blindEvaluate($oprfKey, $request->blindedMessage);

        return new RegistrationResponse($evaluatedMessage, $this->setup->serverPublicKey);
    }
}
