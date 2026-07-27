<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Vocabulary of the account activity trail.
 *
 * In a zero-knowledge application this is the only thing the server can tell about what a person
 * does: **what happened and when**, never what it contained. Clinical data are encrypted envelopes
 * and so are the settings, so no entry carries content: the log row stops at the verb, the subject,
 * who caused it and the date.
 *
 * The IP and the user agent are not stored either. They would help investigate an improper access,
 * but they are personal data the server does not retain anywhere else today, and adding them here
 * would silently widen what we know about the person. If that is ever decided otherwise, let it be
 * an explicit and documented decision, not a side effect of this log.
 *
 * The values are stable: we query and group by them, so changing them breaks the history already
 * written. The lifecycle transitions of a clinical event are not here; the model itself emits those
 * with Eloquent's names, under the `health-event` log.
 */
enum AuditEvent: string
{
    /** Name of the log all these entries live in, as opposed to the clinical events one. */
    public const LOG_NAME = 'account';

    /** Account created: the user row exists, still without a completed OPAQUE registration. */
    case AccountCreated = 'account-created';

    /** The OPAQUE registration completed: from here on the account can log in. */
    case RegistrationCompleted = 'registration-completed';

    /**
     * A registration link was issued for an account. It is the most destructive action in the
     * interface (Spec 0001 §3.4): if the account already had data, completing the new registration
     * leaves it inaccessible. Whoever causes it is usually another person, which is why it matters
     * that it is recorded.
     */
    case RegistrationLinkIssued = 'registration-link-issued';

    case LoggedIn = 'logged-in';

    /** Explicit logout, including the lock that discards the master key from the browser. */
    case LoggedOut = 'logged-out';

    case PasswordChanged = 'password-changed';

    /** The settings envelope changed, the language changed, or both. Which of the two is not recorded. */
    case SettingsUpdated = 'settings-updated';

    /**
     * A clipping was shared with a professional (ADR 0011).
     *
     * It records only that a share happened and when, which is what the server already sees from the
     * mere fact of storing the row. Never the range, the types or the number of events: those go
     * encrypted inside the descriptor, and repeating them here would hand the server exactly the
     * metadata ADR 0006 removed from the schema.
     */
    case ShareCreated = 'share-created';

    /**
     * A shared clipping was revoked (ADR 0011). Revoking is a physical delete, so without this entry
     * there would be no record that the clipping ever existed.
     *
     * There is no equivalent case for **downloads**: an access trail would tell how many times and
     * when each delivery was read, which is exactly what ADR 0006 rules out.
     */
    case ShareRevoked = 'share-revoked';
}
