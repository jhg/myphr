# Spec 0003: Home dashboard summaries

* Related ADR(s): `docs/adr/0002-encrypted-data-flow-livewire-alpine-filament.md`,
  `docs/adr/0004-client-crypto-and-data-format.md`, `docs/adr/0006-encrypted-event-model.md`,
  `docs/adr/0007-encrypted-user-configuration.md`, `docs/adr/0008-measurement-method.md`

This spec depends on those ADRs as prior reading: it does not repeat their rationale, it only applies it. If a
point in this spec and an ADR disagree, the ADR wins and this spec has an error to fix. Spec 0002
(`docs/specs/0002-tracking-event-capture.md`) covers the other half: how the events summarized here are captured
and encrypted. Everything it says about the cryptographic contract holds the same way and is not repeated here.

## 1. Scope

The home dashboard summarizes blood glucose and blood pressure over two windows, the last week and the last
month. Nothing else: no meals and no insulin, because a mean of meals means nothing while food items are free
text (ADR 0010), and insulin does not have a settled data shape yet.

It leaves out the single-quantity chart, which lives on its own capture screen, and it leaves out the settings
screen where the user configures their target range, which does not exist today: the dashboard already reads
that setting and behaves well without it.

## 2. User stories

Person who opens the application in the morning. They see at a glance how their week and their month went: how
many readings they have, where those readings sit and what the last one was, without opening any screen or
touching any filter.

Person who wears a sensor and also pricks their finger. They see two separate blocks of statistics, one per
method, each with its own label visible. Nobody averages one with the other behind their back.

Person whose doctor gave them a target range. They configure it once and from then on the dashboard tells them
what percentage of the time they were inside it. Someone who has not configured it does not see that statistic,
neither empty nor with a suggested range: they see a discreet invitation to configure it.

Person going to an appointment. They show the screen as it is, because the numbers on it are the ones the doctor
asks for: count, mean, median, min, max and last reading.

## 3. Where it is computed, and why

In the browser, over the already-decrypted events, with the key in memory. The server cannot add up what it
cannot read (ADR 0002), so the home page does not use Filament widgets: it extends `HealthEventPage` to reuse
`fetchEvents` and decrypts on the client like any capture screen.

The computation lives in a pure module, `resources/js/health/statistics.js`, with no DOM and no Livewire, and
the dashboard's Alpine component does not reimplement any mean or median: it only decrypts, calls and shapes the
result. That is what makes the statistics testable without setting anything up.

Since the server cannot filter by type (ADR 0006), the dashboard receives every event in the range and it is
`statistics.js` that discards the ones that are not the type it is summarizing. An envelope that fails to
open doesn't break the dashboard: it is counted and reported.

## 4. The two windows

Last week is seven days and last month is thirty, both ending at the instant the dashboard is opened, and with
both bounds inclusive: `[reference - N days, reference]`. It is fixed this way, and not with an open bound, so
the summary doesn't change depending on the time of day you look at it, and so an event from exactly N days ago
counts the same at 00:00 as at 23:59.

Nothing later than the reference instant gets in, even if it exists in the list, because a device clock running
fast must not put "future" readings into the summary.

## 5. Blood glucose summary

Computed per measurement method (ADR 0008: statistics do not mix methods silently) and within a single display
unit, the one from the user's `glucoseUnit` setting, with `mg/dL` when there is no saved preference. For each
method:

```
count             how many readings
mean, median      mean and median
min, max          the observed range
last              the last reading, with its value and its instant
inRangePercent    only if a target range is configured
```

No conversion between mg/dL and mmol/L, for the same reason as on the capture screen: converting requires fixing
precision and rounding, which is a clinical decision no ADR has made. Events in another unit are counted
separately (`excludedByUnit`) and the view says so, instead of them disappearing without explanation. That
notice is also drawn when no reading in the period falls in the display unit: otherwise, someone with thirty
blood glucose readings in mg/dL who switches their preference to mmol/L reads a "no records yet" that is false.

The same rule applies to the target range, which stores its own unit. A range in a unit other than the display
unit is not applied, just like a malformed one, because comparing 140 mg/dL against a range of 3.9 to 10 mmol/L
would publish a "time in range: 0%" that looks like a clinical figure and is not. That state has its own notice,
different from the "no range yet" one: the first is fixed by changing one of the two units and the second by
configuring the range, and offering the wrong message sends the person to the wrong place.

