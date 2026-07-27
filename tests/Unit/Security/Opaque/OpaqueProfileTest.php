<?php

declare(strict_types=1);

use App\Security\Opaque\OpaqueProfile;

/**
 * Constants of the `OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1` profile
 * (`docs/OPAQUE.md` §2 and §6).
 */
it('names the single supported profile', function (): void {
    expect(OpaqueProfile::NAME)->toBe('OPAQUE-R255-SHA512-A2ID-m65536-t3-p4-ctx0-v1');
});

it('exposes the size constants of section 2', function (): void {
    expect(OpaqueProfile::NH)->toBe(64)
        ->and(OpaqueProfile::NX)->toBe(64)
        ->and(OpaqueProfile::NM)->toBe(64)
        ->and(OpaqueProfile::NN)->toBe(32)
        ->and(OpaqueProfile::NSEED)->toBe(32)
        ->and(OpaqueProfile::NPK)->toBe(32)
        ->and(OpaqueProfile::NSK)->toBe(32)
        ->and(OpaqueProfile::NOE)->toBe(32)
        ->and(OpaqueProfile::NOK)->toBe(32);
});

it('derives the message lengths of section 6', function (): void {
    expect(OpaqueProfile::REGISTRATION_REQUEST_BYTES)->toBe(32)
        ->and(OpaqueProfile::REGISTRATION_RESPONSE_BYTES)->toBe(64)
        ->and(OpaqueProfile::ENVELOPE_BYTES)->toBe(96)
        ->and(OpaqueProfile::REGISTRATION_RECORD_BYTES)->toBe(192)
        ->and(OpaqueProfile::CREDENTIAL_REQUEST_BYTES)->toBe(32)
        ->and(OpaqueProfile::AUTH_REQUEST_BYTES)->toBe(64)
        ->and(OpaqueProfile::KE1_BYTES)->toBe(96)
        ->and(OpaqueProfile::MASKED_RESPONSE_BYTES)->toBe(128)
        ->and(OpaqueProfile::CREDENTIAL_RESPONSE_BYTES)->toBe(192)
        ->and(OpaqueProfile::AUTH_RESPONSE_BYTES)->toBe(128)
        ->and(OpaqueProfile::KE2_BYTES)->toBe(320)
        ->and(OpaqueProfile::KE3_BYTES)->toBe(64)
        ->and(OpaqueProfile::SERVER_LOGIN_STATE_BYTES)->toBe(128);
});

it('fixes the credential identifier and oprf seed lengths', function (): void {
    expect(OpaqueProfile::CREDENTIAL_IDENTIFIER_BYTES)->toBe(32)
        ->and(OpaqueProfile::OPRF_SEED_BYTES)->toBe(64);
});
