/**
 * Checks of `health/eventEnvelope.js` (ADR 0006).
 *
 * Node's built-in runner, like the rest of `tests/js` (see `crypto.test.mjs`).
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { adoptMasterKey, forget, MASTER_KEY_LENGTH } from '../../resources/js/auth/keyring.js';
import { EnvelopeError } from '../../resources/js/crypto/envelope.js';
import { openEvent, sealEvent } from '../../resources/js/health/eventEnvelope.js';

const USER_ID = '9c8f2e2a-2222-4444-8888-abcdefabcdef';
const OTHER_USER_ID = '00000000-1111-4444-8888-000000000000';
const OCCURRED_AT = '2026-07-25T09:08:07.123456Z';

/** @returns {Uint8Array} Test master key, 32 deterministic bytes. */
function testMasterKey() {
    return new Uint8Array(MASTER_KEY_LENGTH).map((_, index) => index + 1);
}

const GLUCOSE_EVENT = Object.freeze({
    v: 1,
    type: 'glucose',
    tz: '+02:00',
    data: { value: '142', unit: 'mg/dL', loinc: '41653-7' },
});

afterEach(() => {
    forget();
});

test('sealEvent/openEvent: the round trip returns the same object', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealEvent({ userId: USER_ID, occurredAt: OCCURRED_AT, content: GLUCOSE_EVENT });
    const opened = openEvent({ userId: USER_ID, occurredAt: OCCURRED_AT, envelope });

    assert.deepEqual(opened, GLUCOSE_EVENT);
});

test('openEvent: changing the userId makes the decryption fail', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealEvent({ userId: USER_ID, occurredAt: OCCURRED_AT, content: GLUCOSE_EVENT });

    assert.throws(
        () => openEvent({ userId: OTHER_USER_ID, occurredAt: OCCURRED_AT, envelope }),
        EnvelopeError
    );
});

test('openEvent: changing occurred_at by one microsecond makes the decryption fail', () => {
    /**
     * This is the test that matters: it shows the envelope is tied to its row and that an event
     * moved in date does not decrypt "misattributed" instead of failing visibly.
     */
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealEvent({ userId: USER_ID, occurredAt: OCCURRED_AT, content: GLUCOSE_EVENT });
    const movedByOneMicrosecond = '2026-07-25T09:08:07.123457Z';

    assert.notEqual(movedByOneMicrosecond, OCCURRED_AT);
    assert.throws(
        () => openEvent({ userId: USER_ID, occurredAt: movedByOneMicrosecond, envelope }),
        EnvelopeError
    );
});

test('sealEvent/openEvent: two different forms of the same instant produce the same context', () => {
    adoptMasterKey(testMasterKey(), USER_ID);

    const envelope = sealEvent({
        userId: USER_ID,
        occurredAt: '2026-07-25T11:08:07.123456+02:00',
        content: GLUCOSE_EVENT,
    });

    const opened = openEvent({
        userId: USER_ID,
        occurredAt: '2026-07-25T09:08:07.123456Z',
        envelope,
    });

    assert.deepEqual(opened, GLUCOSE_EVENT);
});
