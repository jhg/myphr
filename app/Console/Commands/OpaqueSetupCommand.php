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
 * Genera el material estático del servidor OPAQUE (`docs/OPAQUE.md` §12.1).
 *
 * Produce `oprf_seed`, la clave estática (escalar y pública derivada), el
 * registro ficticio de §13.2 y la clave de enumeración de §13.1, y los
 * **imprime** en base64url para copiarlos al entorno. Nunca escribe `.env` ni
 * ningún fichero del repositorio.
 *
 * Ejecutarlo por segunda vez sobre un despliegue con usuarios registrados deja
 * todos los registros existentes inservibles sin ningún error visible: los
 * envelopes están ligados a `server_public_key` y las claves OPRF al
 * `oprf_seed`. Por eso pide confirmación explícita.
 */
#[Signature('opaque:setup')]
#[Description('Genera el material estático del servidor OPAQUE y lo imprime para copiarlo al entorno (no escribe .env).')]
final class OpaqueSetupCommand extends Command
{
    /**
     * @param  RandomSource  $random  Fuente de aleatoriedad del subsistema (§20.3).
     * @return int Código de salida: 0 si se generó, 1 si se abortó.
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
     * Registro ficticio materializado de §13.2 / RFC 9807 §6.3.2.2.
     *
     * ```
     * (fake_sk, fake_client_public_key) = DeriveDiffieHellmanKeyPair(random(Nseed))
     * fake_masking_key                  = random(Nh)
     * fake_envelope                     = zeroes(Nn + Nm)
     * ```
     *
     * El envelope son **ceros**, no bytes aleatorios: el RFC lo define como
     * *"the byte string consisting only of zeros of length Nn + Nm"*. El
     * escalar falso se descarta en cuanto se deriva el par.
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
