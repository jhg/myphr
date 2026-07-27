/**
 * Índice de masa corporal y estatura conocida (ADR 0004, ADR 0005, ADR 0006).
 *
 * Lógica pura, compartida por la pantalla de peso y estatura (`health/bodyWeightPage.js`) y por el
 * bloque de solo lectura del perfil (`auth/profilePage.js`). Se calcula **siempre en el navegador**:
 * el servidor no ve ni el peso ni la estatura, así que tampoco puede derivar de ellos ninguna cifra
 * (ADR 0004, ADR 0006).
 *
 * **CUIDADO CLÍNICO — el IMC es una razón, no un diagnóstico.** Este módulo devuelve un número y
 * nada más: ni categoría («bajo peso», «sobrepeso»...), ni color, ni comparación. Es deliberado y no
 * es una simplificación pendiente de terminar:
 *
 * * En niños y adolescentes el IMC no se lee como cifra absoluta, sino contra percentiles por edad y
 *   sexo. Esta aplicación no guarda ni la edad ni el sexo, así que no puede hacer esa lectura, y
 *   pintar «sobrepeso» sobre un niño usando el criterio del adulto es sencillamente un error.
 * * Incluso en adultos, la misma cifra significa cosas distintas según masa muscular, embarazo,
 *   edema o edad. Un umbral pintado de rojo se lee como un juicio médico, y aquí no hay ningún
 *   médico mirando.
 *
 * Quien lea la cifra sabe qué hacer con ella, o se la lleva a su consulta. La interfaz solo tiene
 * que decir de qué peso y de qué estatura sale.
 *
 * **Sobre convertir unidades.** El resto del proyecto no convierte entre kilogramos y libras: la
 * gráfica traza una serie por unidad y el historial guarda la unidad con la que se escribió cada
 * registro (ADR 0006). Aquí sí se convierte, y no contradice aquello: el IMC es una cifra **derivada
 * y efímera**, que se calcula para mostrarla y no se guarda, no se cifra ni se compara con nada; y
 * los factores son exactos por definición (1 lb = 0,45359237 kg; 1 in = 0,0254 m), así que no hay
 * ninguna precisión que inventarse. Lo que el ADR 0006 evita es reescribir un dato guardado, y eso
 * aquí no ocurre.
 */

/**
 * Etiqueta legible de cada unidad de peso y de estatura.
 *
 * La pantalla de peso saca estas etiquetas del catálogo que publica el servidor (ADR 0005), que es
 * lo correcto ahí porque el `<select>` lo renderiza Blade. El perfil no tiene ese catálogo —no
 * registra nada, solo enseña— y enseñar `[lb_av]` o `[in_i]` sería pedirle a la persona que lea
 * notación de intercambio. Las cuatro parejas son públicas y fijas, así que repetirlas aquí no crea
 * ninguna verdad nueva que se pueda desincronizar con la del sobre: lo que se guarda sigue siendo
 * siempre el código.
 */
const UNIT_LABELS = Object.freeze({
    kg: 'kg',
    '[lb_av]': 'lb',
    cm: 'cm',
    '[in_i]': 'in',
});

/**
 * @param {string} code Código UCUM.
 * @returns {string} La etiqueta, o el propio código si es desconocido: feo pero cierto.
 */
export function measurementUnitLabel(code) {
    return UNIT_LABELS[code] ?? code;
}

/** Exacto por definición internacional (misma libra avoirdupois que `UcumUnit::Pound`). */
const KILOGRAMS_PER_POUND = 0.45359237;

/** Exacto por definición (pulgada internacional, `[in_i]`). */
const METERS_PER_INCH = 0.0254;

