# ADR 0008: The measurement method is part of the data

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-25
* **Decider**: Development Team

## Context

The same quantity measured in two different ways is not the same data. Blood glucose makes it obvious: a
wearable sensor measures in interstitial fluid and lags blood by several minutes for physiological reasons, a
capillary meter measures blood after the finger prick, and a urine test strip gives a presence rather than a
number. And this isn't specific to blood glucose: body temperature varies by up to half a degree between the
oral, axillary, and tympanic routes, and blood pressure is not the same in one arm as in the other, nor
sitting as lying down or standing.

LOINC already recognizes this and publishes a different code for each combination of quantity, unit, and
method: `99504-3` and `105272-9` for glucose in interstitial fluid depending on the unit, `41653-7` and
`14743-9` for capillary, `25428-4` for presence in urine.

ADR 0006 introduced a field to distinguish whether a data point was typed by hand or came from a device.
That's not enough: someone can look at their sensor and type the number, and that doesn't make it a capillary
measurement. What tells them apart is not how the data got in but what was measured and where.

## Decision

Every measurement event stores an explicit method token, in addition to the code for the quantity. It is not
inferred from the code nor from the manual-or-device origin field, which answers a different question.

When adding a new quantity to the catalog, its methods have to be enumerated first and a decision made about
which ones are supported. It's part of designing the event type, not a later detail, because the method is
one of those fields that are only known at the moment of recording and can't be recovered afterwards.

For blood pressure, the method is made up of the arm and the posture. They are the two ways of measuring that
change the number in a known way, neither of them can be reconstructed afterwards, and both are method and
not incidental metadata. Both vocabularies are closed here, with the same immutability guarantees as any
other token from ADR 0004 (`docs/adr/0004-client-crypto-and-data-format.md`): left or right arm (`left`,
`right`) and sitting, lying, or standing posture (`sitting`, `lying`, `standing`). They travel in the event as
two separate tokens and not as one compound token, because the screen asks for them separately and that way
they are read and filtered separately; the method that statistics group by is their combination, from
`left_sitting` to `right_standing`, and it is computed at grouping time instead of being stored. The LOINC
codes for this quantity, `8480-6` for systolic and `8462-4` for diastolic, name the quantity and nothing
else, so those two tokens are the only place where this information lives. With this, blood pressure is
enumerated and stops being the pending case that this ADR required closing before supporting it.

Statistics don't mix methods silently. By default they are computed per method, and the user can choose to
combine them when that makes sense. The view always states which methods are included in the number it shows,
so that an average is never ambiguous.

Qualitative results don't enter range statistics. A urine test strip has no mean and no percentage in range,
and its payload has a different shape: instead of a value with a unit it carries an ordinal result.

## Rationale

You could argue that the method is already implicit in the LOINC code and that storing it separately is
redundant. We store it anyway for two reasons. The first is about reading: the client has to know how to
display and group an event without first resolving the code against the catalog, and with thousands of events
on screen that matters. The second is about robustness: if one day a code assignment has to be corrected, the
method is still correct, whereas if the method only lives inside the code, an assignment error loses it.

On not mixing by default, the alternative was to average everything. In the specific case of sensor and
capillary the error would be small, because capillary is used precisely to calibrate the sensor and both
should give very close values, but not identical ones: they diverge exactly when glucose is changing fast,
which is when the data matters. And the general argument doesn't depend on that case: mixing axillary with
tympanic temperature produces a mean that means nothing.

We rejected the opposite alternative, forbidding the combination, by the same criterion as ADR 0007: the
application presents and the user decides. Forbidding it would be imposing a clinical judgment, and a user
with a calibrated sensor has legitimate reasons to want to see it all together.

For blood pressure we considered keeping only the arm, which is what ADR 0006 pointed at to begin with. We
rejected it because it loses the posture, and posture changes the value as much as the arm does: the blood
pressure of someone lying down is not the same as standing, and that difference is exactly what a doctor
looks for when they suspect orthostatic hypotension. It's also a data point that only exists at the moment of
measuring, so storing the arm and not the posture would be throwing away half the method.

We also considered capturing the cuff size, which really does affect the reading. We left it out by the same
argument ADR 0006 uses for not asking about carbohydrates: at home almost nobody knows which cuff their
device has, and asking produces empty fields or made-up values, which is worse than not having it. If demand
shows up later, it comes in as an optional field without breaking anything.

* **Pros**: no average mixes incomparable things without it being visible; the model takes new quantities
  without redoing anything; and the data is complete for export, where the method is part of the target code.
* **Cons**: one more field per event; the statistics layer needs the method as a grouping dimension from the
  start, not as an add-on; and the interface has to explain a distinction some users don't expect to find.

## Consequences

The ADR 0005 catalog now resolves the code from three things instead of two: quantity, unit, and method. The
relation between what the user sees and the code stored stops being one-to-one twice over.

The statistics layer groups by method before computing anything, and the selector for which methods to
include is part of the view from the first version, not a later improvement.

The blood pressure screen asks for arm and posture at the moment of recording, both inside the encrypted
envelope, and its statistics are grouped by their combination just as blood glucose ones are grouped by its
method. The ADR 0005 catalog gains the two vocabularies as enums (`BloodPressureArm` and
`BloodPressurePosture`), even though the LOINC code doesn't vary with them.

When body temperature is added we'll have to capture the measurement site, and when any new quantity is
added, the question is always the same: how many ways is this measured, and do they change the meaning of the
number.

## Decision History

### 2026-07-25: the blood pressure method is enumerated as arm and posture
Previously decided: this ADR required enumerating the methods of every quantity before supporting it, but it
left blood pressure unenumerated, and ADR 0006 listed it with the arm as the only captured field.
Changed because: posture changes the value as much as the arm does and is only known at the moment of
measuring, so both become the method for this quantity, with their two vocabularies closed. Cuff size was
considered and left out so as not to produce empty or made-up fields.
