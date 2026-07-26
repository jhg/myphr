/**
 * Catálogo castellano.
 *
 * Es el texto que la aplicación mostraba antes de existir esta capa, palabra por palabra, con dos
 * mejoras que el traslado permite: los recuentos dejan de decir «registro(s)» y «día(s)» y pasan a
 * tener su forma singular y plural de verdad, y las frases con datos dentro se escriben con
 * marcador en vez de por concatenación.
 *
 * @type {Readonly<Record<string, string|{one: string, other: string}>>}
 */
export const ES = Object.freeze({
    // --- Comunes a varias pantallas -------------------------------------------------------------
    'common.listSeparator': ', ',
    'common.locked.history': 'Necesitas iniciar sesión para ver tu historial.',
    'common.locked.summary': 'Necesitas iniciar sesión para ver tu resumen.',
    'common.locked.settings': 'Necesitas iniciar sesión para cambiar tus ajustes.',
    'common.missingDate': 'Introduce la fecha y hora.',
    'common.noSession': 'No hay una sesión activa. Vuelve a iniciar sesión.',
    'common.saveFailed': 'No se ha podido guardar el registro.',
    'common.undecryptable': 'No se ha podido descifrar el sobre.',
    'common.badDatetime': 'No se pudo interpretar la fecha y hora: "{value}".',
    'common.configuration': 'Esta instalación no está configurada correctamente. Avisa a quien la administra.',
    'common.network': 'No hemos podido contactar con el servidor. Inténtalo de nuevo.',
    'common.noLoincCode': 'No hay código LOINC para el método "{method}" con la unidad "{unit}".',
    'common.recordsUndecrypted': {
        one: '{count} registro no se pudo descifrar y no se muestra.',
        other: '{count} registros no se pudieron descifrar y no se muestran.',
    },

    // --- Nombres de campo, para los mensajes de `numericValue.js` -------------------------------
    'field.value': 'El valor',
    'field.dose': 'La dosis',
    'field.quantity': 'La cantidad',
    'field.systolic': 'La sistólica',
    'field.diastolic': 'La diastólica',
    'field.pulse': 'El pulso',
    'field.rangeLow': 'El límite inferior',
    'field.rangeHigh': 'El límite superior',

    // --- Validación numérica --------------------------------------------------------------------
    'numeric.notANumber': '{field} debe ser un número.',
    'numeric.negative': '{field} no puede ser negativo.',
    'numeric.tooManyDecimals': '{field} admite como mucho 2 decimales.',
    'numeric.notANumberHint': '{field} debe ser un número (usa "." o "," para los decimales).',

    // --- Etapas compartidas de la barra de progreso ---------------------------------------------
    'stage.preparing': 'Preparando…',
    'stage.saving': 'Guardando…',
    'stage.done': 'Listo.',
    'stage.entering': 'Entrando…',

    // --- Acceso ---------------------------------------------------------------------------------
    'login.stage.contacting': 'Comprobando tus datos…',
    'login.stage.stretching': 'Derivando tu clave en este dispositivo. Tarda unos segundos…',
    'login.error.credentials': 'No hemos podido entrar con esos datos.',

    // --- Alta de contraseña ---------------------------------------------------------------------
    'setPassword.stage.contacting': 'Comprobando el enlace…',
    'setPassword.stage.stretching': 'Derivando tu clave en este dispositivo. Tarda unos segundos…',
    'setPassword.stage.wrapping': 'Creando y protegiendo tu clave…',
    'setPassword.stage.verifying': 'Comprobando que tu contraseña abre tu clave. Tarda unos segundos…',
    'setPassword.error.link': 'Este enlace ya no sirve. Pide uno nuevo a quien administra el sistema.',
    'setPassword.error.mismatch': 'Las dos contraseñas no coinciden.',
    'setPassword.error.verification': 'Algo ha ido mal creando tu clave. No la hemos podido verificar.',

    // --- Alta pública (registro) ------------------------------------------------------------------
    'register.stage.contacting': 'Creando tu cuenta…',
    'register.stage.stretching': 'Derivando tu clave en este dispositivo. Tarda unos segundos…',
    'register.stage.wrapping': 'Creando y protegiendo tu clave…',
    'register.stage.verifying': 'Comprobando que tu contraseña abre tu clave. Tarda unos segundos…',
    'register.error.mismatch': 'Las dos contraseñas no coinciden.',
    'register.error.loginTaken': 'Ya existe una cuenta con ese correo electrónico.',
    'register.error.generic': 'Algo ha ido mal creando tu cuenta. No la hemos podido verificar.',

    // --- Cambio de contraseña -------------------------------------------------------------------
    'changePassword.stage.reauthenticating': 'Comprobando tu contraseña actual…',
    'changePassword.stage.stretchingOld':
        'Comprobando tu contraseña actual en este dispositivo. Tarda unos segundos…',
    'changePassword.stage.unwrapping': 'Abriendo tu clave…',
    'changePassword.stage.registering': 'Preparando la contraseña nueva…',
    'changePassword.stage.stretchingNew':
        'Protegiendo tu clave con la contraseña nueva. Tarda unos segundos…',
    'changePassword.error.mismatch': 'Las dos contraseñas nuevas no coinciden.',
    'changePassword.error.empty': 'Escribe tu contraseña actual y la nueva.',
    'changePassword.error.same': 'La contraseña nueva tiene que ser distinta de la actual.',
    'changePassword.error.currentPassword': 'La contraseña actual no es correcta.',
    'changePassword.error.unavailable':
        'Esta cuenta no puede cambiar su contraseña desde aquí. Avisa a quien administra el sistema.',
    'changePassword.error.expired': 'Has tardado demasiado. Vuelve a escribir tu contraseña actual.',
    'changePassword.error.verification': 'Algo ha ido mal protegiendo tu clave. Tu contraseña no ha cambiado.',
    'changePassword.success':
        'Tu contraseña se ha cambiado. Tus datos siguen siendo los mismos y siguen siendo legibles.',

    // --- Perfil ---------------------------------------------------------------------------------
    'profile.stage.reauth': 'Comprobando tu contraseña actual en este dispositivo. Tarda unos segundos…',
    'profile.stage.opening': 'Abriendo tu clave…',
    'profile.stage.stretching': 'Derivando tu clave nueva en este dispositivo. Tarda unos segundos…',
    'profile.stage.wrapping': 'Volviendo a proteger tu clave…',
    'profile.error.unit': 'Elige una unidad válida para la glucemia.',
    'profile.error.rangeIncomplete': 'Escribe los dos límites del rango, o deja los dos en blanco.',
    'profile.error.rangeOrder': 'El límite inferior tiene que ser menor que el superior.',
    'profile.error.rangeZero': 'Los límites del rango tienen que ser mayores que cero.',
    'profile.error.rangeUnit': 'Elige una unidad válida para el rango objetivo.',
    'profile.error.conflict': 'Tus ajustes han cambiado en otra pestaña. Recarga la página y vuelve a intentarlo.',
    'profile.error.settingsGeneric': 'No se han podido guardar los ajustes.',
    'profile.error.passwordExpired': 'Ha pasado demasiado tiempo. Vuelve a escribir tu contraseña actual.',
    'profile.error.passwordGeneric': 'No se ha podido cambiar la contraseña.',

    // --- Glucemia -------------------------------------------------------------------------------
    'glucose.empty': 'Todavía no hay registros de glucemia.',
    'glucose.missingValue': 'Introduce un valor.',
    'glucose.caption.includes': 'Incluye: {methods}.',
    'glucose.caption.noneInUnit': 'Ningún registro está en {unit}, así que la gráfica queda vacía.',
    'glucose.caption.excluded': {
        one: ' {count} registro en otra unidad distinta de {unit} no se muestra '
            + '(no se convierte entre mg/dL y mmol/L).',
        other: ' {count} registros en otra unidad distinta de {unit} no se muestran '
            + '(no se convierte entre mg/dL y mmol/L).',
    },

    // --- Tensión arterial -----------------------------------------------------------------------
    'bloodPressure.empty': 'Todavía no hay registros de tensión arterial.',
    'bloodPressure.missingSystolic': 'Introduce la sistólica.',
    'bloodPressure.missingDiastolic': 'Introduce la diastólica.',
    'bloodPressure.missingArm': 'Indica el brazo.',
    'bloodPressure.missingPosture': 'Indica la postura.',
    'bloodPressure.pulseInline': 'Pulso {value} {unit}',
    'bloodPressure.series.systolic': 'Sistólica · {method}',
    'bloodPressure.series.diastolic': 'Diastólica · {method}',
    'bloodPressure.caption.includes': 'Incluye: {methods}. Cada método (brazo y postura) es una serie aparte.',
    'bloodPressure.caption.empty': 'No hay datos de tensión que mostrar.',
    'bloodPressure.pulseCaption.includes': 'Incluye: {methods}.',
    'bloodPressure.pulseCaption.empty': 'No hay datos de pulso que mostrar.',
    'bloodPressure.pulseCaption.missing': {
        one: ' {count} registro sin pulso no se muestra en esta gráfica.',
        other: ' {count} registros sin pulso no se muestran en esta gráfica.',
    },

    // --- Comidas --------------------------------------------------------------------------------
    'meals.empty': 'Todavía no hay comidas registradas.',
    'meals.missingMealType': 'Elige un tipo de comida.',
    'meals.incompleteFood': 'Completa el nombre, la cantidad y la unidad de cada alimento, o quita la fila.',
    'meals.noFoods': 'Sin alimentos anotados.',

    // --- Insulina -------------------------------------------------------------------------------
    'insulin.empty': 'Todavía no hay registros de insulina.',
    'insulin.chartLocked': 'La gráfica necesita tu clave para poder mostrarse.',
    'insulin.chartEmpty': 'Aquí aparecerá la dosis total de cada día en cuanto guardes tu primer registro.',
    'insulin.missingDose': 'Introduce la dosis.',
    'insulin.missingInsulinType': 'Selecciona el tipo de insulina.',
    'insulin.yAxisTitle': 'Dosis total diaria ({unit})',
    'insulin.caption': {
        one: '{count} día con registro. Dosis acumulada por tipo — {totals}.',
        other: '{count} días con registro. Dosis acumulada por tipo — {totals}.',
    },

    // --- Panel de inicio ------------------------------------------------------------------------
    'dashboard.truncated': 'El resumen solo incluye los registros más recientes: hay demasiados en este periodo '
        + 'para cargarlos todos.',
    'dashboard.emptyGlucose': 'Todavía no hay registros de glucemia en este periodo.',
    'dashboard.emptyBloodPressure': 'Todavía no hay registros de tensión en este periodo.',
    'dashboard.addFirstGlucose': 'Añadir tu primera lectura',
    'dashboard.addFirstBloodPressure': 'Añadir tu primera lectura',
    'dashboard.targetRangeUnitMismatch': 'Tu rango objetivo está guardado en otra unidad, así que no se '
        + 'puede calcular el tiempo en rango sobre lecturas en {unit}. Ajusta la unidad del rango o la de '
        + 'presentación en los ajustes.',
    'dashboard.targetRangeInvite': 'Configura tu rango objetivo de glucemia en los ajustes para ver aquí qué '
        + 'porcentaje del tiempo pasas dentro de él.',
    'dashboard.generic': 'No se ha podido cargar el resumen.',
    'dashboard.recordsUndecrypted': {
        one: '{count} registro no se pudo descifrar y no entra en este resumen.',
        other: '{count} registros no se pudieron descifrar y no entran en este resumen.',
    },
    'dashboard.excludedByUnit': {
        one: '{count} registro en otra unidad distinta de {unit} no se muestra '
            + '(no se convierte entre mg/dL y mmol/L).',
        other: '{count} registros en otra unidad distinta de {unit} no se muestran '
            + '(no se convierte entre mg/dL y mmol/L).',
    },
    'dashboard.window.week': 'Última semana',
    'dashboard.window.month': 'Último mes',
    'dashboard.window.lastDays': 'Últimos {days} días',
    'dashboard.stat.count': 'Recuento',
    'dashboard.stat.mean': 'Media',
    'dashboard.stat.median': 'Mediana',
    'dashboard.stat.min': 'Mínimo',
    'dashboard.stat.max': 'Máximo',
    'dashboard.stat.lastReading': 'Última lectura',
    'dashboard.stat.timeInRange': 'Tiempo en rango',
    'dashboard.stat.withMean': '{magnitude} · media',
    'dashboard.stat.withMedian': '{magnitude} · mediana',
    'dashboard.stat.withRange': '{magnitude} · rango',
    'dashboard.magnitude.systolic': 'Sistólica',
    'dashboard.magnitude.diastolic': 'Diastólica',
    'dashboard.magnitude.pulse': 'Pulso',
    'dashboard.bp.lastReadingCaption': 'Última lectura (sistólica/diastólica)',
    'dashboard.unit.bpm': 'lpm',
    'dashboard.method.capillary': 'Capilar',
    'dashboard.method.interstitial': 'Intersticial',
    'dashboard.method.combined': '{arm}, {posture}',
    'dashboard.arm.left': 'Izquierdo',
    'dashboard.arm.right': 'Derecho',
    'dashboard.posture.sitting': 'sentado',
    'dashboard.posture.lying': 'tumbado',
    'dashboard.posture.standing': 'de pie',
});