/**
 * Pasa un peso a kilogramos, que es el numerador de la fórmula.
 *
 * Devuelve `null` —y no cero ni `NaN`— ante cualquier cosa que no sea un peso utilizable: unidad
 * desconocida, valor no numérico o cero. Un cero sería un peso falso, y quien llama tiene que poder
 * distinguir «no se puede calcular» de «vale cero».
 *
 * @param {string|number} value Tal cual viaja en el sobre (cadena, ADR 0004).
 * @param {string} unit Código UCUM.
 * @returns {number|null}
 */
export function weightInKilograms(value, unit) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    if (unit === 'kg') {
        return number;
    }

    if (unit === '[lb_av]') {
        return number * KILOGRAMS_PER_POUND;
    }

    return null;
}

/**
 * Pasa una estatura a metros. Mismo criterio que {@see weightInKilograms} con lo que no se puede
 * usar: `null`, nunca cero (que además reventaría la división).
 *
 * @param {string|number} value
 * @param {string} unit Código UCUM.
 * @returns {number|null}
 */
export function heightInMeters(value, unit) {
    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    if (unit === 'cm') {
        return number / 100;
    }

    if (unit === '[in_i]') {
        return number * METERS_PER_INCH;
    }

    return null;
}

/**
 * Índice de masa corporal: kilogramos partido por metros al cuadrado.
 *
 * **Sin estatura no hay IMC y se devuelve `null`.** Ni cero, ni un guion, ni una estatura media
 * inventada: una cifra falsa en un historial clínico no se distingue después de una buena.
 *
 * Se redondea a un decimal porque es la precisión con la que se publica en cualquier sitio serio;
 * dos decimales fingirían una exactitud que ni la báscula ni la cinta métrica tienen.
 *
 * @param {object} params
 * @param {{value: string|number, unit: string}} params.weight
 * @param {{value: string|number, unit: string}|null|undefined} params.height
 * @returns {number|null} `null` cuando falta cualquiera de los dos o alguno no es utilizable.
 */
export function bodyMassIndex({ weight, height }) {
    if (weight === null || weight === undefined || height === null || height === undefined) {
        return null;
    }

    const kilograms = weightInKilograms(weight.value, weight.unit);
    const meters = heightInMeters(height.value, height.unit);

    if (kilograms === null || meters === null) {
        return null;
    }

    return Math.round((kilograms / (meters * meters)) * 10) / 10;
}

/**
 * La estatura conocida en un instante dado: la del registro más reciente que **no sea posterior** a
 * ese instante.
 *
 * El «no posterior» es la parte que importa. Con una persona que crece, tomar una estatura medida
 * después haría que un peso de hace un año se dividiera por la talla de hoy, y el IMC resultante
 * sería más bajo de lo que fue. Es el mismo motivo por el que la estatura se guarda como evento con
 * fecha y no como dato de ficha. Un registro que trae su propia estatura la usa y no llama aquí; el
 * empate exacto de fecha entra (`<=`), que es el caso normal de peso y estatura en el mismo sobre.
 *
 * @param {list<{occurredAt: string, content: object}>} events Eventos de peso ya descifrados, en
 *        cualquier orden.
 * @param {string|null} occurredAt Fecha canónica del registro para el que se busca estatura; `null`
 *        significa «sin cota superior», que es lo que pide el perfil: allí la pregunta es «cuánto
 *        mides», no «cuánto medías cuando te pesaste».
 * @returns {{value: string, unit: string, occurredAt: string}|null}
 */
export function heightKnownAt(events, occurredAt) {
    const limit = occurredAt === null ? Infinity : Date.parse(occurredAt);

    if (Number.isNaN(limit)) {
        return null;
    }

    let best = null;
    let bestTime = -Infinity;

    for (const event of events) {
        const height = event.content?.data?.height;

        if (height === undefined || height === null) {
            continue;
        }

        const time = Date.parse(event.occurredAt);

        if (Number.isNaN(time) || time > limit || time < bestTime) {
            continue;
        }

        best = { ...height, occurredAt: event.occurredAt };
        bestTime = time;
    }

    return best;
}
