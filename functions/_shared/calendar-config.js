export function getRollingYears(date = new Date()) {
  const year = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
  }).format(date));
  return [year, year + 1];
}

function defaultSeasonsForYear(year) {
  return [
    { id: `summer-${year}`, name: `Verano ${year}`, type: 'high', start: `${year}-06-15`, end: `${year}-09-15` },
    { id: `october-${year}`, name: `Puente de octubre ${year}`, type: 'high', start: `${year}-10-09`, end: `${year}-10-12` },
    { id: `december-${year}`, name: `Puente de diciembre ${year}`, type: 'high', start: `${year}-12-04`, end: `${year}-12-08` },
    { id: `christmas-${year}`, name: `Navidad ${year}`, type: 'high', start: `${year}-12-24`, end: `${year}-12-31` },
  ];
}

function defaultMinimumStaysForYear(year) {
  return [
    { id: `oketa-shoulder-${year}`, unit: 'oketa', start: `${year}-05-01`, end: `${year}-09-30`, nights: 2 },
    { id: `oketa-summer-${year}`, unit: 'oketa', start: `${year}-07-01`, end: `${year}-08-31`, nights: 5 },
    { id: `orixol-summer-${year}`, unit: 'orixol', start: `${year}-07-01`, end: `${year}-08-31`, nights: 2 },
  ];
}

const DEFAULT_UNIT_RATES = Object.freeze({
  oketa: Object.freeze({ low: 95, high: 120 }),
  orixol: Object.freeze({ low: 80, high: 90 }),
});

function ratesForYears(years, rates) {
  return Object.fromEntries(years.map(year => [String(year), {
    low: rates.low,
    medium: rates.low,
    high: rates.high,
  }]));
}

function buildDefaultCalendarConfig(years = getRollingYears()) {
  return {
    version: 2,
    singleOccupancyDiscount: 10,
    units: {
      oketa: {
        name: 'Oketa',
        rates: { ...DEFAULT_UNIT_RATES.oketa },
        ratesByYear: ratesForYears(years, DEFAULT_UNIT_RATES.oketa),
      },
      orixol: {
        name: 'Orixol',
        rates: { ...DEFAULT_UNIT_RATES.orixol },
        ratesByYear: ratesForYears(years, DEFAULT_UNIT_RATES.orixol),
      },
    },
    seasons: years.flatMap(defaultSeasonsForYear),
    minimumStays: years.flatMap(defaultMinimumStaysForYear),
    manualBlocks: [],
  };
}

export const DEFAULT_CALENDAR_CONFIG = buildDefaultCalendarConfig();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT_IDS = ['oketa', 'orixol'];

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, fallback = '', maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function validDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) ? value : '';
}

function cleanRange(item) {
  const start = validDate(item?.start);
  const end = validDate(item?.end);
  return start && end && start <= end ? { start, end } : null;
}

function validRateYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function sanitizeRatesByYear(incoming, legacyRates, years) {
  const configuredYears = Object.keys(incoming || {}).map(validRateYear).filter(Boolean);
  const allYears = [...new Set([...years, ...configuredYears])].sort((a, b) => a - b);
  return Object.fromEntries(allYears.map(year => {
    const yearRates = incoming?.[String(year)] || {};
    const low = numberInRange(yearRates.low, legacyRates.low, 0, 10000);
    return [String(year), {
      low,
      medium: numberInRange(yearRates.medium, low, 0, 10000),
      high: numberInRange(yearRates.high, legacyRates.high, 0, 10000),
    }];
  }));
}

