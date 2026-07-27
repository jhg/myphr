/**
 * Lectura clínica de un recorte ya descifrado (ADR 0011): convertir el contenido de cada evento en
 * algo que un profesional pueda leer de un vistazo, sin conocer esta aplicación y con la consulta
 * empezada.
 *
 * **Qué se enseña y por qué.** Un valor sin unidad no es un dato, una medición sin método no se
 * puede comparar con otra (ADR 0008) y una magnitud sin su término LOINC no se puede copiar a una
 * historia clínica ajena (ADR 0005). Así que cada fila lleva las cuatro cosas: fecha y hora, valor
 * con unidad, cómo y dónde se midió, y el código LOINC con su término oficial.
 *
 * **El término oficial LOINC no se traduce** (ADR 0005). Es el nombre que identifica la magnitud
 * fuera de aquí, en inglés y tal como lo publica Regenstrief; traducirlo lo convertiría en otra
 * cosa. Lo que sí se traduce es todo lo demás.
 *
 * **Nada se omite en silencio.** Un evento cuyo contenido no tiene la forma esperada se pinta como
 * fila de error y se cuenta, nunca desaparece (ADR 0004): en un recorte que va a leer otra persona,
 * un registro que falta es indistinguible de un registro que no existió, y esa diferencia es
 * clínica.
 *
 * Este módulo es lógica pura, sin DOM y sin red, para poder probarlo entero
 * (`tests/js/clinicalReport.test.mjs`). Quien lo pinta es `readerPage.js`.
 */

import { formatDateTime, joinList, t } from '../i18n/index.js';

/**
 * Vocabulario resuelto para un idioma concreto, a partir del catálogo público que emite
 * `App\Sharing\ReaderCatalog`.
 *
 * Se resuelve una vez al elegir idioma y no en cada fila: el catálogo trae los tres idiomas dentro
 * (para que el selector no tenga que pedir nada al servidor) y buscar por idioma en cada celda sería
 * repetir el mismo trabajo por evento.
 *
 * @param {object} catalog Contenido de `data-phr-reader-catalog`.
 * @param {string} locale Idioma activo (`en`, `es`, `zh_CN`).
 * @returns {{labels: Record<string, Record<string, string>>, loinc: Record<string, string>,
 *           units: Record<string, string>}}
 */
export function resolveCatalog(catalog, locale) {
    return {
        labels: catalog?.labels?.[locale] ?? catalog?.labels?.en ?? {},
        loinc: catalog?.loinc ?? {},
        units: catalog?.units ?? {},
    };
}

/**
 * Etiqueta de un token de catálogo.
 *
 * Un token que este catálogo no conoce se enseña **tal cual**, nunca se calla: un dato que la
 * aplicación no sabe nombrar sigue siendo un dato, y esconderlo sería mentir por omisión. Pasa, por
 * ejemplo, con un recorte generado por una versión más nueva que la de esta página.
 *
 * @param {object} resolved Salida de `resolveCatalog`.
 * @param {string} group Grupo del catálogo (`glucoseMethods`, `arms`, ...).
 * @param {unknown} token
 * @returns {string|null} `null` cuando el campo no venía (los opcionales se omiten del contenido).
 */
export function labelFor(resolved, group, token) {
    if (typeof token !== 'string' || token === '') {
        return null;
    }

    return resolved.labels?.[group]?.[token] ?? token;
}

/**
 * Cómo se enseña un código UCUM. `Cel` se lee `°C` y `[lb_av]` se lee `lb`: el código es notación de
 * intercambio, no algo que se le pida leer a nadie (ADR 0005). Uno que no esté en la tabla se enseña
 * tal cual, por el mismo motivo que un token desconocido.
 *
 * @param {object} resolved
 * @param {unknown} code
 * @returns {string}
 */
export function unitLabel(resolved, code) {
    if (typeof code !== 'string' || code === '') {
        return '';
    }

    return resolved.units?.[code] ?? code;
}

/**
 * Códigos LOINC de un evento, con su término oficial.
 *
 * El contenido guarda el código en `data.loinc`, que es una cadena en la mayoría de tipos y un
 * objeto con una entrada por magnitud en la tensión arterial (sistólica, diastólica y pulso son tres
 * magnitudes distintas, ADR 0005). Los dos casos salen aquí con la misma forma.
 *
 * @param {object} resolved
 * @param {unknown} loinc Campo `data.loinc` tal cual venía.
 * @returns {list<{code: string, name: string|null}>}
 */
export function loincEntries(resolved, loinc) {
    /** @param {unknown} code */
    const entry = (code) => ({ code: String(code), name: resolved.loinc?.[String(code)] ?? null });

    if (typeof loinc === 'string' && loinc !== '') {
        return [entry(loinc)];
    }

    if (loinc !== null && typeof loinc === 'object') {
        return Object.values(loinc)
            .filter((code) => typeof code === 'string' && code !== '')
            .map(entry);
    }

    return [];
}

