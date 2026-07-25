/**
 * Catálogo inglés, el idioma por defecto (`config/app.php`, `APP_LOCALE=en`).
 *
 * Es también el catálogo de respaldo: cualquier clave que falte en `es.js` o en `zh_CN.js` cae
 * aquí, así que este fichero tiene que estar siempre completo. `tests/js/i18n.test.mjs` comprueba
 * que los tres tienen exactamente el mismo juego de claves.
 *
 * Una entrada con forma `{one, other}` es una frase con recuento: `t()` elige la variante con
 * `Intl.PluralRules` a partir de `count`. Nunca se escribe «record(s)».
 *
 * @type {Readonly<Record<string, string|{one: string, other: string}>>}
 */
export const EN = Object.freeze({
    // --- Comunes a varias pantallas -------------------------------------------------------------
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
    'common.noLoincCode': 'There is no LOINC code for method "{method}" with unit "{unit}".',
    'common.recordsUndecrypted': {
        one: '{count} record could not be decrypted and is not shown.',
        other: '{count} records could not be decrypted and are not shown.',
    },

    // --- Nombres de campo, para los mensajes de `numericValue.js` -------------------------------
    'field.value': 'The value',
    'field.dose': 'The dose',
    'field.quantity': 'The quantity',
    'field.systolic': 'The systolic pressure',
    'field.diastolic': 'The diastolic pressure',
    'field.pulse': 'The pulse',
    'field.rangeLow': 'The lower limit',
    'field.rangeHigh': 'The upper limit',

    // --- Validación numérica --------------------------------------------------------------------
    'numeric.notANumber': '{field} must be a number.',
    'numeric.negative': '{field} cannot be negative.',
    'numeric.tooManyDecimals': '{field} takes at most 2 decimal places.',
    'numeric.notANumberHint': '{field} must be a number (use "." or "," for decimals).',

    // --- Etapas compartidas de la barra de progreso ---------------------------------------------
    'stage.preparing': 'Preparing…',
    'stage.saving': 'Saving…',
    'stage.done': 'Done.',
    'stage.entering': 'Signing in…',

    // --- Acceso ---------------------------------------------------------------------------------
    'login.stage.contacting': 'Checking your details…',
    'login.stage.stretching': 'Deriving your key on this device. It takes a few seconds…',
    'login.error.credentials': 'We could not sign you in with those details.',

    // --- Alta de contraseña ---------------------------------------------------------------------
    'setPassword.stage.contacting': 'Checking the link…',
    'setPassword.stage.stretching': 'Deriving your key on this device. It takes a few seconds…',
    'setPassword.stage.wrapping': 'Creating and protecting your key…',
    'setPassword.stage.verifying': 'Checking that your password opens your key. It takes a few seconds…',
    'setPassword.error.link': 'This link no longer works. Ask whoever administers the system for a new one.',
    'setPassword.error.mismatch': 'The two passwords do not match.',
    'setPassword.error.verification': 'Something went wrong creating your key. We could not verify it.',

    // --- Cambio de contraseña -------------------------------------------------------------------
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

    // --- Perfil ---------------------------------------------------------------------------------
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

    // --- Glucemia -------------------------------------------------------------------------------
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

    // --- Tensión arterial -----------------------------------------------------------------------
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

    // --- Comidas --------------------------------------------------------------------------------
    'meals.empty': 'There are no meals recorded yet.',
    'meals.missingMealType': 'Choose a meal type.',
    'meals.incompleteFood': 'Fill in the name, the quantity and the unit of every food, or remove the row.',
    'meals.noFoods': 'No foods written down.',

    // --- Insulina -------------------------------------------------------------------------------
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

    // --- Panel de inicio ------------------------------------------------------------------------
    'dashboard.truncated':
        'The summary only includes the most recent records: there are too many in this period to load them all.',
    'dashboard.emptyGlucose': 'There are no blood glucose records in this period yet.',
    'dashboard.emptyBloodPressure': 'There are no blood pressure records in this period yet.',
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
            + '(there is no conversion between mg/dL and mmol/L).',
        other: '{count} records in a unit other than {unit} are not shown '
            + '(there is no conversion between mg/dL and mmol/L).',
    },
    'dashboard.window.week': 'Last week',
    'dashboard.window.month': 'Last month',
    'dashboard.window.lastDays': 'Last {days} days',
    'dashboard.stat.count': 'Count',
    'dashboard.stat.mean': 'Mean',
    'dashboard.stat.median': 'Median',
    'dashboard.stat.min': 'Minimum',
    'dashboard.stat.max': 'Maximum',
    'dashboard.stat.lastReading': 'Last reading',
    'dashboard.stat.timeInRange': 'Time in range',
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
});
