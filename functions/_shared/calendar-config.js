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

function buildDefaultCalendarConfig(years = getRollingYears()) {
  return {
    version: 1,
    singleOccupancyDiscount: 10,
    units: {
      oketa: { name: 'Oketa', rates: { low: 95, high: 120 } },
      orixol: { name: 'Orixol', rates: { low: 80, high: 90 } },
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

function yearFromDate(value) {
  return validDate(value) ? Number(value.slice(0, 4)) : null;
}

function cleanRange(item) {
  const start = validDate(item?.start);
  const end = validDate(item?.end);
  return start && end && start <= end ? { start, end } : null;
}

export function sanitizeCalendarConfig(input = {}) {
  const config = structuredClone(DEFAULT_CALENDAR_CONFIG);
  config.singleOccupancyDiscount = numberInRange(input.singleOccupancyDiscount, 10, 0, 100);

  for (const unit of UNIT_IDS) {
    const incoming = input.units?.[unit] || {};
    config.units[unit] = {
      name: cleanText(incoming.name, config.units[unit].name, 40),
      rates: {
        low: numberInRange(incoming.rates?.low, config.units[unit].rates.low, 0, 10000),
        high: numberInRange(incoming.rates?.high, config.units[unit].rates.high, 0, 10000),
      },
    };
  }

  config.seasons = Array.isArray(input.seasons) ? input.seasons.slice(0, 100).flatMap((item, index) => {
    const range = cleanRange(item);
    if (!range) return [];
    return [{
      id: cleanText(item.id, `season-${index + 1}`, 60),
      name: cleanText(item.name, `Temporada ${index + 1}`, 80),
      type: item.type === 'high' ? 'high' : 'low',
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

  return ensureCalendarYears(config);
}

export function ensureCalendarYears(config, years = getRollingYears()) {
  const next = structuredClone(config);
  const seasonIds = new Set((next.seasons || []).map(item => item.id));
  const minimumIds = new Set((next.minimumStays || []).map(item => item.id));

  for (const year of years) {
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

  next.seasons = (next.seasons || []).filter(item => {
    const startYear = yearFromDate(item.start);
    const endYear = yearFromDate(item.end);
    return years.includes(startYear) || years.includes(endYear);
  });
  next.minimumStays = (next.minimumStays || []).filter(item => {
    const startYear = yearFromDate(item.start);
    const endYear = yearFromDate(item.end);
    return years.includes(startYear) || years.includes(endYear);
  });
  next.manualBlocks = (next.manualBlocks || []).filter(item => {
    const startYear = yearFromDate(item.start);
    const endYear = yearFromDate(item.end);
    return years.includes(startYear) || years.includes(endYear);
  });

  return next;
}

export async function readCalendarConfig(env) {
  if (!env?.DB) return ensureCalendarYears(DEFAULT_CALENDAR_CONFIG);

  try {
    const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?')
      .bind('calendar')
      .first();
    return row?.value ? sanitizeCalendarConfig(JSON.parse(row.value)) : ensureCalendarYears(DEFAULT_CALENDAR_CONFIG);
  } catch {
    return ensureCalendarYears(DEFAULT_CALENDAR_CONFIG);
  }
}

export async function writeCalendarConfig(env, input) {
  if (!env?.DB) throw new Error('Falta configurar el binding D1 con el nombre DB.');
  const config = sanitizeCalendarConfig(input);
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
  return getRollingYears();
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
