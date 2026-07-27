<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Security\Opaque\Base64Url;
use App\Security\Opaque\OpaqueProfile;
use App\Security\Opaque\Oprf;
use App\Security\Opaque\RandomSource;
use App\Security\Opaque\RegistrationRecord;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Generates the static material of the OPAQUE server (`docs/OPAQUE.md` §12.1).
 *
 * It produces `oprf_seed`, the static key (scalar and derived public key), the
 * fake record from §13.2 and the enumeration key from §13.1, and **prints** them
 * as base64url so they can be copied into the environment. It never writes
 * `.env` or any file in the repository.
 *
 * Running it a second time on a deployment with registered users leaves every
 * existing registration useless with no visible error: the envelopes are tied to
 * `server_public_key` and the OPRF keys to the `oprf_seed`. That is why it asks
 * for explicit confirmation.
 */
#[Signature('opaque:setup')]
#[Description('Genera el material estático del servidor OPAQUE y lo imprime para copiarlo al entorno (no escribe .env).')]
final class OpaqueSetupCommand extends Command
{
    /**
     * @param  RandomSource  $random  Source of randomness for the subsystem (§20.3).
     * @return int Exit code: 0 if it generated, 1 if it aborted.
     */
    public function handle(RandomSource $random): int
    {
        $this->warnAboutDestruction();

        if (! $this->confirm('¿Generar un setup OPAQUE nuevo?', false)) {
            $this->components->info('Cancelado. No se ha generado nada.');

            return self::FAILURE;
        }

        $oprfSeed = $random->bytes(OpaqueProfile::OPRF_SEED_BYTES);

        [$serverPrivateKey, $serverPublicKey] = Oprf::deriveDiffieHellmanKeyPair(
            $random->bytes(OpaqueProfile::NSEED)
        );

        $fakeRecord = $this->generateFakeRegistrationRecord($random);
        $enumerationKey = $random->bytes(OpaqueProfile::NSK);

        $this->newLine();
        $this->line('OPAQUE_PROFILE='.OpaqueProfile::NAME);
        $this->line('OPAQUE_OPRF_SEED='.Base64Url::encode($oprfSeed));
        $this->line('OPAQUE_SERVER_PRIVATE_KEY='.Base64Url::encode($serverPrivateKey));
        $this->line('OPAQUE_SERVER_PUBLIC_KEY='.Base64Url::encode($serverPublicKey));
        $this->line('OPAQUE_FAKE_REGISTRATION_RECORD='.$fakeRecord->toBase64Url());
        $this->line('OPAQUE_SERVER_IDENTITY=');
        $this->line('OPAQUE_ENUMERATION_KEY='.Base64Url::encode($enumerationKey));
        $this->line('OPAQUE_CONTEXT=');
        $this->newLine();

        $this->components->info('Copia estas líneas al entorno. El comando no escribe ningún fichero.');
        $this->components->bulletList([
            'OPAQUE_SERVER_IDENTITY lo eliges tú y debe coincidir carácter a carácter con `identifiers.server` del cliente (§12.2).',
            'OPAQUE_SERVER_PRIVATE_KEY es el escalar derivado, no la semilla de la que salió.',
            'OPAQUE_SERVER_PUBLIC_KEY es opcional: se deriva del escalar en el arranque y sólo sirve para contrastarla.',
            'OPAQUE_CONTEXT queda vacía en este perfil (`ctx0`).',
        ]);

        return self::SUCCESS;
    }

    /**
     * Materialized fake record from §13.2 / RFC 9807 §6.3.2.2.
     *
     * ```
     * (fake_sk, fake_client_public_key) = DeriveDiffieHellmanKeyPair(random(Nseed))
     * fake_masking_key                  = random(Nh)
     * fake_envelope                     = zeroes(Nn + Nm)
     * ```
     *
     * The envelope is **zeros**, not random bytes: the RFC defines it as
     * *"the byte string consisting only of zeros of length Nn + Nm"*. The fake
     * scalar is discarded as soon as the pair is derived.
     */
    private function generateFakeRegistrationRecord(RandomSource $random): RegistrationRecord
    {
        [, $fakeClientPublicKey] = Oprf::deriveDiffieHellmanKeyPair(
            $random->bytes(OpaqueProfile::NSEED)
        );

        return new RegistrationRecord(
            $fakeClientPublicKey,
            $random->bytes(OpaqueProfile::NH),
            str_repeat("\x00", OpaqueProfile::ENVELOPE_BYTES),
        );
    }

    /**
     * Advertencia previa exigida por §12.1, puntos 7 y 8.
     */
    private function warnAboutDestruction(): void
    {
        $this->newLine();
        $this->line('ATENCIÓN: esto genera un setup OPAQUE nuevo.');
        $this->line('Perder o cambiar el setup inutiliza todos los registros.');
        $this->line('Los usuarios ya registrados quedan fuera sin error visible:');
        $this->line('sus logins fallarán como «contraseña incorrecta».');
        $this->newLine();
        $this->components->bulletList([
            'Los envelopes están ligados a `server_public_key` y las claves OPRF a `oprf_seed`.',
            'No hay recuperación: la clave maestra de cada usuario se abre a través de este material.',
            'Ejecútalo una sola vez, antes del primer registro.',
            'Guarda el resultado en el gestor de secretos del despliegue.',
        ]);
        $this->newLine();
    }
}