/**
 * Fila de la tabla clínica a partir de un evento del paquete.
 *
 * @param {object} resolved Salida de `resolveCatalog`.
 * @param {{occurredAt: string, content: object}} event
 * @returns {{occurredAt: string, occurredAtLabel: string, tz: string|null, typeLabel: string,
 *           value: string, details: list<string>, loinc: list<{code: string, name: string|null}>,
 *           note: string|null, unreadable: boolean}}
 */
export function describeEvent(resolved, event) {
    const content = event?.content;
    const type = typeof content?.type === 'string' ? content.type : '';
    const data = content?.data ?? null;

    const row = {
        occurredAt: typeof event?.occurredAt === 'string' ? event.occurredAt : '',
        occurredAtLabel: typeof event?.occurredAt === 'string' ? formatDateTime(event.occurredAt) : '',
        tz: typeof content?.tz === 'string' ? content.tz : null,
        typeLabel: labelFor(resolved, 'types', type) ?? t('reader.row.unknownType'),
        value: '',
        details: [],
        loinc: [],
        note: typeof content?.note === 'string' && content.note !== '' ? content.note : null,
        unreadable: false,
    };

    if (data === null || typeof data !== 'object') {
        return { ...row, unreadable: true, typeLabel: row.typeLabel, value: t('reader.row.unreadable') };
    }

    const described = describeByType(resolved, type, data);

    if (described === null) {
        return { ...row, unreadable: true, value: t('reader.row.unreadable') };
    }

    row.value = described.value;
    row.details = [...described.details, ...contextDetails(resolved, content)];
    row.loinc = loincEntries(resolved, data.loinc);

    return row;
}

/**
 * Los seis tipos que se pueden compartir (`SHAREABLE_TYPES` en `health/sharePage.js`). Un tipo que
 * no esté aquí devuelve `null` y acaba pintado como fila ilegible, con su fecha y su tipo a la
 * vista: es preferible una fila que dice «no se entiende» a un hueco.
 *
 * @param {object} resolved
 * @param {string} type
 * @param {object} data
 * @returns {{value: string, details: list<string>}|null}
 */
function describeByType(resolved, type, data) {
    switch (type) {
        case 'glucose':
            return {
                value: measurement(resolved, data.value, data.unit),
                details: compact([
                    labelFor(resolved, 'glucoseMethods', data.method),
                    labelFor(resolved, 'mealContexts', data.mealContext),
                ]),
            };

        case 'bloodPressure': {
            const pressure = `${plain(data.systolic)}/${plain(data.diastolic)} ${unitLabel(resolved, data.unit)}`.trim();
            const pulse = typeof data.pulse === 'string' && data.pulse !== ''
                ? t('reader.detail.pulse', { value: measurement(resolved, data.pulse, data.pulseUnit) })
                : null;

            return {
                value: pressure,
                details: compact([
                    pulse,
                    labelFor(resolved, 'arms', data.arm),
                    labelFor(resolved, 'postures', data.posture),
                ]),
            };
        }

        case 'insulin':
            return {
                value: measurement(resolved, data.dose, data.unit),
                details: compact([
                    labelFor(resolved, 'insulinTypes', data.insulinType),
                    typeof data.product === 'string' && data.product !== '' ? data.product : null,
                    labelFor(resolved, 'injectionSites', data.site),
                ]),
            };

        case 'meal': {
            const foods = Array.isArray(data.foods) ? data.foods : [];

            return {
                value: labelFor(resolved, 'mealTypes', data.mealType) ?? '',
                details: foods.length === 0
                    ? [t('reader.detail.noFoods')]
                    : foods.map((food) => describeFood(resolved, food)),
            };
        }

        case 'bodyWeight': {
            const height = data.height ?? null;

            return {
                value: measurement(resolved, data.value, data.unit),
                details: compact([
                    height === null
                        ? null
                        : t('reader.detail.height', { value: measurement(resolved, height.value, height.unit) }),
                ]),
            };
        }

        case 'temperature':
            return {
                value: measurement(resolved, data.value, data.unit),
                details: compact([labelFor(resolved, 'temperatureSites', data.site)]),
            };

        default:
            return null;
    }
}

/**
 * Detalles comunes a todo evento (ADR 0006): con qué aparato se midió y quién lo apuntó.
 *
 * **Quién lo apuntó se dice siempre**, también cuando es la propia persona. Un registro apuntado por
 * quien cuida a alguien y uno apuntado por la propia persona no valen lo mismo en consulta, y dejar
 * el caso mayoritario implícito obligaría a saberse cuál es el caso mayoritario.
 *
 * @param {object} resolved
 * @param {object} content
 * @returns {list<string>}
 */
function contextDetails(resolved, content) {
    const device = typeof content.device === 'string' && content.device !== '' ? content.device : null;
    const recordedBy = labelFor(resolved, 'recordedBy', content.recordedBy);

    return compact([
        device === null ? null : t('reader.detail.device', { device }),
        recordedBy === null ? null : t('reader.detail.recordedBy', { who: recordedBy }),
    ]);
}