export function sanitizeCalendarConfig(input = {}, years = getRollingYears()) {
  const activeYears = [...new Set(years.map(validRateYear).filter(Boolean))].sort((a, b) => a - b);
  const safeYears = activeYears.length ? activeYears : getRollingYears();
  const config = buildDefaultCalendarConfig(safeYears);
  config.singleOccupancyDiscount = numberInRange(input.singleOccupancyDiscount, 10, 0, 100);

  for (const unit of UNIT_IDS) {
    const incoming = input.units?.[unit] || {};
    const defaultRates = DEFAULT_UNIT_RATES[unit];
    const legacyRates = {
      low: numberInRange(incoming.rates?.low, defaultRates.low, 0, 10000),
      high: numberInRange(incoming.rates?.high, defaultRates.high, 0, 10000),
    };
    config.units[unit] = {
      name: cleanText(incoming.name, config.units[unit].name, 40),
      rates: legacyRates,
      ratesByYear: sanitizeRatesByYear(incoming.ratesByYear, legacyRates, safeYears),
    };
  }

  config.seasons = Array.isArray(input.seasons) ? input.seasons.slice(0, 100).flatMap((item, index) => {
    const range = cleanRange(item);
    if (!range) return [];
    return [{
      id: cleanText(item.id, `season-${index + 1}`, 60),
      name: cleanText(item.name, `Temporada ${index + 1}`, 80),
      type: ['low', 'medium', 'high'].includes(item.type) ? item.type : 'low',
      ...range,
    }];
  }) : config.seasons;

  config.minimumStays = Array.isArray(input.minimumStays) ? input.minimumStays.slice(0, 100).flatMap((item, index) => {
    const range = cleanRange(item);
    if (!range || !UNIT_IDS.includes(item.unit)) return [];
    return [{
      id: cleanText(item.id, `minimum-${index + 1}`, 60),
      unit: item.unit,
      ...range,
      nights: Math.round(numberInRange(item.nights, 1, 1, 60)),
    }];
  }) : config.minimumStays;

  config.manualBlocks = Array.isArray(input.manualBlocks) ? input.manualBlocks.slice(0, 500).flatMap((item, index) => {
    const range = cleanRange(item);
    if (!range || !UNIT_IDS.includes(item.unit)) return [];
    return [{
      id: cleanText(item.id, `block-${index + 1}`, 60),
      unit: item.unit,
      ...range,
      note: cleanText(item.note, '', 200),
    }];
  }) : config.manualBlocks;

  return ensureCalendarYears(config, safeYears);
}

export function ensureCalendarYears(config, years = getRollingYears()) {
  const next = structuredClone(config);
  const seasonIds = new Set((next.seasons || []).map(item => item.id));
  const minimumIds = new Set((next.minimumStays || []).map(item => item.id));

  for (const year of years) {
    for (const unit of UNIT_IDS) {
      const legacyRates = next.units?.[unit]?.rates || DEFAULT_UNIT_RATES[unit];
      next.units[unit].ratesByYear ||= {};
      if (!next.units[unit].ratesByYear[String(year)]) {
        next.units[unit].ratesByYear[String(year)] = {
          low: legacyRates.low,
          medium: legacyRates.low,
          high: legacyRates.high,
        };
      }
    }
    for (const season of defaultSeasonsForYear(year)) {
      if (!seasonIds.has(season.id)) {
        next.seasons.push(season);
        seasonIds.add(season.id);
      }
    }
    for (const minimumStay of defaultMinimumStaysForYear(year)) {
      if (!minimumIds.has(minimumStay.id)) {
        next.minimumStays.push(minimumStay);
        minimumIds.add(minimumStay.id);
      }
    }
  }

  return next;
}

export async function readCalendarConfig(env) {
  const years = await getActiveYears(env);
  if (!env?.DB) return sanitizeCalendarConfig(DEFAULT_CALENDAR_CONFIG, years);

  try {
    const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?')
      .bind('calendar')
      .first();
    return row?.value
      ? sanitizeCalendarConfig(JSON.parse(row.value), years)
      : sanitizeCalendarConfig(DEFAULT_CALENDAR_CONFIG, years);
  } catch {
    return sanitizeCalendarConfig(DEFAULT_CALENDAR_CONFIG, years);
  }
}

export async function writeCalendarConfig(env, input) {
  if (!env?.DB) throw new Error('Falta configurar el binding D1 con el nombre DB.');
  const config = sanitizeCalendarConfig(input, await getActiveYears(env));
  await env.DB.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind('calendar', JSON.stringify(config)).run();
  return config;
}

export function addManualBlocks(occupancy, config, year) {
  for (const block of config.manualBlocks || []) {
    if (!occupancy[block.unit]) continue;
    const cursor = new Date(`${block.start}T00:00:00Z`);
    const end = new Date(`${block.end}T00:00:00Z`);
    while (cursor < end) {
      const iso = cursor.toISOString().slice(0, 10);
      if (iso.startsWith(`${year}-`)) occupancy[block.unit][iso] = 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return occupancy;
}

export async function getActiveYears(env) {
  const fallback = getRollingYears();
  if (!env?.DB) return fallback;

  try {
    const rows = await env.DB.prepare(
      'SELECT year FROM active_years WHERE enabled = 1 ORDER BY year ASC'
    ).all();
    const years = (rows.results || []).map(row => validRateYear(row.year)).filter(Boolean);
    return years.length ? [...new Set(years)] : fallback;
  } catch {
    return fallback;
  }
}

export async function readOffers(env) {
  if (!env?.DB) return [];

  try {
    const rows = await env.DB.prepare(
      'SELECT id, unit, start_date, end_date, name, discount_type, discount_value, enabled FROM offers WHERE enabled = 1 ORDER BY start_date ASC'
    ).all();
    return rows.results || [];
  } catch {
    return [];
  }
}

export function getApplicableOffers(unit, startDate, offers) {
  return offers.filter(offer => 
    offer.unit === unit && offer.start_date <= startDate && startDate < offer.end_date
  );
}
