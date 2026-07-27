<?php

declare(strict_types=1);

use App\Security\Opaque\ExpandMessageXmdSha512;

/**
 * Official RFC 9380 vectors, Appendix K.3 "expand_message_xmd(SHA-512)".
 * Source: https://www.rfc-editor.org/rfc/rfc9380.txt
 *
 * name = expand_message_xmd
 * DST  = QUUX-V01-CS02-with-expander-SHA512-256
 * hash = SHA512
 * k    = 256
 */
const RFC9380_K3_DST = 'QUUX-V01-CS02-with-expander-SHA512-256';

/** msg of the "q128_..." vector from RFC 9380 §K.3: "q128_" followed by 128 q letters (133 bytes). */
const RFC9380_MSG_Q128 = 'q128_qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

/** msg of the "a512_..." vector from RFC 9380 §K.3: "a512_" followed by 512 a letters (517 bytes). */
const RFC9380_MSG_A512 = 'a512_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/**
 * The ten vectors from RFC 9380 §K.3, all with the same DST.
 *
 * @var array<string, array{0: array{msg: string, len_in_bytes: int, uniform_bytes: string}}>
 */
const RFC9380_K3_VECTORS = [
    'empty msg, len 0x20' => [[
        'msg' => '',
        'len_in_bytes' => 0x20,
        'uniform_bytes' => '6b9a7312411d92f921c6f68ca0b6380730a1a4d982c507211a90964c394179ba',
    ]],
    'abc, len 0x20' => [[
        'msg' => 'abc',
        'len_in_bytes' => 0x20,
        'uniform_bytes' => '0da749f12fbe5483eb066a5f595055679b976e93abe9be6f0f6318bce7aca8dc',
    ]],
    'abcdef0123456789, len 0x20' => [[
        'msg' => 'abcdef0123456789',
        'len_in_bytes' => 0x20,
        'uniform_bytes' => '087e45a86e2939ee8b91100af1583c4938e0f5fc6c9db4b107b83346bc967f58',
    ]],
    'q128_, len 0x20' => [[
        'msg' => RFC9380_MSG_Q128,
        'len_in_bytes' => 0x20,
        'uniform_bytes' => '7336234ee9983902440f6bc35b348352013becd88938d2afec44311caf8356b3',
    ]],
    'a512_, len 0x20' => [[
        'msg' => RFC9380_MSG_A512,
        'len_in_bytes' => 0x20,
        'uniform_bytes' => '57b5f7e766d5be68a6bfe1768e3c2b7f1228b3e4b3134956dd73a59b954c66f4',
    ]],
    'empty msg, len 0x80' => [[
        'msg' => '',
        'len_in_bytes' => 0x80,
        'uniform_bytes' => '41b037d1734a5f8df225dd8c7de38f851efdb45c372887be655212d07251b921b052b62eaed99b46f72f2ef4cc96bfaf254ebbbec091e1a3b9e4fb5e5b619d2e0c5414800a1d882b62bb5cd1778f098b8eb6cb399d5d9d18f5d5842cf5d13d7eb00a7cff859b605da678b318bd0e65ebff70bec88c753b159a805d2c89c55961',
    ]],
    'abc, len 0x80' => [[
        'msg' => 'abc',
        'len_in_bytes' => 0x80,
        'uniform_bytes' => '7f1dddd13c08b543f2e2037b14cefb255b44c83cc397c1786d975653e36a6b11bdd7732d8b38adb4a0edc26a0cef4bb45217135456e58fbca1703cd6032cb1347ee720b87972d63fbf232587043ed2901bce7f22610c0419751c065922b488431851041310ad659e4b23520e1772ab29dcdeb2002222a363f0c2b1c972b3efe1',
    ]],
    'abcdef0123456789, len 0x80' => [[
        'msg' => 'abcdef0123456789',
        'len_in_bytes' => 0x80,
        'uniform_bytes' => '3f721f208e6199fe903545abc26c837ce59ac6fa45733f1baaf0222f8b7acb0424814fcb5eecf6c1d38f06e9d0a6ccfbf85ae612ab8735dfdf9ce84c372a77c8f9e1c1e952c3a61b7567dd0693016af51d2745822663d0c2367e3f4f0bed827feecc2aaf98c949b5ed0d35c3f1023d64ad1407924288d366ea159f46287e61ac',
    ]],
    'q128_, len 0x80' => [[
        'msg' => RFC9380_MSG_Q128,
        'len_in_bytes' => 0x80,
        'uniform_bytes' => 'b799b045a58c8d2b4334cf54b78260b45eec544f9f2fb5bd12fb603eaee70db7317bf807c406e26373922b7b8920fa29142703dd52bdf280084fb7ef69da78afdf80b3586395b433dc66cde048a258e476a561e9deba7060af40adf30c64249ca7ddea79806ee5beb9a1422949471d267b21bc88e688e4014087a0b592b695ed',
    ]],
    'a512_, len 0x80' => [[
        'msg' => RFC9380_MSG_A512,
        'len_in_bytes' => 0x80,
        'uniform_bytes' => '05b0bfef265dcee87654372777b7c44177e2ae4c13a27f103340d9cd11c86cb2426ffcad5bd964080c2aee97f03be1ca18e30a1f14e27bc11ebbd650f305269cc9fb1db08bf90bfc79b42a952b46daf810359e7bc36452684784a64952c343c52e5124cd1f71d474d5197fefc571a92929c9084ffe1112cf5eea5192ebff330b',
    ]],
];