/**
 * Un alimento de una comida (ADR 0010: cantidad y unidad son texto libre acotado, sin codificar).
 *
 * @param {object} resolved
 * @param {{name?: string, quantity?: string, unit?: string}} food
 * @returns {string}
 */
function describeFood(resolved, food) {
    const name = typeof food?.name === 'string' ? food.name : '';
    const quantity = typeof food?.quantity === 'string' ? food.quantity : '';
    const unit = labelFor(resolved, 'foodUnits', food?.unit) ?? '';

    if (quantity === '') {
        return name;
    }

    return `${name} · ${quantity} ${unit}`.trim();
}

/**
 * Valor con su unidad, que es como se lee un dato clínico y como nunca se guarda: dentro del sobre
 * el valor viaja como **cadena**, sin pasar por `Number`, para no perder ni ganar decimales
 * (ADR 0004). Aquí tampoco se convierte ni se reformatea por idioma: `7.8` es lo que marcó el
 * aparato, y reescribirlo como `7,8` sería reinterpretar una medida.
 *
 * @param {object} resolved
 * @param {unknown} value
 * @param {unknown} unit
 * @returns {string}
 */
export function measurement(resolved, value, unit) {
    return `${plain(value)} ${unitLabel(resolved, unit)}`.trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function plain(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * @param {list<string|null>} items
 * @returns {list<string>}
 */
function compact(items) {
    return items.filter((item) => typeof item === 'string' && item !== '');
}

/**
 * Ordena por fecha, de lo más reciente a lo más antiguo.
 *
 * Es el mismo orden que las seis pantallas de historial del panel, y el que sirve a quien abre esto:
 * en una consulta se mira primero lo de esta semana. La cabecera dice el rango completo, así que el
 * orden no esconde nada.
 *
 * Ordena una copia: el cuerpo del paquete es lo que se comprobó contra su propio `eventCount` y no
 * se toca.
 *
 * @param {list<{occurredAt: string}>} events
 * @returns {list<object>}
 */
export function sortByDateDescending(events) {
    return [...events].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

/**
 * La cabecera obligatoria del recorte: cuántos eventos, de cuándo a cuándo y cuándo se generó.
 *
 * **Se enseña siempre, aunque el recorte esté vacío.** Es lo que hace visible un recorte truncado:
 * quien lee compara el número que anuncia la cabecera con las filas que tiene delante, y esa
 * comparación es la única defensa contra un transporte que entregase de menos. Sin ella, un recorte
 * al que le falte la peor semana se lee como un historial completo.
 *
 * @param {object} body Cuerpo en claro del paquete.
 * @returns {{count: string, range: string, generatedAt: string}}
 */
export function reportHeadline(body) {
    const from = body?.range?.from ?? null;
    const to = body?.range?.to ?? null;

    return {
        count: t('reader.header.count', { count: Number(body?.eventCount ?? 0) }),
        range: rangeText(from, to),
        generatedAt: t('reader.header.generated', { at: formatDateTime(body?.generatedAt) }),
    };
}

/**
 * Un rango abierto se dice con palabras, nunca con un hueco: «hasta el 3 de junio» y «no lo sé» no
 * son lo mismo, y un guion suelto no los distingue.
 *
 * @param {string|null} from
 * @param {string|null} to
 * @returns {string}
 */
export function rangeText(from, to) {
    if (from === null && to === null) {
        return t('reader.header.rangeAll');
    }

    if (to === null) {
        return t('reader.header.rangeFrom', { from: formatDateTime(from) });
    }

    if (from === null) {
        return t('reader.header.rangeTo', { to: formatDateTime(to) });
    }

    return t('reader.header.rangeBetween', { from: formatDateTime(from), to: formatDateTime(to) });
}

/**
 * Las dos listas de tipos, incluidos y excluidos, con sus etiquetas.
 *
 * **Los excluidos se dicen en voz alta.** Que no haya comidas en el recorte puede significar que esa
 * persona no apunta comidas o que decidió no enseñarlas, y la diferencia cambia la lectura: una
 * ausencia se lee como un cero clínico. Por eso esta línea no se pliega ni se resume.
 *
 * @param {object} resolved
 * @param {object} body
 * @returns {{included: string, excluded: string|null}}
 */
export function typeSummary(resolved, body) {
    const label = (token) => labelFor(resolved, 'types', token) ?? token;
    const included = Array.isArray(body?.includedTypes) ? body.includedTypes : [];
    const excluded = Array.isArray(body?.excludedTypes) ? body.excludedTypes : [];

    return {
        included: included.length === 0
            ? t('reader.header.includesNothing')
            : t('reader.header.includes', { types: joinList(included.map(label)) }),
        excluded: excluded.length === 0
            ? null
            : t('reader.header.excludes', { types: joinList(excluded.map(label)) }),
    };
}
