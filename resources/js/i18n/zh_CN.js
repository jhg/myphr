/**
 * Catálogo de chino simplificado (`zh_CN`, el mismo nombre de carpeta que usan Laravel y Filament).
 *
 * Dos cosas que no son traducción literal y sí decisiones del idioma:
 *
 * * **Puntuación de ancho completo.** El punto es `。`, la coma enumerativa `、` y los dos puntos
 *   `：`. Por eso el separador de listas y las frases con marcador se traducen enteras: una frase
 *   armada por concatenación en el código llevaría dentro la puntuación occidental.
 * * **Sin espacio de separación entre frases.** Las entradas que en inglés y castellano empiezan
 *   por un espacio (las que se pegan detrás de otra frase) aquí no lo llevan, porque el chino no
 *   separa oraciones con espacio.
 *
 * Los términos oficiales LOINC no aparecen aquí a propósito (ADR 0005): el `display` de FHIR lleva
 * el término publicado por Regenstrief, que no tiene traducción oficial al chino, y traducirlo
 * sería inventarse un término de la terminología. Lo que sí se traduce es la etiqueta al paciente,
 * que es nuestra.
 *
 * @type {Readonly<Record<string, string|{other: string}>>}
 */
export const ZH_CN = Object.freeze({
    // --- Comunes a varias pantallas -------------------------------------------------------------
    'common.listSeparator': '、',
    'common.locked.history': '需要先登录才能查看你的历史记录。',
    'common.locked.summary': '需要先登录才能查看你的概览。',
    'common.locked.settings': '需要先登录才能修改你的设置。',
    'common.missingDate': '请填写日期和时间。',
    'common.noSession': '当前没有有效的会话，请重新登录。',
    'common.saveFailed': '记录未能保存。',
    'common.undecryptable': '无法解密该信封。',
    'common.badDatetime': '无法识别日期和时间：“{value}”。',
    'common.configuration': '本系统未正确配置，请告知系统管理员。',
    'common.network': '无法连接到服务器，请重试。',
    'common.noLoincCode': '方法“{method}”与单位“{unit}”没有对应的 LOINC 代码。',
    'common.recordsUndecrypted': { other: '有 {count} 条记录无法解密，未予显示。' },

    // --- Nombres de campo, para los mensajes de `numericValue.js` -------------------------------
    'field.value': '数值',
    'field.dose': '剂量',
    'field.quantity': '数量',
    'field.systolic': '收缩压',
    'field.diastolic': '舒张压',
    'field.pulse': '脉搏',
    'field.rangeLow': '下限',
    'field.rangeHigh': '上限',

    // --- Validación numérica --------------------------------------------------------------------
    'numeric.notANumber': '{field}必须是数字。',
    'numeric.negative': '{field}不能为负数。',
    'numeric.tooManyDecimals': '{field}最多只能有 2 位小数。',
    'numeric.notANumberHint': '{field}必须是数字（小数点可用“.”或“,”）。',

    // --- Etapas compartidas de la barra de progreso ---------------------------------------------
    'stage.preparing': '正在准备…',
    'stage.saving': '正在保存…',
    'stage.done': '完成。',
    'stage.entering': '正在登录…',

    // --- Acceso ---------------------------------------------------------------------------------
    'login.stage.contacting': '正在核对你的信息…',
    'login.stage.stretching': '正在本设备上派生你的密钥，需要几秒钟…',
    'login.error.credentials': '无法用这些信息登录。',

    // --- Alta de contraseña ---------------------------------------------------------------------
    'setPassword.stage.contacting': '正在检查链接…',
    'setPassword.stage.stretching': '正在本设备上派生你的密钥，需要几秒钟…',
    'setPassword.stage.wrapping': '正在创建并保护你的密钥…',
    'setPassword.stage.verifying': '正在确认你的密码能打开你的密钥，需要几秒钟…',
    'setPassword.error.link': '此链接已失效，请向系统管理员索取新的链接。',
    'setPassword.error.mismatch': '两次输入的密码不一致。',
    'setPassword.error.verification': '创建密钥时出错，无法完成验证。',

    // --- Alta pública (registro) ------------------------------------------------------------------
    'register.stage.contacting': '正在创建你的账户…',
    'register.stage.stretching': '正在本设备上派生你的密钥，需要几秒钟…',
    'register.stage.wrapping': '正在创建并保护你的密钥…',
    'register.stage.verifying': '正在确认你的密码能打开你的密钥，需要几秒钟…',
    'register.error.mismatch': '两次输入的密码不一致。',
    'register.error.loginTaken': '该邮箱已存在账户。',
    'register.error.generic': '创建账户时出错，无法完成验证。',

    // --- Cambio de contraseña -------------------------------------------------------------------
    'changePassword.stage.reauthenticating': '正在核对你的当前密码…',
    'changePassword.stage.stretchingOld': '正在本设备上核对你的当前密码，需要几秒钟…',
    'changePassword.stage.unwrapping': '正在打开你的密钥…',
    'changePassword.stage.registering': '正在准备新密码…',
    'changePassword.stage.stretchingNew': '正在用新密码保护你的密钥，需要几秒钟…',
    'changePassword.error.mismatch': '两次输入的新密码不一致。',
    'changePassword.error.empty': '请输入你的当前密码和新密码。',
    'changePassword.error.same': '新密码必须与当前密码不同。',
    'changePassword.error.currentPassword': '当前密码不正确。',
    'changePassword.error.unavailable': '此账户无法在这里修改密码，请告知系统管理员。',
    'changePassword.error.expired': '操作超时，请重新输入你的当前密码。',
    'changePassword.error.verification': '保护你的密钥时出错，密码没有改变。',
    'changePassword.success': '你的密码已更改。你的数据没有变化，仍然可以读取。',

    // --- Perfil ---------------------------------------------------------------------------------
    'profile.stage.reauth': '正在本设备上核对你的当前密码，需要几秒钟…',
    'profile.stage.opening': '正在打开你的密钥…',
    'profile.stage.stretching': '正在本设备上派生你的新密钥，需要几秒钟…',
    'profile.stage.wrapping': '正在重新保护你的密钥…',
    'profile.error.unit': '请选择有效的血糖单位。',
    'profile.error.rangeIncomplete': '请填写目标范围的上下限，或者两个都留空。',
    'profile.error.rangeOrder': '下限必须小于上限。',
    'profile.error.rangeZero': '目标范围的上下限必须大于零。',
    'profile.error.rangeUnit': '请为目标范围选择有效的单位。',
    'profile.error.conflict': '你的设置在另一个标签页中已被修改，请刷新页面后重试。',
    'profile.error.settingsGeneric': '设置未能保存。',
    'profile.error.passwordExpired': '距离上次验证已过去太久，请重新输入你的当前密码。',
    'profile.error.passwordGeneric': '密码未能更改。',

    // --- Glucemia -------------------------------------------------------------------------------
    'glucose.empty': '目前还没有血糖记录。',
    'glucose.missingValue': '请填写数值。',
    'glucose.caption.includes': '包含：{methods}。',
    'glucose.caption.noneInUnit': '没有任何记录使用 {unit}，因此图表为空。',
    'glucose.caption.excluded': {
        other: '有 {count} 条记录使用了 {unit} 以外的单位，未予显示（mg/dL 与 mmol/L 之间不做换算）。',
    },

    // --- Tensión arterial -----------------------------------------------------------------------
    'bloodPressure.empty': '目前还没有血压记录。',
    'bloodPressure.missingSystolic': '请填写收缩压。',
    'bloodPressure.missingDiastolic': '请填写舒张压。',
    'bloodPressure.missingArm': '请指明测量的手臂。',
    'bloodPressure.missingPosture': '请指明测量时的体位。',
    'bloodPressure.pulseInline': '脉搏 {value} {unit}',
    'bloodPressure.series.systolic': '收缩压 · {method}',
    'bloodPressure.series.diastolic': '舒张压 · {method}',
    'bloodPressure.caption.includes': '包含：{methods}。每种测量方式（手臂与体位）各自成为一条曲线。',
    'bloodPressure.caption.empty': '没有可显示的血压数据。',
    'bloodPressure.pulseCaption.includes': '包含：{methods}。',
    'bloodPressure.pulseCaption.empty': '没有可显示的脉搏数据。',
    'bloodPressure.pulseCaption.missing': { other: '有 {count} 条记录没有脉搏，未显示在本图中。' },

    // --- Comidas --------------------------------------------------------------------------------
    'meals.empty': '目前还没有用餐记录。',
    'meals.missingMealType': '请选择餐次。',
    'meals.incompleteFood': '请填写每种食物的名称、数量和单位，或者删除该行。',
    'meals.noFoods': '没有记录任何食物。',

    // --- Insulina -------------------------------------------------------------------------------
    'insulin.empty': '目前还没有胰岛素记录。',
    'insulin.chartLocked': '图表需要你的密钥才能显示。',
    'insulin.chartEmpty': '保存第一条记录后，这里会显示每天的总剂量。',
    'insulin.missingDose': '请填写剂量。',
    'insulin.missingInsulinType': '请选择胰岛素类型。',
    'insulin.yAxisTitle': '每日总剂量（{unit}）',
    'insulin.caption': { other: '有 {count} 天存在记录。按类型累计的剂量 — {totals}。' },

    // --- Panel de inicio ------------------------------------------------------------------------
    'dashboard.truncated': '本概览只包含最近的记录：这段时间内的记录太多，无法全部载入。',
    'dashboard.emptyGlucose': '这段时间内还没有血糖记录。',
    'dashboard.emptyBloodPressure': '这段时间内还没有血压记录。',
    'dashboard.targetRangeUnitMismatch': '你的目标范围使用的是另一种单位，因此无法在 {unit} 的读数上计算范围内时间。请在设置中修改范围单位或显示单位。',
    'dashboard.targetRangeInvite': '在设置中配置你的血糖目标范围，这里就会显示你有多少比例的时间处于范围之内。',
    'dashboard.generic': '概览未能载入。',
    'dashboard.recordsUndecrypted': { other: '有 {count} 条记录无法解密，未计入本概览。' },
    'dashboard.excludedByUnit': {
        other: '有 {count} 条记录使用了 {unit} 以外的单位，未予显示（mg/dL 与 mmol/L 之间不做换算）。',
    },
    'dashboard.window.week': '最近一周',
    'dashboard.window.month': '最近一个月',
    'dashboard.window.lastDays': '最近 {days} 天',
    'dashboard.stat.count': '记录条数',
    'dashboard.stat.mean': '平均值',
    'dashboard.stat.median': '中位数',
    'dashboard.stat.min': '最小值',
    'dashboard.stat.max': '最大值',
    'dashboard.stat.lastReading': '最近一次读数',
    'dashboard.stat.timeInRange': '范围内时间占比',
    'dashboard.stat.withMean': '{magnitude} · 平均值',
    'dashboard.stat.withMedian': '{magnitude} · 中位数',
    'dashboard.stat.withRange': '{magnitude} · 区间',
    'dashboard.magnitude.systolic': '收缩压',
    'dashboard.magnitude.diastolic': '舒张压',
    'dashboard.magnitude.pulse': '脉搏',
    'dashboard.bp.lastReadingCaption': '最近一次读数（收缩压/舒张压）',
    'dashboard.unit.bpm': '次/分',
    'dashboard.method.capillary': '毛细血管血',
    'dashboard.method.interstitial': '组织液',
    'dashboard.method.combined': '{arm}，{posture}',
    'dashboard.arm.left': '左臂',
    'dashboard.arm.right': '右臂',
    'dashboard.posture.sitting': '坐位',
    'dashboard.posture.lying': '卧位',
    'dashboard.posture.standing': '立位',
});