it('reproduces the RFC 9380 appendix K.3 expand_message_xmd(SHA-512) vectors', function (array $vector): void {
    $uniformBytes = ExpandMessageXmdSha512::expand(
        $vector['msg'],
        RFC9380_K3_DST,
        $vector['len_in_bytes'],
    );

    expect(bin2hex($uniformBytes))->toBe($vector['uniform_bytes'])
        ->and(strlen($uniformBytes))->toBe($vector['len_in_bytes']);
})->with(RFC9380_K3_VECTORS);

it('checks the msg_prime encoding of the first K.3 vector', function (): void {
    // msg_prime of the first RFC 9380 §K.3 vector (msg = "", len_in_bytes = 0x20).
    $expectedMsgPrime = str_repeat('00', 128)
        .'0020'
        .'00'
        .bin2hex(RFC9380_K3_DST).'26';

    $msgPrime = str_repeat("\x00", 128)
        .''
        .pack('n', 0x20)
        .chr(0)
        .RFC9380_K3_DST.chr(strlen(RFC9380_K3_DST));

    expect(bin2hex($msgPrime))->toBe($expectedMsgPrime)
        // DST_prime exactly as it appears in the official vector.
        ->and(bin2hex(RFC9380_K3_DST).'26')
        ->toBe('515555582d5630312d435330322d776974682d657870616e6465722d5348413531322d32353626');
});

it('returns exactly the requested length for non multiples of 64', function (int $length): void {
    expect(strlen(ExpandMessageXmdSha512::expand('msg', RFC9380_K3_DST, $length)))->toBe($length);
})->with([1, 63, 64, 65, 127, 128, 129, 255]);

it('binds len_in_bytes into the output so different lengths do not share a prefix', function (): void {
    $short = ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 32);
    $long = ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 128);

    // Different len_in_bytes go into the hash, so they must NOT match (RFC 9380 §5.3.1, step 5).
    expect(substr($long, 0, 32))->not->toBe($short);
});

it('returns an empty string for len_in_bytes = 0', function (): void {
    expect(ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 0))->toBe('');
});

it('rejects a negative len_in_bytes', function (): void {
    ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, -1);
})->throws(InvalidArgumentException::class);

it('rejects len_in_bytes greater than 65535', function (): void {
    ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 65536);
})->throws(InvalidArgumentException::class);

it('rejects ell greater than 255', function (): void {
    // 255 * 64 = 16320 is the maximum allowed; 16321 would need ell = 256.
    expect(strlen(ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 255 * 64)))->toBe(255 * 64);

    ExpandMessageXmdSha512::expand('abc', RFC9380_K3_DST, 255 * 64 + 1);
})->throws(InvalidArgumentException::class);

it('hashes DSTs longer than 255 bytes as required by RFC 9380 section 5.3.3', function (): void {
    $longDst = str_repeat('D', 256);
    $reducedDst = hash('sha512', 'H2C-OVERSIZE-DST-'.$longDst, true);

    expect(ExpandMessageXmdSha512::expand('abc', $longDst, 64))
        ->toBe(ExpandMessageXmdSha512::expand('abc', $reducedDst, 64));
});

it('does not reduce a DST of exactly 255 bytes', function (): void {
    $dst255 = str_repeat('D', 255);
    $reducedDst = hash('sha512', 'H2C-OVERSIZE-DST-'.$dst255, true);

    expect(ExpandMessageXmdSha512::expand('abc', $dst255, 64))
        ->not->toBe(ExpandMessageXmdSha512::expand('abc', $reducedDst, 64));
});

it('separates domains by DST', function (): void {
    expect(ExpandMessageXmdSha512::expand('abc', 'DST-A', 64))
        ->not->toBe(ExpandMessageXmdSha512::expand('abc', 'DST-B', 64));
});

it('encodes DST length suffix-free', function (): void {
    // ("AB", "CDEF") y ("ABC", "DEF") deben dar salidas distintas (RFC 9380 §5.3.4).
    expect(ExpandMessageXmdSha512::expand('AB', 'CDEF', 64))
        ->not->toBe(ExpandMessageXmdSha512::expand('ABC', 'DEF', 64));
});

it('handles binary messages with NUL bytes', function (): void {
    $message = "\x00\x01\x00\xff\x00";

    expect(strlen(ExpandMessageXmdSha512::expand($message, RFC9380_K3_DST, 64)))->toBe(64)
        ->and(ExpandMessageXmdSha512::expand($message, RFC9380_K3_DST, 64))
        ->not->toBe(ExpandMessageXmdSha512::expand("\x00\x01\x00\xff", RFC9380_K3_DST, 64));
});
