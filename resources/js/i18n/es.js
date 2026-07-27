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

    // --- Rango de fechas del historial (`health/dateRange.js`) ----------------------------------
    'range.error.incomplete': 'Elige las dos fechas del rango a medida.',
    'range.error.order': 'La fecha de inicio tiene que ser anterior a la de fin.',
    'range.error.badDate': 'No se han podido leer las fechas del rango.',
    'range.error.badPreset': 'No existe ese periodo: «{preset}».',

    // --- Nombres de campo, para los mensajes de `numericValue.js` -------------------------------
    'field.value': 'El valor',
    'field.dose': 'La dosis',
    'field.quantity': 'La cantidad',
    'field.systolic': 'La sistólica',
    'field.diastolic': 'La diastólica',
    'field.pulse': 'El pulso',
    'field.weight': 'El peso',
    'field.temperature': 'La temperatura',
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

    // --- Peso corporal --------------------------------------------------------------------------
    'bodyWeight.empty': 'Todavía no hay registros de peso.',
    'bodyWeight.missingValue': 'Introduce un peso.',
    'bodyWeight.missingUnit': 'Elige una unidad.',
    'bodyWeight.caption.includes': 'Incluye: {units}. Cada unidad es una serie aparte: no se convierte '
        + 'entre kilogramos y libras.',
    'bodyWeight.caption.empty': 'No hay datos de peso que mostrar.',

    // --- Temperatura corporal -------------------------------------------------------------------
    'temperature.empty': 'Todavía no hay registros de temperatura.',
    'temperature.missingValue': 'Introduce una temperatura.',
    'temperature.missingUnit': 'Elige una unidad.',
    'temperature.missingSite': 'Indica dónde tomaste la temperatura.',
    'temperature.noLoincCode': 'No hay código LOINC para el sitio de medición «{site}».',
    'temperature.series': '{site} · {unit}',
    'temperature.caption.includes': 'Incluye: {series}. Cada sitio de medición y cada unidad son una '
        + 'serie aparte: no son comparables entre sí.',
    'temperature.caption.empty': 'No hay datos de temperatura que mostrar.',

    // --- Panel de inicio ------------------------------------------------------------------------
    'dashboard.truncated': 'El resumen solo incluye los registros más recientes: hay demasiados en este periodo '
        + 'para cargarlos todos.',
    'dashboard.empty': 'Todavía no hay registros en este periodo.',
    'dashboard.addFirst': 'Añade tu primer registro',
    'dashboard.typeFilter.none': 'No hay ningún tipo de evento marcado, así que no hay nada que mostrar. '
        + 'Marca al menos uno.',
    'dashboard.loadedCount': {
        one: '{count} registro de los tipos marcados en este periodo.',
        other: '{count} registros de los tipos marcados en este periodo.',
    },
    'dashboard.search.hidden': {
        one: '{count} registro de este periodo no coincide con lo que has buscado. Se sigue contando '
            + 'en las gráficas y en las estadísticas.',
        other: '{count} registros de este periodo no coinciden con lo que has buscado. Se siguen '
            + 'contando en las gráficas y en las estadísticas.',
    },
    'dashboard.empty.search': 'Ningún registro de este periodo coincide con lo que has buscado.',
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
            + '(no se convierte entre unidades).',
        other: '{count} registros en otra unidad distinta de {unit} no se muestran '
            + '(no se convierte entre unidades).',
    },
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

    // --- Línea temporal unificada del panel de inicio --------------------------------------------
    'dashboard.timeline.capped': {
        one: 'Se muestran las {shown} entradas más recientes del periodo; {count} más antigua no aparece.',
        other: 'Se muestran las {shown} entradas más recientes del periodo; {count} más antiguas no aparecen.',
    },
    'dashboard.timeline.unsupported': {
        one: '{count} registro es de un tipo que esta línea temporal todavía no sabe resumir, así que no aparece.',
        other: '{count} registros son de un tipo que esta línea temporal todavía no sabe resumir, '
            + 'así que no aparecen.',
    },
    'dashboard.timeline.type.glucose': 'Glucemia',
    'dashboard.timeline.type.bloodPressure': 'Tensión arterial',
    'dashboard.timeline.type.insulin': 'Insulina',
    'dashboard.timeline.type.meal': 'Comida',
    'dashboard.timeline.type.bodyWeight': 'Peso corporal',
    'dashboard.timeline.type.temperature': 'Temperatura',
    'dashboard.timeline.measurement': '{value} {unit}',
    'dashboard.timeline.bloodPressureReading': '{systolic}/{diastolic} {unit}',
    'dashboard.timeline.pulse': '{pulse} {unit}',
    'dashboard.timeline.noFoods': 'sin alimentos anotados',
    'dashboard.timeline.moreFoods': '+{count}',
    'dashboard.timeline.insulinType.rapid': 'Rápida',
    'dashboard.timeline.insulinType.long': 'Lenta',
    'dashboard.timeline.insulinType.mixed': 'Mixta',
    'dashboard.timeline.mealType.breakfast': 'Desayuno',
    'dashboard.timeline.mealType.lunch': 'Comida',
    'dashboard.timeline.mealType.dinner': 'Cena',
    'dashboard.timeline.mealType.snack': 'Tentempié',
    'dashboard.timeline.site.axillary': 'Axilar',
    'dashboard.timeline.site.oral': 'Oral',
    'dashboard.timeline.site.tympanic': 'Timpánica (oído)',
    'dashboard.timeline.site.temporal': 'Frente (arteria temporal)',
    'dashboard.timeline.site.rectal': 'Rectal',

    // --- Compartir un recorte con un profesional (`health/sharePage.js`, ADR 0011) --------------
    'share.stage.reading': 'Leyendo tus registros…',
    'share.stage.decrypting': 'Descifrando tus registros…',
    'share.stage.packing': 'Comprimiendo y cifrando el recorte…',
    'share.stage.pin': 'Protegiendo el PIN…',
    'share.stage.uploading': 'Subiendo el recorte…',
    'share.stage.done': 'Recorte listo.',
    'share.error.noTypes': 'Elige al menos un tipo de registro para compartir.',
    'share.error.badTtl': 'Esa caducidad no es una de las opciones disponibles.',
    'share.error.empty': 'No hay registros de esos tipos en ese periodo, así que no hay nada que compartir.',
    'share.error.tooLarge': 'El recorte es demasiado grande para compartirlo. Acorta el periodo o deja fuera algún tipo de registro.',
    'share.error.tooManyEvents': 'Ese periodo tiene más de {count} registros. Acórtalo y vuelve a intentarlo.',
    'share.error.undecryptable': {
        one: '{count} registro de ese periodo no se ha podido descifrar. El recorte no se ha creado, porque un registro que falta es indistinguible de un registro que nunca existió.',
        other: '{count} registros de ese periodo no se han podido descifrar. El recorte no se ha creado, porque unos registros que faltan son indistinguibles de unos registros que nunca existieron.',
    },
    'share.error.limit': 'Ya tienes todos los recortes activos que se permiten. Revoca uno antes de volver a compartir.',
    'share.error.upload': 'No se ha podido subir el recorte. No se ha compartido nada.',
    'share.error.copy': 'No se ha podido copiar el enlace. Selecciónalo y cópialo a mano.',
    'share.error.generic': 'No se ha podido crear el recorte.',
    'share.qr.alt': 'Código QR con el enlace completo al recorte.',
    'share.range.all': 'Todo tu historial',
    'share.range.from': 'Desde {from}',
    'share.range.to': 'Hasta {to}',
    'share.range.between': 'Del {from} al {to}',
    'share.list.empty': 'No tienes ningún recorte activo.',
    'share.list.undecryptable': 'Este recorte no se ha podido descifrar, así que no se puede enseñar qué contiene. Sigue compartido: si tienes dudas, revócalo.',
    'share.list.types': 'Incluye: {types}',
    'share.list.records': {
        one: '{count} registro',
        other: '{count} registros',
    },
    'share.list.expires': 'Caduca el {at}',
    'share.list.opened': 'Se abrió por primera vez el {at} (redondeado a la hora; no hay registro de accesos)',
    'share.list.notOpened': 'Todavía no se ha abierto',
    'share.list.revoke': 'Revocar',
    'share.list.confirmRevoke': 'Revocar borra el recorte para siempre. No recupera lo que ya se haya descargado.',
    'share.list.confirmRevokeAction': 'Revocar para siempre',
    'share.list.cancel': 'Cancelar',
    // --- Estatura e índice de masa corporal (pantalla de peso y perfil) --------------------------
    'field.height': 'La estatura',
    'bodyWeight.missingHeightUnit': 'Elige una unidad para la estatura.',
    'bodyWeight.heightInline': 'Estatura {value} {unit}',
    'bodyWeight.bmi': 'IMC {value}',
    'bodyWeight.bmiWithHeightFrom': 'IMC {value} · con la estatura registrada el {date}',
    'profile.body.none': 'Todavía sin registrar',
    'profile.body.noBmi': 'Registra una estatura para verlo',
    'profile.body.fromRecords': 'De tu último peso y tu última estatura',
    'profile.error.measurementsGeneric': 'No se han podido cargar tus últimas medidas.',

    // --- Gráficas del panel de inicio ------------------------------------------------------------
    'dashboard.chart.caption': 'Mediana diaria en {unit}, con una banda del valor más bajo al más '
        + 'alto de ese día. Incluye: {series}. Los días sin lecturas se dejan en blanco.',
    'dashboard.chart.empty': 'No hay lecturas en este periodo: la gráfica aparece en cuanto las haya.',
    'dashboard.chart.omittedDays': {
        one: '{count} día más antiguo del periodo no se dibuja, para que la gráfica siga siendo legible.',
        other: 'Los {count} días más antiguos del periodo no se dibujan, para que la gráfica siga siendo legible.',
    },
    'dashboard.chart.seriesMagnitude': '{group} \u00b7 {magnitude}',
    'dashboard.chart.tooltip': '{label}: mediana {median} {unit} (de {min} a {max})',
    'dashboard.chart.tooltipSingle': '{label}: {value} {unit} (una sola lectura)',
    'dashboard.chart.ariaLabel': 'Mediana diaria y rango diario de {type}',

    // --- Recorte compartido: la vista que comparten el lector y la vista previa (ADR 0011) -------
    'clip.controls.title': 'Qué estás viendo',
    'clip.range.label': 'Periodo dentro de este extracto',
    'clip.range.all': 'Todo el extracto',
    'clip.range.day': 'Último día del extracto',
    'clip.range.week': 'Últimos 7 días del extracto',
    'clip.range.month': 'Últimos 30 días del extracto',
    'clip.range.custom': 'Periodo a medida',
    'clip.range.from': 'Desde',
    'clip.range.to': 'Hasta',
    'clip.range.help': 'Esto solo acota lo que se enseña. El extracto es una foto fija y desde aquí '
        + 'no se puede ampliar: nada de esta página puede pedir un registro que no esté ya dentro.',
    'clip.types.label': 'Tipos de registro',
    'clip.search.label': 'Buscar',
    'clip.search.placeholder': 'Notas, alimentos, aparato...',
    'clip.search.help': 'La búsqueda ocurre en este navegador, y solo sobre los registros de este '
        + 'recorte. Lo que escribas no se envía a ninguna parte. Acota la línea temporal y la tabla '
        + 'de detalle; las gráficas y las estadísticas siguen cubriendo el periodo elegido entero.',
    'clip.empty.type': 'Este recorte no contiene registros de este tipo en el periodo mostrado.',
    'clip.range.outside': 'El periodo que has elegido queda fuera de este recorte, que va del {from} '
        + 'al {to}. Se enseña el recorte entero.',
    /**
     * La segunda línea de la cabecera: qué se está mirando **ahora**, después de acotar. Se imprime,
     * a diferencia de los controles: en papel, un recorte de seis meses con una tabla de siete días
     * y ninguna huella del filtro es un historial truncado que se lee como completo.
     */
    'clip.viewing.label': 'Estás viendo',
    'clip.viewing.rangeAll': 'el recorte entero',
    'clip.viewing.rangeFrom': 'desde el {from}',
    'clip.viewing.rangeTo': 'hasta el {to}',
    'clip.viewing.rangeBetween': 'del {from} al {to}',
    'clip.viewing.allTypes': 'todos los tipos de registro del recorte',
    'clip.viewing.types': 'solo {types}',
    'clip.viewing.noTypes': 'ningún tipo de registro',
    'clip.viewing.search': 'filtrado por «{query}» en la línea temporal y en la tabla',
    'clip.notice.undeclared': {
        one: '{count} registro es de un tipo que este recorte no declara, así que no se cuenta '
            + 'en las estadísticas ni se dibuja en las gráficas. Aparece en la tabla de abajo.',
        other: '{count} registros son de tipos que este recorte no declara, así que no se cuentan '
            + 'en las estadísticas ni se dibujan en las gráficas. Aparecen en la tabla de abajo.',
    },
    'clip.notice.noDeclaredTypes': 'Este recorte no declara qué tipos de registro incluye, así '
        + 'que arriba se ofrecen todos los que se han encontrado dentro.',
    'clip.notice.mixedUnits': 'Las glucemias de este recorte se anotaron en más de una unidad. Las '
        + 'estadísticas y la gráfica cubren solo las lecturas en {unit}; no se convierte nada, y '
        + 'las que están en otra unidad se cuentan aparte debajo de cada tarjeta.',
    'clip.charts.title': 'Gráficas',
    'clip.stats.title': 'Estadísticas',
    'clip.timeline.title': 'Línea temporal',
    'clip.table.title': 'Todos los registros en detalle',
    'clip.notice.shown': {
        one: 'Se enseña {count} registro, de los {total} de este extracto.',
        other: 'Se enseñan {count} registros, de los {total} de este extracto.',
    },
    'clip.notice.unreadable': {
        one: '{count} registro de este extracto no se ha podido leer. No cuenta en las estadísticas '
            + 'ni se dibuja en las gráficas, y aparece en la tabla de abajo para que no falte.',
        other: '{count} registros de este extracto no se han podido leer. No cuentan en las '
            + 'estadísticas ni se dibujan en las gráficas, y aparecen en la tabla de abajo para que '
            + 'no falten.',
    },

    // --- Página del lector de un recorte compartido (`reader/`, ADR 0011) -----------------------
    'reader.title': 'Historial de salud compartido',
    'reader.intro': 'Alguien ha compartido contigo un extracto de solo lectura de su propio historial de salud. Está cifrado: nadie salvo este navegador, con el PIN, puede leerlo.',
    'reader.pin.title': 'Introduce el PIN',
    'reader.pin.help': 'El PIN de seis dígitos te lo han dado por una vía distinta de este enlace. Comprobarlo tarda unos segundos a propósito, para que un enlace robado no baste por sí solo.',
    'reader.pin.label': 'PIN',
    'reader.pin.submit': 'Abrir el historial',
    'reader.print': 'Imprimir o guardar en PDF',
    'reader.stage.deriving': 'Comprobando el PIN. Tarda unos segundos por diseño; la página no se ha colgado.',
    'reader.stage.decrypting': 'Descifrando el historial en este navegador…',
    'reader.error.noFragment': 'Este enlace ha llegado incompleto: falta la parte posterior al #, y esa parte es la clave. Los filtros de correo y los portales cautivos suelen comérsela. Pide el código QR o que te manden el enlace otra vez.',
    'reader.error.badFragment': 'Este enlace no es un enlace de historial válido. Pide el código QR o que te manden el enlace otra vez.',
    'reader.error.badPin': 'El PIN son {length} dígitos.',
    'reader.error.generic': 'No se ha podido abrir el historial. O el PIN no es correcto, o el enlace ya no vale: caducado, revocado o inexistente. Esta página no puede decirte cuál de los cuatro.',
    'reader.error.attempts': 'Van {used} intentos fallidos de {max} desde este navegador. Tras {max} fallos el enlace deja de funcionar y hay que emitir uno nuevo.',
    'reader.error.attemptsSpent': 'Van {max} intentos fallidos desde este navegador, así que este enlace puede estar ya muerto. Pide un enlace nuevo y un PIN nuevo.',
    'reader.error.tampered': 'El historial ha llegado alterado o incompleto y no se ha mostrado. No se enseña nada parcial a propósito: medio historial clínico se lee igual que uno entero. Pide un enlace nuevo.',
    'reader.error.network': 'No se ha podido descargar el historial. Comprueba la conexión y vuelve a intentarlo.',
    'reader.header.count': {
        one: '{count} registro',
        other: '{count} registros',
    },
    'reader.header.rangeAll': 'Cubre todo el historial',
    'reader.header.rangeFrom': 'Cubre desde {from} en adelante',
    'reader.header.rangeTo': 'Cubre hasta {to}',
    'reader.header.rangeBetween': 'Cubre del {from} al {to}',
    'reader.header.generated': 'Generado el {at}',
    'reader.header.includes': 'Incluye: {types}',
    'reader.header.includesNothing': 'Incluye: ningún tipo de registro',
    'reader.header.excludes': 'Se dejó fuera, y por tanto no aparece aquí aunque exista: {types}',
    'reader.header.snapshot': 'Contrasta el número de registros de arriba con las filas de abajo. Es una foto fija del periodo indicado, no una vista en vivo del historial.',
    'reader.table.when': 'Fecha y hora',
    'reader.table.what': 'Medición',
    'reader.table.value': 'Valor',
    'reader.table.details': 'Método y contexto',
    'reader.table.loinc': 'LOINC',
    'reader.table.empty': 'No hay registros en este extracto.',
    'reader.row.unreadable': 'Registro ilegible',
    'reader.row.unknownType': 'Tipo de registro desconocido',
    'reader.detail.pulse': 'Pulso {value}',
    'reader.detail.height': 'Estatura {value}',
    'reader.detail.noFoods': 'Sin alimentos anotados',
    'reader.detail.device': 'Aparato: {device}',
    'reader.detail.recordedBy': 'Lo apuntó: {who}',
    'reader.detail.note': 'Nota: {note}',
    'reader.notes.snapshot': 'Esto es una foto fija tomada al crear el enlace. Los registros añadidos después no están.',
    'reader.notes.expiry': 'El enlace caduca solo y quien lo compartió puede revocarlo en cualquier momento. Guarda o imprime lo que necesites.',
    'reader.notes.zeroKnowledge': 'El servidor guarda este historial cifrado y no puede leerlo. Se descifra aquí, en este navegador, con la clave del enlace y el PIN.',
    'reader.notes.noTracking': 'Abrir esta página no deja ninguna cookie ni crea ninguna cuenta. A quien lo compartió solo se le dice que se abrió por primera vez, redondeado a la hora.',
});
