<?php

declare(strict_types=1);

namespace App\Security\Opaque;

/**
 * Lado servidor de la fase de registro (`docs/OPAQUE.md` §10.2 y §10.4;
 * RFC 9807 §5.2.2).
 *
 * El servidor sólo interviene dos veces en el registro: evalúa el OPRF sobre
 * el punto cegado del cliente y, después, recibe el `RegistrationRecord` ya
 * construido. Nunca ve la contraseña, ni `randomized_password`, ni
 * `export_key`, y no puede abrir el `envelope`.
 */
final class RegistrationServer
{
    public function __construct(private readonly ServerSetup $setup) {}

    /**
     * `CreateRegistrationResponse(request, server_public_key, credential_identifier, oprf_seed)`
     * de RFC 9807 §5.2.2 (`docs/OPAQUE.md` §10.2).
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
     * `DeserializeElement` ya lo ha hecho {@see RegistrationRequest}, que
     * valida el punto al construirse (longitud, canonicidad, pertenencia al
     * grupo y rechazo de la identidad, RFC 9807 §10.7).
     *
     * El `credential_identifier` debe medir exactamente 32 bytes
     * (`docs/OPAQUE.md` §13.1): RFC 9807 §5.2.2 lo concatena con `"OprfKey"`
     * sin prefijo de longitud, así que longitudes variables abrirían
     * colisiones de dominio.
     *
     * @param  RegistrationRequest  $request  Mensaje del cliente, 32 bytes ya validados.
     * @param  string  $credentialIdentifier  Identificador binario de 32 bytes (§13.1).
     * @return RegistrationResponse Respuesta de 64 bytes,
     *                              `evaluated_message || server_public_key`.
     *
     * @throws InvalidConfigurationException Si el `credential_identifier` no mide 32 bytes.
     * @throws InvalidPointException Si la evaluación OPRF produce la identidad
     *                               o alguna operación de grupo falla.
     * @throws OpaqueException Si `DeriveKeyPair` agota el contador (probabilidad
     *                         negligible; §10.2 manda elegir otro
     *                         `credential_identifier` y repetir).
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
