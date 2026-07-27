/**
 * Javanese catalog.
 *
 * @type {Readonly<Record<string, string|{one: string, other: string}>>}
 */
export const JV = Object.freeze({
    // --- Shared by several screens --------------------------------------------------------------
    'common.listSeparator': ', ',
    'common.locked.history': 'Sampeyan kudu mlebu kanggo ndeleng riwayat sampeyan.',
    'common.locked.summary': 'Sampeyan kudu mlebu kanggo ndeleng ringkesan sampeyan.',
    'common.locked.settings': 'Sampeyan kudu mlebu kanggo ngowahi setelan sampeyan.',
    'common.missingDate': 'Lebokna tanggal lan wektu.',
    'common.noSession': 'Ora ana sesi sing aktif. Mangga mlebu maneh.',
    'common.saveFailed': 'Cathetan ora bisa disimpen.',
    'common.undecryptable': 'Amplop ora bisa didekripsi.',
    'common.badDatetime': 'Tanggal lan wektu ora bisa diwaca: "{value}".',
    'common.configuration': 'Pamasangan iki durung disetel kanthi bener. Kandhanana wong sing ngatur.',
    'common.network': 'Kita ora bisa nyambung menyang server. Coba maneh.',
    'common.staleTab': 'Kaca iki wis lawas, paling mungkin amarga aplikasi dianyari nalika isih kabuka. Muat maneh lan coba maneh.',
    'common.reload': 'Muat maneh kaca',
    'common.noLoincCode': 'Ora ana kode LOINC kanggo metode "{method}" kanthi unit "{unit}".',
    'common.recordsUndecrypted': {
        one: '{count} cathetan ora bisa didekripsi lan ora ditampilake.',
        other: '{count} cathetan ora bisa didekripsi lan ora ditampilake.',
    },

    // --- History date range (`health/dateRange.js`) ---------------------------------------------
    'range.error.incomplete': 'Pilih kalorone tanggal kanggo rentang khusus.',
    'range.error.order': 'Tanggal wiwitan kudu luwih awal tinimbang tanggal pungkasan.',
    'range.error.badDate': 'Tanggal-tanggal ing rentang ora bisa diwaca.',
    'range.error.badPreset': 'Ora ana periode kaya mangkene: "{preset}".',

    // --- Field names, for the `numericValue.js` messages ----------------------------------------
    'field.value': 'Nilai',
    'field.dose': 'Dosis',
    'field.quantity': 'Jumlah',
    'field.systolic': 'Tekanan sistolik',
    'field.diastolic': 'Tekanan diastolik',
    'field.pulse': 'Denyut nadi',
    'field.weight': 'Bobot',
    'field.temperature': 'Suhu',
    'field.rangeLow': 'Wates ngisor',
    'field.rangeHigh': 'Wates ndhuwur',

    // --- Numeric validation ---------------------------------------------------------------------
    'numeric.notANumber': '{field} kudu awujud angka.',
    'numeric.negative': '{field} ora kena negatif.',
    'numeric.tooManyDecimals': '{field} maksimal mung 2 angka desimal.',
    'numeric.notANumberHint': '{field} kudu awujud angka (gunakake "." utawa "," kanggo desimal).',

    // --- Shared progress bar stages -------------------------------------------------------------
    'stage.preparing': 'Nyiyapake…',
    'stage.saving': 'Nyimpen…',
    'stage.done': 'Rampung.',
    'stage.entering': 'Mlebu…',

    // --- Sign in --------------------------------------------------------------------------------
    'login.stage.contacting': 'Mriksa rincian sampeyan…',
    'login.stage.stretching': 'Nglindhungi tembung sandhi sampeyan ing piranti iki. Iki pancen butuh sawetara detik: kelambatan iki sing ngalangi sapa wae nebak tembung sandhi sampeyan, sanajan duwe salinan basis data.',
    'login.error.credentials': 'Kita ora bisa nglebokake sampeyan nganggo rincian kasebut.',

    // --- Password set-up ------------------------------------------------------------------------
    'setPassword.stage.contacting': 'Mriksa pranala…',
    'setPassword.stage.stretching': 'Ngasilake kunci sampeyan ing piranti iki. Iki butuh sawetara detik…',
    'setPassword.stage.wrapping': 'Nggawe lan nglindhungi kunci sampeyan…',
    'setPassword.stage.verifying': 'Mriksa manawa tembung sandhi sampeyan bisa mbukak kunci. Iki butuh sawetara detik…',
    'setPassword.error.link': 'Pranala iki wis ora bisa digunakake. Nyuwuna pranala anyar marang wong sing ngatur sistem.',
    'setPassword.error.mismatch': 'Kaloro tembung sandhi ora padha.',
    'setPassword.error.verification': 'Ana sing salah nalika nggawe kunci sampeyan. Kita ora bisa verifikasi.',

    // --- Public sign-up (registration) ----------------------------------------------------------
    'register.stage.contacting': 'Nggawe akun sampeyan…',
    'register.stage.stretching': 'Ngasilake kunci sampeyan ing piranti iki. Iki butuh sawetara detik…',
    'register.stage.wrapping': 'Nggawe lan nglindhungi kunci sampeyan…',
    'register.stage.verifying': 'Mriksa manawa tembung sandhi sampeyan bisa mbukak kunci. Iki butuh sawetara detik…',
    'register.error.mismatch': 'Kaloro tembung sandhi ora padha.',
    'register.error.loginTaken': 'Wis ana akun nganggo alamat email kasebut.',
    'register.error.generic': 'Ana sing salah nalika nggawe akun sampeyan. Kita ora bisa verifikasi.',

    // --- Password change ------------------------------------------------------------------------
    'changePassword.stage.reauthenticating': 'Mriksa tembung sandhi saiki…',
    'changePassword.stage.stretchingOld': 'Mriksa tembung sandhi saiki ing piranti iki. Iki butuh sawetara detik…',
    'changePassword.stage.unwrapping': 'Mbukak kunci sampeyan…',
    'changePassword.stage.registering': 'Nyiyapake tembung sandhi anyar…',
    'changePassword.stage.stretchingNew': 'Nglindhungi kunci sampeyan nganggo tembung sandhi anyar. Iki butuh sawetara detik…',
    'changePassword.error.mismatch': 'Kaloro tembung sandhi anyar ora padha.',
    'changePassword.error.empty': 'Ketik tembung sandhi saiki lan sing anyar.',
    'changePassword.error.same': 'Tembung sandhi anyar kudu beda karo sing saiki.',
    'changePassword.error.currentPassword': 'Tembung sandhi saiki ora bener.',
    'changePassword.error.unavailable':
        'Akun iki ora bisa ngowahi tembung sandhi saka kene. Kandhanana wong sing ngatur sistem.',
    'changePassword.error.expired': 'Sampeyan kelamaan. Ketik maneh tembung sandhi saiki.',
    'changePassword.error.verification': 'Ana sing salah nalika nglindhungi kunci sampeyan. Tembung sandhi sampeyan durung owah.',
    'changePassword.success': 'Tembung sandhi sampeyan wis diowahi. Data sampeyan tetep padha lan isih bisa diwaca.',

    // --- Profile --------------------------------------------------------------------------------
    'profile.stage.reauth': 'Mriksa tembung sandhi saiki ing piranti iki. Iki butuh sawetara detik…',
    'profile.stage.opening': 'Mbukak kunci sampeyan…',
    'profile.stage.stretching': 'Ngasilake kunci anyar sampeyan ing piranti iki. Iki butuh sawetara detik…',
    'profile.stage.wrapping': 'Nglindhungi maneh kunci sampeyan…',
    'profile.error.unit': 'Pilih unit glukosa getih sing sah.',
    'profile.error.rangeIncomplete': 'Ketik kalorone wates rentang, utawa kosongna kalorone.',
    'profile.error.rangeOrder': 'Wates ngisor kudu luwih cilik tinimbang wates ndhuwur.',
    'profile.error.rangeZero': 'Wates rentang kudu luwih gedhe tinimbang nol.',
    'profile.error.rangeUnit': 'Pilih unit sing sah kanggo rentang target.',
    'profile.error.conflict': 'Setelan sampeyan owah ing tab liyane. Muat maneh kaca lan coba maneh.',
    'profile.error.settingsGeneric': 'Setelan ora bisa disimpen.',
    'profile.error.passwordExpired': 'Wis kelakon suwe banget. Ketik maneh tembung sandhi saiki.',
    'profile.error.passwordGeneric': 'Tembung sandhi ora bisa diowahi.',

    // --- Blood glucose --------------------------------------------------------------------------
    'glucose.empty': 'Durung ana cathetan glukosa getih.',
    'glucose.missingValue': 'Lebokna nilai.',
    'glucose.caption.includes': 'Kalebu: {methods}.',
    'glucose.caption.noneInUnit': 'Ora ana cathetan nganggo {unit}, mula grafik kosong.',
    'glucose.caption.excluded': {
        one: ' {count} cathetan nganggo unit liyane tinimbang {unit} ora ditampilake '
            + '(ora ana konversi antarane mg/dL lan mmol/L).',
        other: ' {count} cathetan nganggo unit liyane tinimbang {unit} ora ditampilake '
            + '(ora ana konversi antarane mg/dL lan mmol/L).',
    },

    // --- Blood pressure -------------------------------------------------------------------------
    'bloodPressure.empty': 'Durung ana cathetan tekanan getih.',
    'bloodPressure.missingSystolic': 'Lebokna tekanan sistolik.',
    'bloodPressure.missingDiastolic': 'Lebokna tekanan diastolik.',
    'bloodPressure.missingArm': 'Sebutna lengen endi.',
    'bloodPressure.missingPosture': 'Sebutna posisine.',
    'bloodPressure.pulseInline': 'Denyut nadi {value} {unit}',
    'bloodPressure.series.systolic': 'Sistolik · {method}',
    'bloodPressure.series.diastolic': 'Diastolik · {method}',
    'bloodPressure.caption.includes': 'Kalebu: {methods}. Saben metode (lengen lan posisi) minangka seri kapisah.',
    'bloodPressure.caption.empty': 'Ora ana data tekanan getih sing bisa ditampilake.',
    'bloodPressure.pulseCaption.includes': 'Kalebu: {methods}.',
    'bloodPressure.pulseCaption.empty': 'Ora ana data denyut nadi sing bisa ditampilake.',
    'bloodPressure.pulseCaption.missing': {
        one: ' {count} cathetan tanpa denyut nadi ora ditampilake ing grafik iki.',
        other: ' {count} cathetan tanpa denyut nadi ora ditampilake ing grafik iki.',
    },

    // --- Meals ----------------------------------------------------------------------------------
    'meals.empty': 'Durung ana panganan sing dicathet.',
    'meals.missingMealType': 'Pilih jinis panganan.',
    'meals.incompleteFood': 'Isi jeneng, jumlah, lan unit saben panganan, utawa busak barise.',
    'meals.noFoods': 'Ora ana panganan sing ditulis.',

    // --- Insulin --------------------------------------------------------------------------------
    'insulin.empty': 'Durung ana cathetan insulin.',
    'insulin.chartLocked': 'Grafik mbutuhake kunci sampeyan sadurunge bisa ditampilake.',
    'insulin.chartEmpty': 'Total dosis saben dina bakal katon ing kene sawisé sampeyan nyimpen cathetan pisanan.',
    'insulin.missingDose': 'Lebokna dosis.',
    'insulin.missingInsulinType': 'Pilih jinis insulin.',
    'insulin.yAxisTitle': 'Total dosis saben dina ({unit})',
    'insulin.caption': {
        one: '{count} dina kanthi cathetan. Dosis kumulatif miturut jinis — {totals}.',
        other: '{count} dina kanthi cathetan. Dosis kumulatif miturut jinis — {totals}.',
    },
    'insulin.omittedDays': {
        one: '{count} dina sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
        other: '{count} dina sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
    },

    // --- Body weight ----------------------------------------------------------------------------
    'bodyWeight.empty': 'Durung ana cathetan bobot awak.',
    'bodyWeight.missingValue': 'Lebokna bobot.',
    'bodyWeight.missingUnit': 'Pilih unit.',
    'bodyWeight.caption.includes': 'Kalebu: {units}. Saben unit minangka seri kapisah: kilogram lan '
        + 'pon ora diowahi siji menyang sijiné.',
    'bodyWeight.caption.empty': 'Ora ana data bobot awak sing bisa ditampilake.',

    // --- Body temperature -----------------------------------------------------------------------
    'temperature.empty': 'Durung ana cathetan suhu.',
    'temperature.missingValue': 'Lebokna suhu.',
    'temperature.missingUnit': 'Pilih unit.',
    'temperature.missingSite': 'Sebutna panggonan nalika ngukur suhu.',
    'temperature.noLoincCode': 'Ora ana kode LOINC kanggo panggonan pangukuran "{site}".',
    'temperature.series': '{site} · {unit}',
    'temperature.caption.includes': 'Kalebu: {series}. Saben panggonan pangukuran lan unit minangka seri kapisah: '
        + 'ora bisa dibandhingake siji lan sijiné.',
    'temperature.caption.empty': 'Ora ana data suhu sing bisa ditampilake.',

    // --- Home dashboard -------------------------------------------------------------------------
    'dashboard.truncated':
        'Ringkesan mung kalebu cathetan sing paling anyar: cathetan ing periode iki kakehan kanggo dimuat kabèh.',
    'dashboard.empty': 'Durung ana cathetan ing periode iki.',
    'dashboard.addFirst': 'Tambahake cathetan pisanan',
    'dashboard.typeFilter.none': 'Ora ana jinis kedadeyan sing dipilih, mula ora ana sing bisa ditampilake. Centhang paling ora siji.',
    'dashboard.loadedCount': {
        one: '{count} cathetan saka jinis sing dicenthang ing periode iki.',
        other: '{count} cathetan saka jinis sing dicenthang ing periode iki.',
    },
    'dashboard.search.hidden': {
        one: '{count} cathetan ing periode iki ora cocog karo sing sampeyan goleki. Cathetan iki isih diitung '
            + 'ing grafik lan statistik.',
        other: '{count} cathetan ing periode iki ora cocog karo sing sampeyan goleki. Cathetan-cathetan iki isih '
            + 'diitung ing grafik lan statistik.',
    },
    'dashboard.empty.search': 'Ora ana cathetan ing periode iki sing cocog karo sing sampeyan goleki.',
    'dashboard.targetRangeUnitMismatch': 'Rentang target sampeyan disimpen nganggo unit liya, mula wektu ing rentang '
        + 'ora bisa diwilang saka pangukuran nganggo {unit}. Owahana unit rentang utawa unit tampilan ing '
        + 'setelan.',
    'dashboard.targetRangeInvite': 'Setel rentang target glukosa getih ing setelan supaya sampeyan bisa ndeleng '
        + 'persentase wektu sing sampeyan lakoni ing njero rentang kasebut.',
    'dashboard.generic': 'Ringkesan ora bisa dimuat.',
    'dashboard.recordsUndecrypted': {
        one: '{count} cathetan ora bisa didekripsi lan ora kalebu ing ringkesan iki.',
        other: '{count} cathetan ora bisa didekripsi lan ora kalebu ing ringkesan iki.',
    },
    'dashboard.excludedByUnit': {
        one: '{count} cathetan nganggo unit liyane tinimbang {unit} ora ditampilake '
            + '(unit ora tau diowahi siji menyang sijiné).',
        other: '{count} cathetan nganggo unit liyane tinimbang {unit} ora ditampilake '
            + '(unit ora tau diowahi siji menyang sijiné).',
    },
    'dashboard.stat.count': 'Cacah',
    'dashboard.stat.mean': 'Rata-rata',
    'dashboard.stat.median': 'Median',
    'dashboard.stat.min': 'Minimum',
    'dashboard.stat.max': 'Maksimum',
    'dashboard.stat.lastReading': 'Pangukuran pungkasan',
    'dashboard.stat.timeInRange': 'Wektu ing rentang',
    'dashboard.stat.belowRange': 'Ing ngisor rentang',
    'dashboard.stat.inRange': 'Ing njero rentang',
    'dashboard.stat.aboveRange': 'Ing ndhuwur rentang',
    'dashboard.stat.withMean': '{magnitude} · rata-rata',
    'dashboard.stat.withMedian': '{magnitude} · median',
    'dashboard.stat.withRange': '{magnitude} · rentang',
    'dashboard.magnitude.systolic': 'Sistolik',
    'dashboard.magnitude.diastolic': 'Diastolik',
    'dashboard.magnitude.pulse': 'Denyut nadi',
    'dashboard.bp.lastReadingCaption': 'Pangukuran pungkasan (sistolik/diastolik)',
    'dashboard.unit.bpm': 'bpm',
    'dashboard.method.capillary': 'Kapiler',
    'dashboard.method.interstitial': 'Interstisial',
    'dashboard.method.combined': '{arm}, {posture}',
    'dashboard.arm.left': 'Kiwa',
    'dashboard.arm.right': 'Tengen',
    'dashboard.posture.sitting': 'lungguh',
    'dashboard.posture.lying': 'ngglethak',
    'dashboard.posture.standing': 'ngadeg',

    // --- Unified timeline of the home dashboard --------------------------------------------------
    'dashboard.timeline.capped': {
        one: 'Nuduhake {shown} entri paling anyar ing periode iki; {count} entri sing luwih lawas ora didhaptar.',
        other: 'Nuduhake {shown} entri paling anyar ing periode iki; {count} entri sing luwih lawas ora didhaptar.',
    },
    'dashboard.timeline.unsupported': {
        one: '{count} cathetan kalebu jinis sing durung bisa diandharake garis wektu iki, mula ora didhaptar.',
        other: '{count} cathetan kalebu jinis sing durung bisa diandharake garis wektu iki, mula ora didhaptar.',
    },
    'dashboard.timeline.type.glucose': 'Glukosa getih',
    'dashboard.timeline.type.bloodPressure': 'Tekanan getih',
    'dashboard.timeline.type.insulin': 'Insulin',
    'dashboard.timeline.type.meal': 'Panganan',
    'dashboard.timeline.type.bodyWeight': 'Bobot awak',
    'dashboard.timeline.type.temperature': 'Suhu',
    'dashboard.timeline.measurement': '{value} {unit}',
    'dashboard.timeline.bloodPressureReading': '{systolic}/{diastolic} {unit}',
    'dashboard.timeline.pulse': '{pulse} {unit}',
    'dashboard.timeline.noFoods': 'ora ana panganan sing didhaptar',
    'dashboard.timeline.moreFoods': '+{count}',
    'dashboard.timeline.insulinType.rapid': 'Tumindak cepet',
    'dashboard.timeline.insulinType.long': 'Tumindak suwé',
    'dashboard.timeline.insulinType.mixed': 'Campuran',
    'dashboard.timeline.mealType.breakfast': 'Sarapan',
    'dashboard.timeline.mealType.lunch': 'Mangan awan',
    'dashboard.timeline.mealType.dinner': 'Mangan bengi',
    'dashboard.timeline.mealType.snack': 'Cemilan',
    'dashboard.timeline.site.axillary': 'Ketiak',
    'dashboard.timeline.site.oral': 'Cangkem',
    'dashboard.timeline.site.tympanic': 'Kuping (gendhang kuping)',
    'dashboard.timeline.site.temporal': 'Bathuk (arteri temporal)',
    'dashboard.timeline.site.rectal': 'Rektal',

    // --- Share a clipping with a professional ---------------------------------------------------
    'share.stage.reading': 'Maca cathetan sampeyan…',
    'share.stage.decrypting': 'Mbukak enkripsi cathetan sampeyan…',
    'share.stage.packing': 'Ngompres lan ngenkripsi cuplikan…',
    'share.stage.pin': 'Nglindhungi PIN…',
    'share.stage.uploading': 'Ngunggah cuplikan…',
    'share.stage.done': 'Cuplikan siap.',
    'share.error.noTypes': 'Pilih paling ora siji jinis cathetan kanggo dituduhake.',
    'share.error.badTtl': 'Wektu kadaluwarsa kasebut dudu salah siji pilihan sing kasedhiya.',
    'share.error.empty': 'Ora ana cathetan jinis kasebut ing periode iku, mula ora ana sing bisa dituduhake.',
    'share.error.tooLarge': 'Cuplikan gedhé banget kanggo dituduhake. Cekakna periode utawa tilar sawetara jinis cathetan.',
    'share.error.tooManyEvents': 'Periode kasebut ngemot luwih saka {count} cathetan. Cekakna banjur coba maneh.',
    'share.error.undecryptable': {
        one: '{count} cathetan ing periode iku ora bisa didekripsi. Cuplikan ora digawe, amarga cathetan sing ilang padha wae karo cathetan sing ora tau ana.',
        other: '{count} cathetan ing periode iku ora bisa didekripsi. Cuplikan ora digawe, amarga cathetan sing ilang padha wae karo cathetan sing ora tau ana.',
    },
    'share.error.limit': 'Sampeyan wis duwe cuplikan aktif nganti wates sing diidini. Cabut siji sadurunge nuduhake maneh.',
    'share.error.upload': 'Cuplikan ora bisa diunggah. Ora ana sing dituduhake.',
    'share.error.copy': 'Pranala ora bisa disalin. Pilih banjur salin kanthi tangan.',
    'share.error.read': 'Cathetan sampeyan ora bisa diwaca, mula cuplikan ora digawe lan ora ana sing dituduhake.',
    'share.error.generic': 'Cuplikan ora bisa digawe.',
    'share.qr.alt': 'Kode QR sing ngemot pranala lengkap menyang cuplikan.',
    'share.range.all': 'Kabèh riwayat sampeyan',
    'share.range.from': 'Wiwit {from}',
    'share.range.to': 'Nganti {to}',
    'share.range.between': 'Saka {from} nganti {to}',
    'share.list.empty': 'Sampeyan ora duwe cuplikan aktif.',
    'share.list.undecryptable': 'Cuplikan iki ora bisa didekripsi, mula isiné ora bisa ditampilake. Cuplikan isih dituduhake: cabut yen mangu-mangu.',
    'share.list.types': 'Kalebu: {types}',
    'share.list.records': {
        one: '{count} cathetan',
        other: '{count} cathetan',
    },
    'share.list.expires': 'Kadaluwarsa {at}',
    'share.list.opened': 'Kawitan dibukak {at} (dibunderake nganti jam; ora ana cathetan akses)',
    'share.list.notOpened': 'Durung dibukak',
    'share.list.revoke': 'Cabut',
    'share.list.confirmRevoke': 'Nyabut bakal mbusak cuplikan kanthi permanen. Iki ora njupuk bali sing wis diundhuh.',
    'share.list.confirmRevokeAction': 'Cabut permanen',
    'share.list.cancel': 'Batal',

    // --- Height and body mass index -------------------------------------------------------------
    'field.height': 'Dhuwuré awak',
    'bodyWeight.missingHeightUnit': 'Pilih unit kanggo dhuwuré awak.',
    'bodyWeight.heightInline': 'Dhuwuré awak {value} {unit}',
    'bodyWeight.bmi': 'BMI {value}',
    'bodyWeight.bmiWithHeightFrom': 'BMI {value} · nganggo dhuwuré awak sing dicathet tanggal {date}',
    'profile.body.none': 'Durung dicathet',
    'profile.body.noBmi': 'Cathet dhuwuré awak kanggo ndeleng',
    'profile.body.fromRecords': 'Saka bobot lan dhuwuré awak paling anyar',
    'profile.error.measurementsGeneric': 'Pangukuran paling anyar sampeyan ora bisa dimuat.',

    // --- Home dashboard charts -------------------------------------------------------------------
    'dashboard.chart.caption': 'Median saben dina nganggo {unit}, kanthi pita sing diarsir saka pangukuran '
        + 'paling cilik dina kasebut nganti sing paling gedhé. Kalebu: {series}. Dina tanpa pangukuran dikosongake.',
    'dashboard.chart.empty': 'Durung ana pangukuran ing periode iki: grafik bakal katon nalika wis ana pangukuran.',
    'dashboard.chart.omittedDays': {
        one: '{count} dina sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
        other: '{count} dina sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
    },
    'dashboard.chart.seriesMagnitude': '{group} · {magnitude}',
    'dashboard.chart.tooltip': '{label}: median {median} {unit} (saka {min} nganti {max})',
    'dashboard.chart.tooltipSingle': '{label}: {value} {unit} (siji pangukuran)',
    'dashboard.chart.ariaLabel': 'Median lan rentang saben dina kanggo {type}',

    // --- Glucose curve with meal and insulin markers --------------------------------------------
    'dashboard.chart.context.title': 'Glukosa getih karo panganan lan insulin',
    'dashboard.chart.context.ariaLabel': 'Glukosa getih sajrone wektu, kanthi tandha kanggo saben panganan lan '
        + 'saben suntikan insulin',
    'dashboard.chart.context.caption': 'Saben pangukuran glukosa getih nganggo {unit}, miturut urutan wektu, kanthi '
        + 'tandha ing sumbu wektu kanggo saben panganan lan saben suntikan insulin. Kalebu: {series}. '
        + 'Rentangan luwih saka {hours} jam tanpa pangukuran dikosongake, ora tau disambung nganggo garis.',
    'dashboard.chart.context.meals': 'Panganan',
    'dashboard.chart.context.injections': 'Suntikan insulin',
    'dashboard.chart.context.reading': '{label}: {value} {unit}',
    'dashboard.chart.context.grouped': {
        one: '{count} tandha digambar bebarengan karo tandha ing cedhake, supaya tetep gampang diwaca.',
        other: '{count} tandha digambar bebarengan karo tandha ing cedhake, supaya tetep gampang diwaca.',
    },
    'dashboard.chart.context.moreGrouped': {
        one: 'lan {count} liyane ing rentangan sing padha.',
        other: 'lan {count} liyane ing rentangan sing padha.',
    },
    'dashboard.chart.context.groupedShort': '×{count}',
    'dashboard.chart.context.omittedReadings': {
        one: '{count} pangukuran sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
        other: '{count} pangukuran sadurunge ing periode iki ora digambar supaya grafik tetep gampang diwaca.',
    },
    'dashboard.chart.context.omittedMarkers': {
        one: '{count} tandha ana sadurunge pangukuran pisanan sing digambar lan ora ditampilake.',
        other: '{count} tandha ana sadurunge pangukuran pisanan sing digambar lan ora ditampilake.',
    },

    // --- Day overlay over 24 hours --------------------------------------------------------------
    'dashboard.chart.overlay.title': 'Profil 24 jam',
    'dashboard.chart.overlay.ariaLabel': 'Saben dina ing periode iki ditumpuk ing sumbu 24 jam tunggal, '
        + 'kanthi median saben jam',
    'dashboard.chart.overlay.caption': 'Saben pangukuran ing periode iki nganggo {unit} ditumpuk ing sumbu 24 jam '
        + 'tunggal: siji garis samar saben dina, lan median saben jam nganggo garis kandel. '
        + 'Kalebu: {series}. Jam tanpa pangukuran dikosongake.',
    'dashboard.chart.overlay.days': {
        one: '{count} dina ditumpuk.',
        other: '{count} dina ditumpuk.',
    },
    'dashboard.chart.overlay.medianLabel': '{group} · median saben jam',
    'dashboard.chart.overlay.tooltip': '{label}: {value} {unit}',
    'dashboard.chart.overlay.targetRange': 'Pita sing diarsir yaiku rentang target sampeyan, {low}–{high} {unit}.',

    // --- Shared clipping ------------------------------------------------------------------------
    'clip.controls.title': 'Sing lagi sampeyan deleng',
    'clip.range.label': 'Periode ing njero cuplikan iki',
    'clip.range.all': 'Cuplikan kabèh',
    'clip.range.day': 'Dina pungkasan cuplikan',
    'clip.range.week': '7 dina pungkasan cuplikan',
    'clip.range.month': '30 dina pungkasan cuplikan',
    'clip.range.custom': 'Periode khusus',
    'clip.range.from': 'Saka',
    'clip.range.to': 'Nganti',
    'clip.range.help': 'Iki mung nyuda sing ditampilake. Cuplikan iki minangka jepretan tetep lan ora bisa '
        + 'diwiyarake saka kene: ora ana apa-apa ing kaca iki sing bisa njaluk cathetan sing durung ana ing njero.',
    'clip.types.label': 'Jinis cathetan',
    'clip.search.label': 'Golèk',
    'clip.search.placeholder': 'Cathetan, panganan, piranti...',
    'clip.search.help': 'Panggolèkan ditindakake ing browser iki, mung tumrap cathetan ing cuplikan iki. '
        + 'Sing sampeyan ketik ora dikirim menyang ngendi wae. Iki nyuda garis wektu lan tabel rinci; '
        + 'grafik lan statistik tetep nyakup periode sing dipilih kabèh.',
    'clip.empty.type': 'Cuplikan iki ora ngemot cathetan jinis iki kanggo periode sing ditampilake.',
    'clip.range.outside': 'Periode sing sampeyan pilih ana ing njaba cuplikan iki, sing nyakup {from} nganti '
        + '{to}. Mula cuplikan kabèh sing ditampilake.',
    'clip.viewing.label': 'Sampeyan lagi ndeleng',
    'clip.viewing.rangeAll': 'cuplikan kabèh',
    'clip.viewing.rangeFrom': 'wiwit {from}',
    'clip.viewing.rangeTo': 'nganti {to}',
    'clip.viewing.rangeBetween': 'saka {from} nganti {to}',
    'clip.viewing.allTypes': 'kabèh jinis cathetan ing cuplikan',
    'clip.viewing.types': 'mung {types}',
    'clip.viewing.noTypes': 'ora ana jinis cathetan',
    'clip.viewing.search': 'disaring nganggo “{query}” ing garis wektu lan tabel',
    'clip.notice.undeclared': {
        one: '{count} cathetan kalebu jinis sing ora dicethakake cuplikan iki, mula ora diitung ing '
            + 'statistik utawa digambar ing grafik. Cathetan iki didhaptar ing tabel ngisor.',
        other: '{count} cathetan kalebu jinis sing ora dicethakake cuplikan iki, mula ora diitung ing '
            + 'statistik utawa digambar ing grafik. Cathetan-cathetan iki didhaptar ing tabel ngisor.',
    },
    'clip.notice.noDeclaredTypes': 'Cuplikan iki ora nerangake jinis cathetan sing kalebu, mula '
        + 'saben jinis sing ditemokake ing njero ditawakake ing ndhuwur.',
    'clip.notice.mixedUnits': 'Glukosa getih ing cuplikan iki dicathet nganggo luwih saka siji unit. '
        + 'Statistik lan grafik mung nyakup pangukuran {unit}; ora ana sing diowahi, lan '
        + 'pangukuran nganggo unit liya diitung dhewe ing sangisore saben kertu.',
    'clip.charts.title': 'Grafik',
    'clip.stats.title': 'Statistik',
    'clip.timeline.title': 'Garis wektu',
    'clip.table.title': 'Saben cathetan kanthi rinci',
    'clip.notice.shown': {
        one: '{count} cathetan ditampilake, saka {total} ing cuplikan iki.',
        other: '{count} cathetan ditampilake, saka {total} ing cuplikan iki.',
    },
    'clip.notice.unreadable': {
        one: '{count} cathetan ing cuplikan iki ora bisa diwaca. Cathetan iki ora diitung ing statistik '
            + 'utawa digambar ing grafik, lan didhaptar ing tabel ngisor supaya ora ilang.',
        other: '{count} cathetan ing cuplikan iki ora bisa diwaca. Cathetan-cathetan iki ora diitung ing '
            + 'statistik utawa digambar ing grafik, lan didhaptar ing tabel ngisor supaya ora ilang.',
    },

    // --- Reader page of a shared clipping -------------------------------------------------------
    'reader.title': 'Cathetan kesehatan sing dituduhake',
    'reader.intro': 'Ana wong sing nuduhake cuplikan mung-waca saka cathetan kesehatané marang sampeyan. Iki dienkripsi: ora ana sing bisa maca kajaba browser iki nganggo PIN.',
    'reader.pin.title': 'Lebokna PIN',
    'reader.pin.help': 'PIN enem digit diwenehake marang sampeyan kanthi kapisah saka pranala iki. Ngitung PIN iki pancen butuh sawetara detik, supaya pranala sing dicolong waé ora cukup.',
    'reader.pin.label': 'PIN',
    'reader.pin.submit': 'Bukak cathetan',
    'reader.print': 'Cetak utawa simpen dadi PDF',
    'reader.stage.deriving': 'Ngitung PIN ing browser iki. Iki pancen butuh sawetara detik: kelambatan iki sing ngalangi sapa wae nyoba saben PIN. Kaca iki ora mandheg — garis iki nuduhake kemajuan nyata.',
    'reader.stage.decrypting': 'Mbukak enkripsi cathetan ing browser iki…',
    'reader.stage.rendering': 'Cathetan kabukak. Nyiyapake grafik lan tabel…',
    'reader.error.noFragment': 'Pranala iki teka ora lengkap: bagean sawisé # ilang, lan bagean kuwi minangka kunci. Filter email lan portal captive kerep mbusak bagean kasebut. Nyuwuna kode QR utawa pranala dikirim maneh.',
    'reader.error.badFragment': 'Pranala iki dudu pranala cathetan sing sah. Nyuwuna kode QR utawa pranala dikirim maneh.',
    'reader.error.badPin': 'PIN dawané {length} digit.',
    'reader.error.generic': 'Cathetan ora bisa dibukak. PIN bisa waé salah utawa pranala wis ora sah — kadaluwarsa, dicabut, utawa ora tau ana. Kaca iki ora bisa ngerti sing endi.',
    'reader.error.attempts': 'Iki {used} saka {max} upaya gagal saka browser iki. Sawisé {max} upaya gagal, pranala ora bisa digunakake lan kudu digawe sing anyar.',
    'reader.error.attemptsSpent': 'Iki {max} upaya gagal saka browser iki, mula pranala iki bisa uga wis mati. Nyuwuna pranala anyar lan PIN anyar.',
    'reader.error.tampered': 'Cathetan teka wis diowahi utawa ora lengkap lan ora ditampilake. Ora ana bagean sing ditampilake kanthi sengaja: setengah cathetan klinis katon kaya cathetan sing lengkap. Nyuwuna pranala anyar.',
    'reader.error.network': 'Cathetan ora bisa dijupuk. Priksa sambungan banjur coba maneh.',
    'reader.header.count': {
        one: '{count} cathetan',
        other: '{count} cathetan',
    },
    'reader.header.rangeAll': 'Nyakup kabèh riwayat',
    'reader.header.rangeFrom': 'Nyakup wiwit {from}',
    'reader.header.rangeTo': 'Nyakup nganti {to}',
    'reader.header.rangeBetween': 'Nyakup saka {from} nganti {to}',
    'reader.header.generated': 'Digawe tanggal {at}',
    'reader.header.includes': 'Kalebu: {types}',
    'reader.header.includesNothing': 'Kalebu: ora ana jinis cathetan',
    'reader.header.excludes': 'Ora kalebu, mula ora ditampilake ing kene senajan ana: {types}',
    'reader.header.snapshot': 'Bandhingake cacah cathetan ing ndhuwur karo larik ing ngisor. Iki jepretan tetep saka periode sing kasebut, dudu tampilan cathetan kanthi langsung.',
    'reader.table.when': 'Tanggal lan wektu',
    'reader.table.what': 'Pangukuran',
    'reader.table.value': 'Nilai',
    'reader.table.details': 'Metode lan konteks',
    'reader.table.loinc': 'LOINC',
    'reader.table.empty': 'Ora ana cathetan ing cuplikan iki.',
    'reader.row.unreadable': 'Cathetan ora bisa diwaca',
    'reader.row.unknownType': 'Jinis cathetan ora dingerteni',
    'reader.detail.pulse': 'Denyut nadi {value}',
    'reader.detail.height': 'Dhuwuré awak {value}',
    'reader.detail.noFoods': 'Ora ana panganan sing didhaptar',
    'reader.detail.device': 'Piranti: {device}',
    'reader.detail.recordedBy': 'Dicathet dening: {who}',
    'reader.detail.note': 'Cathetan: {note}',
    'reader.notes.snapshot': 'Iki jepretan sing dijupuk nalika pranala digawe. Cathetan sing ditambahaké sawisé kuwi ora kalebu.',
    'reader.notes.expiry': 'Pranala iki kadaluwarsa dhewe lan bisa dicabut kapan waé déning wong sing nuduhake. Simpen utawa cetak sing sampeyan butuhake.',
    'reader.notes.zeroKnowledge': 'Server nyimpen cathetan iki ing wangun terenkripsi lan ora bisa maca. Cathetan dibukak enkripsiné ing kene, ing browser iki, nganggo kunci ing pranala lan PIN.',
    'reader.notes.noTracking': 'Mbukak kaca iki ora nyetel cookie lan ora nggawe akun. Wong sing nuduhake mung diwenehi kabar manawa pranala wis kawitan dibukak, dibunderake nganti jam.',
});
