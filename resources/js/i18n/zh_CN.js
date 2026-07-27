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

    // --- Rango de fechas del historial (`health/dateRange.js`) ----------------------------------
    'range.error.incomplete': '请选择自定义范围的两个日期。',
    'range.error.order': '开始日期必须早于结束日期。',
    'range.error.badDate': '无法读取范围的日期。',
    'range.error.badPreset': '不存在该时间段：“{preset}”。',

    // --- Nombres de campo, para los mensajes de `numericValue.js` -------------------------------
    'field.value': '数值',
    'field.dose': '剂量',
    'field.quantity': '数量',
    'field.systolic': '收缩压',
    'field.diastolic': '舒张压',
    'field.pulse': '脉搏',
    'field.weight': '体重',
    'field.temperature': '体温',
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
        other: '有 {count} 条记录使用了 {unit} 以外的单位，未予显示（不同单位之间不做换算）。',
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

    // --- Peso corporal --------------------------------------------------------------------------
    'bodyWeight.empty': '目前还没有体重记录。',
    'bodyWeight.missingValue': '请填写体重。',
    'bodyWeight.missingUnit': '请选择单位。',
    'bodyWeight.caption.includes': '包含：{units}。每种单位各自成为一条曲线：千克与磅之间不做换算。',
    'bodyWeight.caption.empty': '没有可显示的体重数据。',

    // --- Temperatura corporal -------------------------------------------------------------------
    'temperature.empty': '目前还没有体温记录。',
    'temperature.missingValue': '请填写体温。',
    'temperature.missingUnit': '请选择单位。',
    'temperature.missingSite': '请指明测量部位。',
    'temperature.noLoincCode': '测量部位“{site}”没有对应的 LOINC 代码。',
    'temperature.series': '{site} · {unit}',
    'temperature.caption.includes': '包含：{series}。每个测量部位与单位各自成为一条曲线：彼此之间不可比较。',
    'temperature.caption.empty': '没有可显示的体温数据。',

    // --- Panel de inicio ------------------------------------------------------------------------
    'dashboard.truncated': '本概览只包含最近的记录：这段时间内的记录太多，无法全部载入。',
    'dashboard.empty': '这段时间内还没有任何记录。',
    'dashboard.addFirst': '添加第一条记录',
    'dashboard.typeFilter.none': '没有勾选任何事件类型，因此没有可显示的内容。请至少勾选一项。',
    'dashboard.loadedCount': {
        other: '此时段内已勾选类型的记录共 {count} 条。',
    },
    'dashboard.search.hidden': {
        other: '此时段内有 {count} 条记录与搜索内容不符，但仍计入图表和统计。',
    },
    'dashboard.empty.search': '此时段内没有与搜索内容相符的记录。',
    'dashboard.targetRangeUnitMismatch': '你的目标范围使用的是另一种单位，因此无法在 {unit} 的读数上计算范围内时间。请在设置中修改范围单位或显示单位。',
    'dashboard.targetRangeInvite': '在设置中配置你的血糖目标范围，这里就会显示你有多少比例的时间处于范围之内。',
    'dashboard.generic': '概览未能载入。',
    'dashboard.recordsUndecrypted': { other: '有 {count} 条记录无法解密，未计入本概览。' },
    'dashboard.excludedByUnit': {
        other: '有 {count} 条记录使用了 {unit} 以外的单位，未予显示（mg/dL 与 mmol/L 之间不做换算）。',
    },
    'dashboard.stat.count': '记录条数',
    'dashboard.stat.mean': '平均值',
    'dashboard.stat.median': '中位数',
    'dashboard.stat.min': '最小值',
    'dashboard.stat.max': '最大值',
    'dashboard.stat.lastReading': '最近一次读数',
    'dashboard.stat.timeInRange': '范围内时间占比',
    'dashboard.stat.belowRange': '低于范围',
    'dashboard.stat.inRange': '范围内',
    'dashboard.stat.aboveRange': '高于范围',
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

    // --- Línea temporal unificada del panel de inicio --------------------------------------------
    'dashboard.timeline.capped': {
        other: '仅显示此期间最近的 {shown} 条记录，另有 {count} 条较早的记录未列出。',
    },
    'dashboard.timeline.unsupported': {
        other: '有 {count} 条记录的类型此时间线尚无法概括，因此未列出。',
    },
    'dashboard.timeline.type.glucose': '血糖',
    'dashboard.timeline.type.bloodPressure': '血压',
    'dashboard.timeline.type.insulin': '胰岛素',
    'dashboard.timeline.type.meal': '饮食',
    'dashboard.timeline.type.bodyWeight': '体重',
    'dashboard.timeline.type.temperature': '体温',
    'dashboard.timeline.measurement': '{value} {unit}',
    'dashboard.timeline.bloodPressureReading': '{systolic}/{diastolic} {unit}',
    'dashboard.timeline.pulse': '{pulse} {unit}',
    'dashboard.timeline.noFoods': '未记录食物',
    'dashboard.timeline.moreFoods': '+{count}',
    'dashboard.timeline.insulinType.rapid': '速效',
    'dashboard.timeline.insulinType.long': '长效',
    'dashboard.timeline.insulinType.mixed': '预混',
    'dashboard.timeline.mealType.breakfast': '早餐',
    'dashboard.timeline.mealType.lunch': '午餐',
    'dashboard.timeline.mealType.dinner': '晚餐',
    'dashboard.timeline.mealType.snack': '加餐',
    'dashboard.timeline.site.axillary': '腋下',
    'dashboard.timeline.site.oral': '口腔',
    'dashboard.timeline.site.tympanic': '耳道（鼓膜）',
    'dashboard.timeline.site.temporal': '额头（颞动脉）',
    'dashboard.timeline.site.rectal': '直肠',

    // --- Compartir un recorte con un profesional (`health/sharePage.js`, ADR 0011) --------------
    'share.stage.reading': '正在读取你的记录…',
    'share.stage.decrypting': '正在解密你的记录…',
    'share.stage.packing': '正在压缩并加密分享包…',
    'share.stage.pin': '正在保护 PIN…',
    'share.stage.uploading': '正在上传分享包…',
    'share.stage.done': '分享包已就绪。',
    'share.error.noTypes': '请至少选择一种要分享的记录类型。',
    'share.error.badTtl': '该有效期不在可选范围内。',
    'share.error.empty': '该时间段内没有这些类型的记录，因此没有可分享的内容。',
    'share.error.tooLarge': '分享包太大，无法分享。请缩短时间段或减少记录类型。',
    'share.error.tooManyEvents': '该时间段内的记录超过 {count} 条。请缩短时间段后重试。',
    'share.error.undecryptable': {
        other: '该时间段内有 {count} 条记录无法解密。分享包没有生成：缺失的记录与从未存在过的记录无法区分。',
    },
    'share.error.limit': '你的有效分享包已达上限。请先撤销一个再分享。',
    'share.error.upload': '分享包上传失败，没有分享任何内容。',
    'share.error.copy': '链接复制失败。请手动选中并复制。',
    'share.error.generic': '无法生成分享包。',
    'share.qr.alt': '包含分享包完整链接的二维码。',
    'share.range.all': '你的全部历史记录',
    'share.range.from': '自 {from} 起',
    'share.range.to': '截至 {to}',
    'share.range.between': '{from} 至 {to}',
    'share.list.empty': '你没有任何有效的分享包。',
    'share.list.undecryptable': '该分享包无法解密，因此无法显示其内容。它仍处于分享状态：如有疑虑请撤销。',
    'share.list.types': '包含：{types}',
    'share.list.records': {
        other: '{count} 条记录',
    },
    'share.list.expires': '{at} 过期',
    'share.list.opened': '首次打开于 {at}（按小时取整；不保留访问记录）',
    'share.list.notOpened': '尚未被打开',
    'share.list.revoke': '撤销',
    'share.list.confirmRevoke': '撤销会永久删除该分享包，但无法收回对方已经下载的内容。',
    'share.list.confirmRevokeAction': '永久撤销',
    'share.list.cancel': '取消',
    // --- Estatura e índice de masa corporal (pantalla de peso y perfil) --------------------------
    'field.height': '身高',
    'bodyWeight.missingHeightUnit': '请选择身高的单位。',
    'bodyWeight.heightInline': '身高 {value} {unit}',
    'bodyWeight.bmi': '体质指数 {value}',
    'bodyWeight.bmiWithHeightFrom': '体质指数 {value} · 使用 {date} 记录的身高',
    'profile.body.none': '尚未记录',
    'profile.body.noBmi': '记录身高后即可查看',
    'profile.body.fromRecords': '来自你最近一次的体重和身高',
    'profile.error.measurementsGeneric': '无法加载你的最新测量数据。',

    // --- Gráficas del panel de inicio ------------------------------------------------------------
    'dashboard.chart.caption': '每日中位数（{unit}），阴影带表示当天最低到最高读数。包含：{series}。没有读数的日期留空。',
    'dashboard.chart.empty': '此时间段内还没有读数：一旦有读数，图表就会显示。',
    'dashboard.chart.omittedDays': {
        other: '为保持图表清晰，本时间段中较早的 {count} 天未绘制。',
    },
    'dashboard.chart.seriesMagnitude': '{group} \u00b7 {magnitude}',
    'dashboard.chart.tooltip': '{label}：中位数 {median} {unit}（从 {min} 到 {max}）',
    'dashboard.chart.tooltipSingle': '{label}：{value} {unit}（仅一次读数）',
    'dashboard.chart.ariaLabel': '{type} 的每日中位数与每日范围',

    // --- Curva de glucemia con marcas de comida e insulina (`glucoseContext.js`) -----------------
    'dashboard.chart.context.title': '血糖与进餐、胰岛素',
    'dashboard.chart.context.ariaLabel': '随时间变化的血糖曲线，每次进餐和每次注射胰岛素都有标记',
    'dashboard.chart.context.caption': '按时间顺序显示每次血糖读数（{unit}），时间轴上每次进餐和每次注射胰岛素各有一个标记。包含：{series}。超过 {hours} 小时没有读数的时段留空，绝不用线连接。',
    'dashboard.chart.context.meals': '进餐',
    'dashboard.chart.context.injections': '胰岛素注射',
    'dashboard.chart.context.reading': '{label}：{value} {unit}',
    'dashboard.chart.context.grouped': {
        other: '为保持清晰，有 {count} 个标记与邻近标记合并显示。',
    },
    'dashboard.chart.context.moreGrouped': {
        other: '同一时段内还有 {count} 个。',
    },
    'dashboard.chart.context.groupedShort': '\u00d7{count}',
    'dashboard.chart.context.omittedReadings': {
        other: '为保持图表清晰，本时间段中较早的 {count} 次读数未绘制。',
    },
    'dashboard.chart.context.omittedMarkers': {
        other: '有 {count} 个标记早于所绘制的第一次读数，未予显示。',
    },

    // --- Superposición de días sobre 24 horas (`dayOverlay.js`) ---------------------------------
    'dashboard.chart.overlay.title': '24 小时曲线',
    'dashboard.chart.overlay.ariaLabel': '本时间段的每一天叠加在同一条 24 小时轴上，并显示每小时的中位数',
    'dashboard.chart.overlay.caption': '本时间段的全部读数（{unit}）叠加在同一条 24 小时轴上：每天一条浅色细线，每小时的中位数用粗线表示。包含：{series}。没有读数的小时留空。',
    'dashboard.chart.overlay.days': {
        other: '共叠加 {count} 天。',
    },
    'dashboard.chart.overlay.medianLabel': '{group} \u00b7 每小时中位数',
    'dashboard.chart.overlay.tooltip': '{label}：{value} {unit}',
    'dashboard.chart.overlay.targetRange': '阴影带是你的目标范围：{low}\u2013{high} {unit}。',

    // --- Recorte compartido: la vista que comparten el lector y la vista previa (ADR 0011) -------
    'clip.controls.title': '你正在查看的内容',
    'clip.range.label': '此摘录内的时间段',
    'clip.range.all': '整份摘录',
    'clip.range.day': '摘录中的最后一天',
    'clip.range.week': '摘录中的最后 7 天',
    'clip.range.month': '摘录中的最后 30 天',
    'clip.range.custom': '自定义时间段',
    'clip.range.from': '从',
    'clip.range.to': '到',
    'clip.range.help': '这只会缩小显示范围。摘录是一份固定的快照，无法在此扩大：本页面无法请求摘录中尚未包含的任何记录。',
    'clip.types.label': '记录类型',
    'clip.search.label': '搜索',
    'clip.search.placeholder': '备注、食物、设备……',
    'clip.search.help': '搜索在本浏览器内完成，仅针对本摘录的记录，输入内容不会发送到任何地方。它只缩小时间线和详情表格；图表和统计仍涵盖整个所选时段。',
    'clip.empty.type': '本摘录在所示时段内没有此类记录。',
    'clip.range.outside': '你选择的时段超出了本摘录的范围（{from} 至 {to}），因此显示整份摘录。',
    /**
     * La segunda línea de la cabecera: qué se está mirando **ahora**, después de acotar. Se imprime,
     * a diferencia de los controles: en papel, un recorte de seis meses con una tabla de siete días
     * y ninguna huella del filtro es un historial truncado que se lee como completo.
     */
    'clip.viewing.label': '当前查看',
    'clip.viewing.rangeAll': '整份摘录',
    'clip.viewing.rangeFrom': '自 {from} 起',
    'clip.viewing.rangeTo': '至 {to}',
    'clip.viewing.rangeBetween': '{from} 至 {to}',
    'clip.viewing.allTypes': '摘录中的全部记录类型',
    'clip.viewing.types': '仅 {types}',
    'clip.viewing.noTypes': '未选任何记录类型',
    'clip.viewing.search': '在时间线和表格中按“{query}”筛选',
    'clip.notice.undeclared': {
        other: '有 {count} 条记录属于本摘录未声明的类型，因此不计入统计也不绘制到图表中，但仍列在下方表格里。',
    },
    'clip.notice.noDeclaredTypes': '本摘录未声明包含哪些记录类型，因此上方列出了其中找到的全部类型。',
    'clip.notice.mixedUnits': '本摘录中的血糖使用了不止一种单位。统计和图表仅涵盖 {unit} 的读数；不做任何换算，其余单位的读数在每张卡片下方单独计数。',
    'clip.charts.title': '图表',
    'clip.stats.title': '统计',
    'clip.timeline.title': '时间线',
    'clip.table.title': '全部记录明细',
    'clip.notice.shown': {
        other: '显示 {count} 条记录，此摘录共 {total} 条。',
    },
    'clip.notice.unreadable': {
        other: '此摘录中有 {count} 条记录无法读取。它们不计入统计，也不会绘制在图表中；下方表格中仍会列出，以免遗漏。',
    },
    // --- Página del lector de un recorte compartido (`reader/`, ADR 0011) -----------------------
    'reader.title': '共享的健康记录',
    'reader.intro': '有人与你共享了其本人健康记录的只读摘录。内容已加密：除本浏览器凭 PIN 码解密外，任何人都无法读取。',
    'reader.pin.title': '请输入 PIN 码',
    'reader.pin.help': '六位 PIN 码通过与本链接不同的渠道交给你。校验会特意耗时数秒，这样仅凭被窃取的链接并不足以打开记录。',
    'reader.pin.label': 'PIN 码',
    'reader.pin.submit': '打开记录',
    'reader.print': '打印或保存为 PDF',
    'reader.stage.deriving': '正在校验 PIN 码。这是设计上的耗时，需要几秒钟；页面并未卡住。',
    'reader.stage.decrypting': '正在本浏览器中解密记录……',
    'reader.error.noFragment': '此链接不完整：# 之后的部分缺失，而那部分正是密钥。邮件过滤器和网络认证门户常会将其删除。请索取二维码，或请对方重新发送链接。',
    'reader.error.badFragment': '此链接不是有效的记录链接。请索取二维码，或请对方重新发送链接。',
    'reader.error.badPin': 'PIN 码为 {length} 位数字。',
    'reader.error.generic': '无法打开记录。可能是 PIN 码不正确，也可能是链接已失效：过期、被撤销或从未存在。本页面无法告诉你是哪一种。',
    'reader.error.attempts': '本浏览器已失败 {used} 次，上限为 {max} 次。失败 {max} 次后链接将停止工作，需要重新签发。',
    'reader.error.attemptsSpent': '本浏览器已失败 {max} 次，此链接可能已经失效。请索取新的链接和新的 PIN 码。',
    'reader.error.tampered': '记录在传输中被篡改或不完整，因此未予显示。故意不显示任何残缺内容：半份临床记录看起来和完整的一样。请索取新的链接。',
    'reader.error.network': '无法获取记录。请检查网络连接后重试。',
    'reader.header.count': {
        other: '{count} 条记录',
    },
    'reader.header.rangeAll': '涵盖全部历史记录',
    'reader.header.rangeFrom': '涵盖 {from} 之后',
    'reader.header.rangeTo': '涵盖 {to} 之前',
    'reader.header.rangeBetween': '涵盖 {from} 至 {to}',
    'reader.header.generated': '生成于 {at}',
    'reader.header.includes': '包含：{types}',
    'reader.header.includesNothing': '包含：没有任何记录类型',
    'reader.header.excludes': '未共享，因此即便存在也不会出现在此处：{types}',
    'reader.header.snapshot': '请将上方的记录条数与下方的行数对照。这是所示期间的静态快照，而非记录的实时视图。',
    'reader.table.when': '日期和时间',
    'reader.table.what': '测量项目',
    'reader.table.value': '数值',
    'reader.table.details': '方法与情境',
    'reader.table.loinc': 'LOINC',
    'reader.table.empty': '此摘录中没有记录。',
    'reader.row.unreadable': '无法读取的记录',
    'reader.row.unknownType': '未知的记录类型',
    'reader.detail.pulse': '脉搏 {value}',
    'reader.detail.height': '身高 {value}',
    'reader.detail.noFoods': '未记录食物',
    'reader.detail.device': '设备：{device}',
    'reader.detail.recordedBy': '记录者：{who}',
    'reader.detail.note': '备注：{note}',
    'reader.notes.snapshot': '这是创建链接时拍下的静态快照。之后新增的记录不在其中。',
    'reader.notes.expiry': '链接会自行过期，共享者也可随时撤销。请及时保存或打印所需内容。',
    'reader.notes.zeroKnowledge': '服务器以加密形式保存此记录，无法读取。解密在此处、在本浏览器中完成，使用链接中的密钥和 PIN 码。',
    'reader.notes.noTracking': '打开本页面不会写入任何 Cookie，也不会创建账户。共享者只会得知它被首次打开，且时间精确到小时。',
});