Events that carry no numeric value are discarded without breaking the summary. They are two different cases with
the same effect: a qualitative result, like the one from a urine test strip, which has no mean and no range
(ADR 0008), and a malformed value. Both add to the same `discarded` counter.

The percentage of time in range only appears when the user has configured their target range. If they have not,
the `inRangePercent` key does not exist: neither `null` nor zero. ADR 0007 is explicit that the application
ships no default ranges, because a suggested range is a clinical indication, and a statistic with a zero where
there should be a gap invites filling it with any number.

## 6. Blood pressure summary

Grouped by the quantity's method, which for blood pressure is the combination of arm and posture (ADR 0008),
from `left_sitting` to `right_standing`. The combination is computed while grouping, from `data.arm` and
`data.posture`; it is not stored in the envelope.

For each group, and for each of the three quantities separately — systolic, diastolic and heart rate — the mean,
median, min, max and last value are computed, plus the group's count and the last complete reading, with the
three numbers together and its instant. The complete reading matters: showing "the last systolic" and "the last
diastolic" separately would let them come from two different days.

A blood pressure event is a single one with the three numbers (ADR 0006), so the summary does not split them
into three independent lists. Heart rate is optional at capture, because not every blood pressure monitor
measures it, so an event without it has to keep counting for systolic and diastolic, and must not disappear from
the whole summary. What is discarded, counted in `discarded`, is an event missing one of the two pressures or
carrying a non-numeric value.

## 7. Precision of the numbers shown

Values travel as strings (ADR 0004) and are converted to numbers only to compute. Mean and median are rounded to
two decimals and the percentage in range to one, rounding away from zero. This is not a clinical decision, it
does not interpret whether the number is good or bad: it only fixes presentation precision in one place, instead
of leaving it to however each browser happens to format.

The median of an even number of samples is the average of the two middle ones, with the list already sorted,
which is the standard definition.

## 8. Acceptance criteria

* An event recorded exactly seven days ago falls inside the week window, whatever time the dashboard is opened.
  One dated later than the reference instant falls in no window.
* Two blood glucose readings with different methods produce two groups, never a single mean, and each group
  shows its method label.
* With no target range configured, no group carries `inRangePercent` and the view does not draw that gap. With a
  range configured, the percentage counts readings with both bounds included.
* A malformed target range (without numeric `low` or `high`, or with the minimum above the maximum) is treated
  as if it did not exist, not as a range of zero.
* A target range saved in a unit other than the display unit produces no `inRangePercent` either, and the view
  says so with its own notice instead of inviting the user to configure a range that already exists.
* A period where every reading fell out by unit still says how many fell out, not just that there are no
  records.
* A reading in a unit other than the display unit enters no mean and is counted in `excludedByUnit`, and the
  view says how many fell out and which unit is being displayed.
* A qualitative result and a non-numeric value are counted in `discarded` and do not break the summary.
* A blood pressure reading with no heart rate keeps counting for systolic and diastolic.
* The median of four values is the average of the two middle ones, checked against a concrete case and not just
  against the implementation itself.
* An envelope that fails to open is counted and reported, and the rest of the dashboard is drawn the same.

## 9. Open questions

1. Where the user configures their target range. The dashboard already reads the `glucoseTargetRange` setting
   from the encrypted configuration envelope, but the screen that writes it does not exist yet, so today that
   name is a convention of a single module. The settings screen has to fix it, and with it, whether the range is
   a single one or depends on the meal context, which is how many clinical guidelines give it.
2. Whether the user can combine methods at will. ADR 0008 says they can, and that the view must always state
   which methods a number includes. Today the dashboard always separates, which is the correct default, but the
   selector is missing.
3. How many events the dashboard requests. Today it makes a single `fetchEvents` call with the default limit of
   a hundred, and since the server cannot filter by type, a hundred mixed events may not cover a month of
   records for someone who writes several times a day: the month summary would come up short without saying so.
   What is consistent with section 4 of spec 0002 is to request cursor-paged batches until the thirty-day window
   is exhausted, and to report it if it still hits the cap.

## 10. History

### 2026-07-26 — The target range is compared by unit and the excluded notice stops hiding
Previously: section 5 only said that no conversion happens between units, and the implementation dropped the
target range's unit when reading it, so a range in mmol/L was compared against readings in mg/dL and the
dashboard published a "time in range: 0%". The notice about records excluded by unit, moreover, sat behind the
no-data state and never got drawn precisely when every reading was excluded.
Changed because: the two units (the display one and the range's) are chosen separately in the profile, so the
mismatch is a reachable state and not a theoretical case.
