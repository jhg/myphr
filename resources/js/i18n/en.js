/**
 * English catalog, the default language (`config/app.php`, `APP_LOCALE=en`).
 *
 * It is also the fallback catalog: any key missing in `es.js` or in `zh_CN.js` lands here, so this
 * file always has to be complete. `tests/js/i18n.test.mjs` checks that the three have exactly the
 * same key set.
 *
 * An entry shaped `{one, other}` is a sentence with a count: `t()` picks the variant with
 * `Intl.PluralRules` out of `count`. "record(s)" is never written.
 *
 * @type {Readonly<Record<string, string|{one: string, other: string}>>}
 */
export const EN = Object.freeze({
    // --- Shared by several screens --------------------------------------------------------------
    'common.listSeparator': ', ',
    'common.locked.history': 'You need to sign in to see your history.',
    'common.locked.summary': 'You need to sign in to see your summary.',
    'common.locked.settings': 'You need to sign in to change your settings.',
    'common.missingDate': 'Enter the date and time.',
    'common.noSession': 'There is no active session. Sign in again.',
    'common.saveFailed': 'The record could not be saved.',
    'common.undecryptable': 'The envelope could not be decrypted.',
    'common.badDatetime': 'The date and time could not be read: "{value}".',
    'common.configuration': 'This installation is not set up correctly. Tell whoever administers it.',
    'common.network': 'We could not reach the server. Try again.',
    'common.staleTab': 'This page is out of date, most likely because the app was updated while it was open. Reload it and try again.',
    'common.reload': 'Reload the page',
    'common.noLoincCode': 'There is no LOINC code for method "{method}" with unit "{unit}".',
    'common.recordsUndecrypted': {
        one: '{count} record could not be decrypted and is not shown.',
        other: '{count} records could not be decrypted and are not shown.',
    },

    // --- History date range (`health/dateRange.js`) ---------------------------------------------
    'range.error.incomplete': 'Choose both dates of the custom range.',
    'range.error.order': 'The start date has to be earlier than the end date.',
    'range.error.badDate': 'The dates of the range could not be read.',
    'range.error.badPreset': 'There is no such period: "{preset}".',

    // --- Field names, for the `numericValue.js` messages ----------------------------------------
    'field.value': 'The value',
    'field.dose': 'The dose',
    'field.quantity': 'The quantity',
    'field.systolic': 'The systolic pressure',
    'field.diastolic': 'The diastolic pressure',
    'field.pulse': 'The pulse',
    'field.weight': 'The weight',
    'field.temperature': 'The temperature',
    'field.rangeLow': 'The lower limit',
    'field.rangeHigh': 'The upper limit',

    // --- Numeric validation ---------------------------------------------------------------------
    'numeric.notANumber': '{field} must be a number.',
    'numeric.negative': '{field} cannot be negative.',
    'numeric.tooManyDecimals': '{field} takes at most 2 decimal places.',
    'numeric.notANumberHint': '{field} must be a number (use "." or "," for decimals).',

    // --- Shared progress bar stages -------------------------------------------------------------
    'stage.preparing': 'Preparing…',
    'stage.saving': 'Saving…',
    'stage.done': 'Done.',
    'stage.entering': 'Signing in…',

    // --- Sign in --------------------------------------------------------------------------------
    'login.stage.contacting': 'Checking your details…',
    'login.stage.stretching': 'Protecting your password on this device. It takes a few seconds on purpose: that slowness is what stops anyone from guessing your password, even with a copy of the database.',
    'login.error.credentials': 'We could not sign you in with those details.',

    // --- Password set-up ------------------------------------------------------------------------
    'setPassword.stage.contacting': 'Checking the link…',
    'setPassword.stage.stretching': 'Deriving your key on this device. It takes a few seconds…',
    'setPassword.stage.wrapping': 'Creating and protecting your key…',
    'setPassword.stage.verifying': 'Checking that your password opens your key. It takes a few seconds…',
    'setPassword.error.link': 'This link no longer works. Ask whoever administers the system for a new one.',
    'setPassword.error.mismatch': 'The two passwords do not match.',
    'setPassword.error.verification': 'Something went wrong creating your key. We could not verify it.',

    // --- Public sign-up (registration) ------------------------------------------------------------
    'register.stage.contacting': 'Creating your account…',
    'register.stage.stretching': 'Deriving your key on this device. It takes a few seconds…',
    'register.stage.wrapping': 'Creating and protecting your key…',
    'register.stage.verifying': 'Checking that your password opens your key. It takes a few seconds…',
    'register.error.mismatch': 'The two passwords do not match.',
    'register.error.loginTaken': 'There is already an account with that email address.',
    'register.error.generic': 'Something went wrong creating your account. We could not verify it.',

    // --- Password change ------------------------------------------------------------------------
    'changePassword.stage.reauthenticating': 'Checking your current password…',
    'changePassword.stage.stretchingOld': 'Checking your current password on this device. It takes a few seconds…',
    'changePassword.stage.unwrapping': 'Opening your key…',
    'changePassword.stage.registering': 'Preparing the new password…',
    'changePassword.stage.stretchingNew': 'Protecting your key with the new password. It takes a few seconds…',
    'changePassword.error.mismatch': 'The two new passwords do not match.',
    'changePassword.error.empty': 'Type your current password and the new one.',
    'changePassword.error.same': 'The new password has to be different from the current one.',
    'changePassword.error.currentPassword': 'The current password is not correct.',
    'changePassword.error.unavailable':
        'This account cannot change its password from here. Tell whoever administers the system.',
    'changePassword.error.expired': 'You took too long. Type your current password again.',
    'changePassword.error.verification': 'Something went wrong protecting your key. Your password has not changed.',
    'changePassword.success': 'Your password has been changed. Your data is the same and is still readable.',

    // --- Profile --------------------------------------------------------------------------------
    'profile.stage.reauth': 'Checking your current password on this device. It takes a few seconds…',
    'profile.stage.opening': 'Opening your key…',
    'profile.stage.stretching': 'Deriving your new key on this device. It takes a few seconds…',
    'profile.stage.wrapping': 'Protecting your key again…',
    'profile.error.unit': 'Choose a valid blood glucose unit.',
    'profile.error.rangeIncomplete': 'Type both limits of the range, or leave both blank.',
    'profile.error.rangeOrder': 'The lower limit has to be smaller than the upper one.',
    'profile.error.rangeZero': 'The limits of the range have to be greater than zero.',
    'profile.error.rangeUnit': 'Choose a valid unit for the target range.',
    'profile.error.conflict': 'Your settings changed in another tab. Reload the page and try again.',
    'profile.error.settingsGeneric': 'The settings could not be saved.',
    'profile.error.passwordExpired': 'Too much time has passed. Type your current password again.',
    'profile.error.passwordGeneric': 'The password could not be changed.',

    // --- Blood glucose --------------------------------------------------------------------------
    'glucose.empty': 'There are no blood glucose records yet.',
    'glucose.missingValue': 'Enter a value.',
    'glucose.caption.includes': 'Includes: {methods}.',
    'glucose.caption.noneInUnit': 'No record is in {unit}, so the chart is empty.',
    'glucose.caption.excluded': {
        one: ' {count} record in a unit other than {unit} is not shown '
            + '(there is no conversion between mg/dL and mmol/L).',
        other: ' {count} records in a unit other than {unit} are not shown '
            + '(there is no conversion between mg/dL and mmol/L).',
    },

    // --- Blood pressure -------------------------------------------------------------------------
    'bloodPressure.empty': 'There are no blood pressure records yet.',
    'bloodPressure.missingSystolic': 'Enter the systolic pressure.',
    'bloodPressure.missingDiastolic': 'Enter the diastolic pressure.',
    'bloodPressure.missingArm': 'Say which arm.',
    'bloodPressure.missingPosture': 'Say which posture.',
    'bloodPressure.pulseInline': 'Pulse {value} {unit}',
    'bloodPressure.series.systolic': 'Systolic · {method}',
    'bloodPressure.series.diastolic': 'Diastolic · {method}',
    'bloodPressure.caption.includes': 'Includes: {methods}. Each method (arm and posture) is a separate series.',
    'bloodPressure.caption.empty': 'There is no blood pressure data to show.',
    'bloodPressure.pulseCaption.includes': 'Includes: {methods}.',
    'bloodPressure.pulseCaption.empty': 'There is no pulse data to show.',
    'bloodPressure.pulseCaption.missing': {
        one: ' {count} record without a pulse is not shown in this chart.',
        other: ' {count} records without a pulse are not shown in this chart.',
    },

    // --- Meals ----------------------------------------------------------------------------------
    'meals.empty': 'There are no meals recorded yet.',
    'meals.missingMealType': 'Choose a meal type.',
    'meals.incompleteFood': 'Fill in the name, the quantity and the unit of every food, or remove the row.',
    'meals.noFoods': 'No foods written down.',

    // --- Insulin --------------------------------------------------------------------------------
    'insulin.empty': 'There are no insulin records yet.',
    'insulin.chartLocked': 'The chart needs your key before it can be shown.',
    'insulin.chartEmpty': 'The total dose for each day will appear here as soon as you save your first record.',
    'insulin.missingDose': 'Enter the dose.',
    'insulin.missingInsulinType': 'Select the insulin type.',
    'insulin.yAxisTitle': 'Total daily dose ({unit})',
    'insulin.caption': {
        one: '{count} day with records. Cumulative dose by type — {totals}.',
        other: '{count} days with records. Cumulative dose by type — {totals}.',
    },
    'insulin.omittedDays': {
        one: '{count} older day of the period is not drawn, to keep the chart readable.',
        other: 'The {count} older days of the period are not drawn, to keep the chart readable.',
    },

    // --- Body weight ----------------------------------------------------------------------------
    'bodyWeight.empty': 'There are no body weight records yet.',
    'bodyWeight.missingValue': 'Enter a weight.',
    'bodyWeight.missingUnit': 'Choose a unit.',
    'bodyWeight.caption.includes': 'Includes: {units}. Each unit is a separate series: kilograms and '
        + 'pounds are not converted into one another.',
    'bodyWeight.caption.empty': 'There is no body weight data to show.',

    // --- Body temperature -----------------------------------------------------------------------
    'temperature.empty': 'There are no temperature records yet.',
    'temperature.missingValue': 'Enter a temperature.',
    'temperature.missingUnit': 'Choose a unit.',
    'temperature.missingSite': 'Say where you took the temperature.',
    'temperature.noLoincCode': 'There is no LOINC code for measurement site "{site}".',
    'temperature.series': '{site} · {unit}',
    'temperature.caption.includes': 'Includes: {series}. Each measurement site and unit is a separate '
        + 'series: they are not comparable with one another.',
    'temperature.caption.empty': 'There is no temperature data to show.',

    // --- Home dashboard -------------------------------------------------------------------------
    'dashboard.truncated':
        'The summary only includes the most recent records: there are too many in this period to load them all.',
    'dashboard.empty': 'There are no records in this period yet.',
    'dashboard.addFirst': 'Add your first record',
    'dashboard.typeFilter.none': 'No event type is selected, so there is nothing to show. Tick at least one.',
    'dashboard.loadedCount': {
        one: '{count} record of the ticked types in this period.',
        other: '{count} records of the ticked types in this period.',
    },
    /**
     * What the search leaves out is always said: a shortened list with no explanation reads as
     * "there are no more records", and in a clinical history that is a conclusion, not an omission.
     */
    'dashboard.search.hidden': {
        one: '{count} record in this period does not match what you searched for. It is still counted '
            + 'in the charts and the statistics.',
        other: '{count} records in this period do not match what you searched for. They are still '
            + 'counted in the charts and the statistics.',
    },
    'dashboard.empty.search': 'No record in this period matches what you searched for.',
    'dashboard.targetRangeUnitMismatch': 'Your target range is saved in a different unit, so time in range '
        + 'cannot be calculated over readings in {unit}. Change either the range unit or the display unit in '
        + 'the settings.',
    'dashboard.targetRangeInvite': 'Set your blood glucose target range in the settings to see here what '
        + 'percentage of the time you spend inside it.',
    'dashboard.generic': 'The summary could not be loaded.',
    'dashboard.recordsUndecrypted': {
        one: '{count} record could not be decrypted and is not included in this summary.',
        other: '{count} records could not be decrypted and are not included in this summary.',
    },
    'dashboard.excludedByUnit': {
        one: '{count} record in a unit other than {unit} is not shown '
            + '(units are never converted into one another).',
        other: '{count} records in a unit other than {unit} are not shown '
            + '(units are never converted into one another).',
    },
    'dashboard.stat.count': 'Count',
    'dashboard.stat.mean': 'Mean',
    'dashboard.stat.median': 'Median',
    'dashboard.stat.min': 'Minimum',
    'dashboard.stat.max': 'Maximum',
    'dashboard.stat.lastReading': 'Last reading',
    'dashboard.stat.timeInRange': 'Time in range',
    'dashboard.stat.belowRange': 'Below range',
    'dashboard.stat.inRange': 'In range',
    'dashboard.stat.aboveRange': 'Above range',
    'dashboard.stat.withMean': '{magnitude} · mean',
    'dashboard.stat.withMedian': '{magnitude} · median',
    'dashboard.stat.withRange': '{magnitude} · range',
    'dashboard.magnitude.systolic': 'Systolic',
    'dashboard.magnitude.diastolic': 'Diastolic',
    'dashboard.magnitude.pulse': 'Pulse',
    'dashboard.bp.lastReadingCaption': 'Last reading (systolic/diastolic)',
    'dashboard.unit.bpm': 'bpm',
    'dashboard.method.capillary': 'Capillary',
    'dashboard.method.interstitial': 'Interstitial',
    'dashboard.method.combined': '{arm}, {posture}',
    'dashboard.arm.left': 'Left',
    'dashboard.arm.right': 'Right',
    'dashboard.posture.sitting': 'sitting',
    'dashboard.posture.lying': 'lying down',
    'dashboard.posture.standing': 'standing',

    // --- Unified timeline of the home dashboard --------------------------------------------------
    'dashboard.timeline.capped': {
        one: 'Showing the {shown} most recent entries of this period; {count} older one is not listed.',
        other: 'Showing the {shown} most recent entries of this period; {count} older ones are not listed.',
    },
    'dashboard.timeline.unsupported': {
        one: '{count} record is of a kind this timeline cannot describe yet, so it is not listed.',
        other: '{count} records are of a kind this timeline cannot describe yet, so they are not listed.',
    },
    'dashboard.timeline.type.glucose': 'Blood glucose',
    'dashboard.timeline.type.bloodPressure': 'Blood pressure',
    'dashboard.timeline.type.insulin': 'Insulin',
    'dashboard.timeline.type.meal': 'Meal',
    'dashboard.timeline.type.bodyWeight': 'Body weight',
    'dashboard.timeline.type.temperature': 'Temperature',
    'dashboard.timeline.measurement': '{value} {unit}',
    'dashboard.timeline.bloodPressureReading': '{systolic}/{diastolic} {unit}',
    'dashboard.timeline.pulse': '{pulse} {unit}',
    'dashboard.timeline.noFoods': 'no foods listed',
    'dashboard.timeline.moreFoods': '+{count}',
    'dashboard.timeline.insulinType.rapid': 'Rapid-acting',
    'dashboard.timeline.insulinType.long': 'Long-acting',
    'dashboard.timeline.insulinType.mixed': 'Mixed',
    'dashboard.timeline.mealType.breakfast': 'Breakfast',
    'dashboard.timeline.mealType.lunch': 'Lunch',
    'dashboard.timeline.mealType.dinner': 'Dinner',
    'dashboard.timeline.mealType.snack': 'Snack',
    'dashboard.timeline.site.axillary': 'Armpit',
    'dashboard.timeline.site.oral': 'Mouth',
    'dashboard.timeline.site.tympanic': 'Ear (eardrum)',
    'dashboard.timeline.site.temporal': 'Forehead (temporal artery)',
    'dashboard.timeline.site.rectal': 'Rectal',

    // --- Share a clipping with a professional (`health/sharePage.js`, ADR 0011) -----------------
    'share.stage.reading': 'Reading your records…',
    'share.stage.decrypting': 'Decrypting your records…',
    'share.stage.packing': 'Compressing and encrypting the clipping…',
    'share.stage.pin': 'Protecting the PIN…',
    'share.stage.uploading': 'Uploading the clipping…',
    'share.stage.done': 'Clipping ready.',
    'share.error.noTypes': 'Choose at least one record type to share.',
    'share.error.badTtl': 'That expiry time is not one of the available options.',
    'share.error.empty': 'There are no records of those types in that period, so there is nothing to share.',
    'share.error.tooLarge': 'The clipping is too large to share. Narrow the period or leave out some record types.',
    'share.error.tooManyEvents': 'That period holds more than {count} records. Narrow it and try again.',
    'share.error.undecryptable': {
        one: '{count} record in that period could not be decrypted. The clipping was not built, because a missing record looks exactly like a record that never existed.',
        other: '{count} records in that period could not be decrypted. The clipping was not built, because missing records look exactly like records that never existed.',
    },
    'share.error.limit': 'You already have as many active clippings as are allowed. Revoke one before sharing again.',
    'share.error.upload': 'The clipping could not be uploaded. Nothing was shared.',
    'share.error.copy': 'The link could not be copied. Select it and copy it by hand.',
    'share.error.read': 'Your records could not be read, so no clipping was built and nothing was shared.',
    'share.error.generic': 'The clipping could not be built.',
    'share.qr.alt': 'QR code holding the full link to the clipping.',
    'share.range.all': 'Your whole history',
    'share.range.from': 'From {from}',
    'share.range.to': 'Up to {to}',
    'share.range.between': 'From {from} to {to}',
    'share.list.empty': 'You have no active clippings.',
    'share.list.undecryptable': 'This clipping could not be decrypted, so what it covers cannot be shown. It is still shared: revoke it if in doubt.',
    'share.list.types': 'Includes: {types}',
    'share.list.records': {
        one: '{count} record',
        other: '{count} records',
    },
    'share.list.expires': 'Expires {at}',
    'share.list.opened': 'First opened {at} (rounded to the hour; there is no access log)',
    'share.list.notOpened': 'Not opened yet',
    'share.list.revoke': 'Revoke',
    'share.list.confirmRevoke': 'Revoking deletes the clipping for good. It does not take back what was already downloaded.',
    'share.list.confirmRevokeAction': 'Revoke for good',
    'share.list.cancel': 'Cancel',
    // --- Height and body mass index (weight screen and profile) ----------------------------------
    'field.height': 'The height',
    'bodyWeight.missingHeightUnit': 'Choose a unit for the height.',
    'bodyWeight.heightInline': 'Height {value} {unit}',
    'bodyWeight.bmi': 'BMI {value}',
    'bodyWeight.bmiWithHeightFrom': 'BMI {value} · using the height recorded on {date}',
    'profile.body.none': 'Not recorded yet',
    'profile.body.noBmi': 'Record a height to see it',
    'profile.body.fromRecords': 'From your latest weight and height',
    'profile.error.measurementsGeneric': 'Your latest measurements could not be loaded.',

    // --- Home dashboard charts -------------------------------------------------------------------
    'dashboard.chart.caption': 'Daily median in {unit}, with a shaded band from that day\'s lowest '
        + 'reading to its highest. Includes: {series}. Days with no readings are left blank.',
    'dashboard.chart.empty': 'No readings in this period yet: the chart appears as soon as there are some.',
    'dashboard.chart.omittedDays': {
        one: '{count} older day of the period is not drawn, to keep the chart readable.',
        other: '{count} older days of the period are not drawn, to keep the chart readable.',
    },
    'dashboard.chart.seriesMagnitude': '{group} \u00b7 {magnitude}',
    'dashboard.chart.tooltip': '{label}: median {median} {unit} (from {min} to {max})',
    'dashboard.chart.tooltipSingle': '{label}: {value} {unit} (a single reading)',
    /**
     * Accessible name of the canvas. In the panel Blade writes it; in the reader and in the
     * preview `clippingExplorer.js` writes it, because there the chart markup is emitted by no
     * server.
     */
    'dashboard.chart.ariaLabel': 'Daily median and daily range for {type}',

    // --- Glucose curve with meal and insulin markers (`glucoseContext.js`) -----------------------
    'dashboard.chart.context.title': 'Blood glucose with meals and insulin',
    'dashboard.chart.context.ariaLabel': 'Blood glucose over time, with a mark for every meal and '
        + 'every insulin injection',
    'dashboard.chart.context.caption': 'Every blood glucose reading in {unit}, in time order, with a '
        + 'mark on the time axis for each meal and each insulin injection. Includes: {series}. '
        + 'Stretches of more than {hours} hours with no reading are left blank, never joined by a line.',
    'dashboard.chart.context.meals': 'Meals',
    'dashboard.chart.context.injections': 'Insulin injections',
    'dashboard.chart.context.reading': '{label}: {value} {unit}',
    'dashboard.chart.context.grouped': {
        one: '{count} mark is drawn together with a nearby one, so they stay readable.',
        other: '{count} marks are drawn together with nearby ones, so they stay readable.',
    },
    'dashboard.chart.context.moreGrouped': {
        one: 'and {count} more within the same stretch.',
        other: 'and {count} more within the same stretch.',
    },
    /** Next to a grouped marker, where only two or three characters fit. */
    'dashboard.chart.context.groupedShort': '\u00d7{count}',
    'dashboard.chart.context.omittedReadings': {
        one: '{count} older reading of the period is not drawn, to keep the chart readable.',
        other: '{count} older readings of the period are not drawn, to keep the chart readable.',
    },
    'dashboard.chart.context.omittedMarkers': {
        one: '{count} mark falls before the first reading drawn and is not shown.',
        other: '{count} marks fall before the first reading drawn and are not shown.',
    },

    // --- Day overlay over 24 hours (`dayOverlay.js`) --------------------------------------------
    'dashboard.chart.overlay.title': '24-hour profile',
    'dashboard.chart.overlay.ariaLabel': 'Every day of the period laid over a single 24-hour axis, '
        + 'with the hourly median',
    'dashboard.chart.overlay.caption': 'Every reading of the period in {unit} laid over a single '
        + '24-hour axis: one faint line per day, and the median of each hour in a thick line. '
        + 'Includes: {series}. Hours with no readings are left blank.',
    'dashboard.chart.overlay.days': {
        one: '{count} day is overlaid.',
        other: '{count} days are overlaid.',
    },
    'dashboard.chart.overlay.medianLabel': '{group} \u00b7 hourly median',
    'dashboard.chart.overlay.tooltip': '{label}: {value} {unit}',
    'dashboard.chart.overlay.targetRange': 'The shaded band is your target range, {low}\u2013{high} {unit}.',

    // --- Shared clipping: the view the reader and the preview share (ADR 0011) -------------------
    'clip.controls.title': 'What you are looking at',
    'clip.range.label': 'Period within this extract',
    'clip.range.all': 'The whole extract',
    'clip.range.day': 'Last day of the extract',
    'clip.range.week': 'Last 7 days of the extract',
    'clip.range.month': 'Last 30 days of the extract',
    'clip.range.custom': 'Custom period',
    'clip.range.from': 'From',
    'clip.range.to': 'To',
    /**
     * It is said out loud that this only narrows: whoever narrows expects, rightly, to widen
     * again, and here that stops at the clipping. Saying it prevents concluding records are missing.
     */
    'clip.range.help': 'This only narrows what is shown. The extract is a fixed snapshot and cannot '
        + 'be widened from here: nothing on this page can ask for a record that is not already in it.',
    'clip.types.label': 'Record types',
    'clip.search.label': 'Search',
    'clip.search.placeholder': 'Notes, foods, device...',
    'clip.search.help': 'Searching happens in this browser, over the records of this extract only. '
        + 'What you type is not sent anywhere. It narrows the timeline and the detail table; the '
        + 'charts and the statistics keep covering the whole selected period.',
    'clip.empty.type': 'This extract holds no records of this type for the period shown.',
    'clip.range.outside': 'The period you chose falls outside this extract, which covers {from} to '
        + '{to}. The whole extract is shown instead.',
    /**
     * The second line of the header: what is being looked at **now**, after narrowing. It is
     * printed, unlike the controls: on paper, a six-month clipping with a seven-day table and no
     * trace of the filter is a truncated history that reads as complete.
     */
    'clip.viewing.label': 'You are viewing',
    'clip.viewing.rangeAll': 'the whole extract',
    'clip.viewing.rangeFrom': 'from {from} onwards',
    'clip.viewing.rangeTo': 'up to {to}',
    'clip.viewing.rangeBetween': 'from {from} to {to}',
    'clip.viewing.allTypes': 'every record type in the extract',
    'clip.viewing.types': 'only {types}',
    'clip.viewing.noTypes': 'no record type',
    'clip.viewing.search': 'filtered by “{query}” in the timeline and the table',
    'clip.notice.undeclared': {
        one: '{count} record is of a type this extract does not declare, so it is not counted in the '
            + 'statistics or drawn in the charts. It is listed in the table below.',
        other: '{count} records are of types this extract does not declare, so they are not counted '
            + 'in the statistics or drawn in the charts. They are listed in the table below.',
    },
    'clip.notice.noDeclaredTypes': 'This extract does not declare which record types it includes, so '
        + 'every type found inside it is offered above.',
    'clip.notice.mixedUnits': 'Blood glucose in this extract was recorded in more than one unit. The '
        + 'statistics and the chart cover the {unit} readings only; nothing is converted, and the '
        + 'readings in another unit are counted separately under each card.',
    'clip.charts.title': 'Charts',
    'clip.stats.title': 'Statistics',
    'clip.timeline.title': 'Timeline',
    'clip.table.title': 'Every record in detail',
    'clip.notice.shown': {
        one: '{count} record shown, of the {total} in this extract.',
        other: '{count} records shown, of the {total} in this extract.',
    },
    'clip.notice.unreadable': {
        one: '{count} record in this extract could not be read. It is not counted in the statistics '
            + 'or drawn in the charts, and it is listed in the table below so that it is not missing.',
        other: '{count} records in this extract could not be read. They are not counted in the '
            + 'statistics or drawn in the charts, and they are listed in the table below so that they '
            + 'are not missing.',
    },

    // --- Reader page of a shared clipping (`reader/`, ADR 0011) ---------------------------------
    'reader.title': 'Shared health record',
    'reader.intro': 'Someone shared a read-only extract of their own health record with you. It is encrypted: nobody but this browser, with the PIN, can read it.',
    'reader.pin.title': 'Enter the PIN',
    'reader.pin.help': 'The six-digit PIN was given to you separately from this link. Working it out takes a few seconds on purpose, so that a stolen link is not enough by itself.',
    'reader.pin.label': 'PIN',
    'reader.pin.submit': 'Open the record',
    'reader.print': 'Print or save as PDF',
    'reader.stage.deriving': 'Working out the PIN in this browser. It takes a few seconds on purpose: that slowness is what stops anyone from trying every PIN. The page has not frozen — the bar is real progress.',
    'reader.stage.decrypting': 'Decrypting the record in this browser…',
    'reader.stage.rendering': 'Record opened. Preparing the charts and the table…',
    'reader.error.noFragment': 'This link arrived incomplete: the part after the # is missing, and that part is the key. Email filters and captive portals often strip it. Ask for the QR code or for the link to be sent again.',
    'reader.error.badFragment': 'This link is not a valid record link. Ask for the QR code or for the link to be sent again.',
    'reader.error.badPin': 'The PIN is {length} digits.',
    'reader.error.generic': 'The record could not be opened. Either the PIN is wrong or the link is no longer valid — expired, revoked, or never existed. The page cannot tell you which.',
    'reader.error.attempts': 'That is {used} of {max} failed attempts from this browser. After {max} failed attempts the link stops working and a new one has to be issued.',
    'reader.error.attemptsSpent': 'That is {max} failed attempts from this browser, so this link may already be dead. Ask for a new link and a new PIN.',
    'reader.error.tampered': 'The record arrived altered or incomplete and has not been shown. Nothing partial is displayed on purpose: half a clinical record reads like a whole one. Ask for a new link.',
    'reader.error.network': 'The record could not be fetched. Check the connection and try again.',
    'reader.header.count': {
        one: '{count} record',
        other: '{count} records',
    },
    'reader.header.rangeAll': 'Covering the whole history',
    'reader.header.rangeFrom': 'Covering from {from} onwards',
    'reader.header.rangeTo': 'Covering up to {to}',
    'reader.header.rangeBetween': 'Covering from {from} to {to}',
    'reader.header.generated': 'Generated on {at}',
    'reader.header.includes': 'Includes: {types}',
    'reader.header.includesNothing': 'Includes: no record type',
    'reader.header.excludes': 'Left out, and therefore not shown here even if it exists: {types}',
    'reader.header.snapshot': 'Check the number of records above against the rows below. It is a fixed snapshot of the period stated, not a live view of the record.',
    'reader.table.when': 'Date and time',
    'reader.table.what': 'Measurement',
    'reader.table.value': 'Value',
    'reader.table.details': 'Method and context',
    'reader.table.loinc': 'LOINC',
    'reader.table.empty': 'No records in this extract.',
    'reader.row.unreadable': 'Unreadable record',
    'reader.row.unknownType': 'Unknown record type',
    'reader.detail.pulse': 'Pulse {value}',
    'reader.detail.height': 'Height {value}',
    'reader.detail.noFoods': 'No foods listed',
    'reader.detail.device': 'Device: {device}',
    'reader.detail.recordedBy': 'Recorded by: {who}',
    'reader.detail.note': 'Note: {note}',
    'reader.notes.snapshot': 'This is a snapshot taken when the link was created. Records added afterwards are not in it.',
    'reader.notes.expiry': 'The link expires on its own and can be revoked at any time by the person who shared it. Save or print what you need.',
    'reader.notes.zeroKnowledge': 'The server stores this record encrypted and cannot read it. It is decrypted here, in this browser, with the key in the link and the PIN.',
    'reader.notes.noTracking': 'Opening this page sets no cookie and creates no account. The person who shared it is told only that it was opened for the first time, rounded to the hour.',
});
