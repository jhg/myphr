<?php

declare(strict_types=1);

use App\Security\Opaque\ExpandLabel;
use App\Security\Opaque\HkdfSha512;

/**
 * RFC 9807 no publica vectores de Expand-Label en aislado (sus vectores son del
 * protocolo completo), así que aquí se fija la codificación byte a byte de
 * `CustomLabel` contra literales escritos a mano a partir de
 * RFC 9807 §6.4.2.1 y del struct `HkdfLabel` de RFC 8446 §7.1.
 */
it('construye CustomLabel exactamente como RFC 9807 §6.4.2.1', function (): void {
    $secret = str_repeat("\x2a", 64);
    $context = str_repeat("\x01", 64);

    // uint16_be(64) = 0040
    // uint8(len("OPAQUE-SessionKey")) = 17 = 0x11
    // "OPAQUE-SessionKey" en ASCII
    // uint8(len(context)) = 64 = 0x40
    // context = 64 bytes 0x01
    $customLabel = hex2bin('0040').chr(17).'OPAQUE-SessionKey'.chr(64).$context;

    expect(bin2hex($customLabel))->toBe(
        '0040'
        .'11'
        .bin2hex('OPAQUE-SessionKey')
        .'40'
        .str_repeat('01', 64)
    );

    expect(ExpandLabel::expandLabel($secret, 'SessionKey', $context, 64))
        ->toBe(HkdfSha512::expand($secret, $customLabel, 64));
});

it('codifica el contexto vacío como uint8(0) sin bytes adicionales', function (): void {
    $secret = str_repeat("\x2a", 64);

    // uint16_be(64) || uint8(16) || "OPAQUE-ServerMAC" || uint8(0)
    $customLabel = hex2bin('0040').chr(16).'OPAQUE-ServerMAC'.chr(0);

    expect(strlen($customLabel))->toBe(2 + 1 + 16 + 1);

    expect(ExpandLabel::deriveSecret($secret, 'ServerMAC', ''))
        ->toBe(HkdfSha512::expand($secret, $customLabel, 64));
});

it('antepone el prefijo OPAQUE- sin terminador nulo', function (): void {
    expect(ExpandLabel::LABEL_PREFIX)->toBe('OPAQUE-');

    $secret = str_repeat("\x07", 64);

    // Una etiqueta con NUL final debe dar un resultado distinto: no hay terminador.
    expect(ExpandLabel::expandLabel($secret, 'ClientMAC', '', 64))
        ->not->toBe(ExpandLabel::expandLabel($secret, "ClientMAC\x00", '', 64));
});

it('deriveSecret devuelve Nx = 64 bytes con las etiquetas de OPAQUE', function (string $label): void {
    $secret = str_repeat("\x5c", 64);
    $transcriptHash = hash('sha512', 'preamble', true);

    $derived = ExpandLabel::deriveSecret($secret, $label, $transcriptHash);

    expect(strlen($derived))->toBe(64);
    expect($derived)->toBe(ExpandLabel::expandLabel($secret, $label, $transcriptHash, 64));
})->with(['HandshakeSecret', 'SessionKey', 'ServerMAC', 'ClientMAC']);

it('separa dominios: etiquetas o contextos distintos dan secretos distintos', function (): void {
    $secret = str_repeat("\x11", 64);
    $transcriptHash = hash('sha512', 'preamble', true);

    $handshakeSecret = ExpandLabel::deriveSecret($secret, 'HandshakeSecret', $transcriptHash);
    $sessionKey = ExpandLabel::deriveSecret($secret, 'SessionKey', $transcriptHash);

    expect($handshakeSecret)->not->toBe($sessionKey);

    expect(ExpandLabel::deriveSecret($handshakeSecret, 'ServerMAC', ''))
        ->not->toBe(ExpandLabel::deriveSecret($handshakeSecret, 'ClientMAC', ''));

    expect(ExpandLabel::deriveSecret($secret, 'SessionKey', ''))
        ->not->toBe($sessionKey);
});

it('la longitud entra en CustomLabel, así que salidas de distinto tamaño no son prefijo', function (): void {
    $secret = str_repeat("\x3b", 64);

    $short = ExpandLabel::expandLabel($secret, 'SessionKey', '', 32);
    $long = ExpandLabel::expandLabel($secret, 'SessionKey', '', 64);

    expect($short)->not->toBe(substr($long, 0, 32));
});

it('usa big-endian en el campo de longitud', function (): void {
    $secret = str_repeat("\x2a", 64);

    // 256 = 0x0100 en big-endian; en little-endian sería 0x0001.
    $bigEndian = hex2bin('0100').chr(17).'OPAQUE-SessionKey'.chr(0);

    expect(ExpandLabel::expandLabel($secret, 'SessionKey', '', 256))
        ->toBe(HkdfSha512::expand($secret, $bigEndian, 256));
});

it('rechaza etiquetas y contextos que no caben en un uint8', function (): void {
    $secret = str_repeat("\x2a", 64);

    // "OPAQUE-" son 7 bytes: 249 + 7 = 256 > 255.
    expect(fn (): string => ExpandLabel::expandLabel($secret, str_repeat('a', 249), '', 64))
        ->toThrow(InvalidArgumentException::class);

    // 248 + 7 = 255, el máximo admisible.
    expect(strlen(ExpandLabel::expandLabel($secret, str_repeat('a', 248), '', 64)))->toBe(64);

    expect(fn (): string => ExpandLabel::expandLabel($secret, 'SessionKey', str_repeat("\x00", 256), 64))
        ->toThrow(InvalidArgumentException::class);

    expect(strlen(ExpandLabel::expandLabel($secret, 'SessionKey', str_repeat("\x00", 255), 64)))->toBe(64);
});

it('rechaza longitudes que no caben en el uint16 o que exceden HKDF-Expand', function (int $length): void {
    $secret = str_repeat("\x2a", 64);

    expect(fn (): string => ExpandLabel::expandLabel($secret, 'SessionKey', '', $length))
        ->toThrow(InvalidArgumentException::class);
})->with([0, -1, 65536, 16321]);
