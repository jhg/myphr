/**
 * Interceptor of the Livewire requests (Spec 0001 §9; ADR 0002).
 *
 * It inspects what leaves the browser in every Livewire message and **aborts** if it finds a long
 * value without the `v1.` prefix of the encrypted envelope. It is a guard rail against oversight,
 * not a security measure: whoever controls the browser can remove it. What it prevents is a
 * thoughtlessly added `wire:model` sending clinical data in the clear to the server with nobody
 * noticing until it is written in the database.
 *
 * It is the client half of the §9 pair. The other half is the server listener, which covers what
 * this one cannot: if the oversight is in the client itself, it is the client that builds the
 * payload and asking it to audit itself with any guarantee makes no sense.
 *
 * **What is inspected and what is not.** Only the three places user data travels through:
 * `snapshot.data`, `updates` and the parameters of `calls`. The snapshot `memo` and `checksum` are
 * Livewire's own metadata (identifiers, route, validation errors) and are let through: the
 * application does not write them and blocking them would break the framework while protecting nothing.
 *
 * **The threshold.** An ADR 0004 encrypted envelope, with the smallest padding size, does not go
 * below some 450 characters. Any string above `MAX_PLAINTEXT_LENGTH` that does not start with
 * `v1.` is either data in the clear that should not leave, or a value that has to be wrapped. The
 * threshold is a compromise, not a number from the spec: lowering it triggers false positives on
 * legitimate Filament metadata, and raising it lets whole paragraphs through in the clear.
 */

import { ENVELOPE_PREFIX } from '../crypto/envelope.js';

/** Length above which a string has to be an encrypted envelope. */
export const MAX_PLAINTEXT_LENGTH = 256;

/** Guard rail abort. It never carries the offending value, only its path inside the payload. */
export class LivewirePayloadGuardError extends Error {
    /** @param {string} path */
    constructor(path) {
        super(
            `Livewire payload guard: "${path}" carries a long value without the ${ENVELOPE_PREFIX} envelope prefix. `
            + 'The request was aborted.'
        );
        this.name = 'LivewirePayloadGuardError';
        this.path = path;
    }
}

/**
 * First path that breaks the rule, walking depth first.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {string|null} Path of the offending value, or `null` if there is none.
 */
export function firstViolation(value, path) {
    if (typeof value === 'string') {
        return value.length > MAX_PLAINTEXT_LENGTH && !value.startsWith(ENVELOPE_PREFIX) ? path : null;
    }

    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const violation = firstViolation(value[index], `${path}[${index}]`);

            if (violation !== null) {
                return violation;
            }
        }

        return null;
    }

    if (value !== null && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            const violation = firstViolation(nested, path === '' ? key : `${path}.${key}`);

            if (violation !== null) {
                return violation;
            }
        }
    }

    return null;
}

/**
 * @param {unknown} snapshot Object, or the unparsed JSON string Livewire forwards as is.
 * @returns {Record<string, unknown>} The snapshot data, or empty if it cannot be read.
 */
function snapshotData(snapshot) {
    let parsed = snapshot;

    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return {};
        }
    }

    const data = parsed !== null && typeof parsed === 'object' ? parsed.data : null;

    return data !== null && typeof data === 'object' ? data : {};
}

/**
 * Inspects a Livewire message payload.
 *
 * @param {{snapshot?: unknown, updates?: unknown, calls?: unknown}} payload
 * @returns {string|null} Path of the offending value, or `null`.
 */
export function inspectPayload(payload) {
    if (payload === null || typeof payload !== 'object') {
        return null;
    }

    const violation = firstViolation(snapshotData(payload.snapshot), 'snapshot.data')
        ?? firstViolation(payload.updates ?? {}, 'updates');

    if (violation !== null) {
        return violation;
    }

    const calls = Array.isArray(payload.calls) ? payload.calls : [];

    for (let index = 0; index < calls.length; index += 1) {
        const found = firstViolation(calls[index]?.params ?? [], `calls[${index}].params`);

        if (found !== null) {
            return found;
        }
    }

    return null;
}

/** Event emitted on abort. It carries the path, never the value. */
export const GUARD_VIOLATION_EVENT = 'phr:payload-guard-violation';

/**
 * Aborts a message and logs it loudly.
 *
 * No exception is thrown: the interceptor body runs inside the loop with which Livewire assembles
 * **all** pending requests, so an exception here would take down messages of other components that
 * have nothing to do with it. `cancel()` is already the abort; the log and the event are what keep
 * the failure from passing for a form that "sometimes does not save".
 *
 * @param {() => void} cancel
 * @param {string} violation
 */
function abort(cancel, violation) {
    cancel();

    const failure = new LivewirePayloadGuardError(violation);

    console.error(failure);
    document.dispatchEvent(new CustomEvent(GUARD_VIOLATION_EVENT, { detail: { path: violation } }));
}

/**
 * Registers the interceptor over Livewire.
 *
 * The inspection goes in the body of the message interceptor, **not** in its `onSend`. Livewire
 * builds `message.payload` before creating the interceptors, and only afterwards fires the
 * `fetch`; the `onSend` of a message is invoked with the response promise already running, that
 * is, with the payload already written to the socket. Cancelling there would void the response
 * but not stop the data in the clear from leaving the browser, which is all this guard rail does.
 *
 * The `onSend` is kept as a safety net in case a future Livewire version assembles the payload
 * later: the body would then see nothing and this would be the only inspection possible.
 *
 * @param {{interceptMessage?: Function}} [livewire] Defaults to `window.Livewire`.
 * @returns {boolean} `false` if Livewire does not expose the interceptor.
 */
export function installLivewirePayloadGuard(livewire = window.Livewire) {
    if (typeof livewire?.interceptMessage !== 'function') {
        return false;
    }

    livewire.interceptMessage(({ message, cancel, onSend }) => {
        const violation = inspectPayload(message?.payload);

        if (violation !== null) {
            abort(cancel, violation);

            return;
        }

        onSend(({ payload }) => {
            if (message?.payload != null) {
                return;
            }

            const late = inspectPayload(payload);

            if (late !== null) {
                abort(cancel, late);
            }
        });
    });

    return true;
}
