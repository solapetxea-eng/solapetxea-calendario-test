export const DEFAULT_CALENDAR_CONFIG = {
  version: 1,
  singleOccupancyDiscount: 10,
  units: {
    oketa: { name: 'Oketa', rates: { low: 95, high: 120 } },
    orixol: { name: 'Orixol', rates: { low: 80, high: 90 } },
  },
  seasons: [
    { id: 'summer-2026', name: 'Verano 2026', type: 'high', start: '2026-06-15', end: '2026-09-15' },
    { id: 'october-2026', name: 'Puente de octubre 2026', type: 'high', start: '2026-10-09', end: '2026-10-12' },
    { id: 'december-2026', name: 'Puente de diciembre 2026', type: 'high', start: '2026-12-04', end: '2026-12-08' },
    { id: 'christmas-2026', name: 'Navidad 2026', type: 'high', start: '2026-12-24', end: '2026-12-31' },
    { id: 'summer-2027', name: 'Verano 2027', type: 'high', start: '2027-06-15', end: '2027-09-15' },
    { id: 'october-2027', name: 'Puente de octubre 2027', type: 'high', start: '2027-10-09', end: '2027-10-12' },
    { id: 'december-2027', name: 'Puente de diciembre 2027', type: 'high', start: '2027-12-04', end: '2027-12-08' },
    { id: 'christmas-2027', name: 'Navidad 2027', type: 'high', start: '2027-12-24', end: '2027-12-31' },
  ],
  minimumStays: [
    { id: 'oketa-shoulder-2026', unit: 'oketa', start: '2026-05-01', end: '2026-09-30', nights: 2 },
    { id: 'oketa-summer-2026', unit: 'oketa', start: '2026-07-01', end: '2026-08-31', nights: 5 },
    { id: 'orixol-summer-2026', unit: 'orixol', start: '2026-07-01', end: '2026-08-31', nights: 2 },
    { id: 'oketa-shoulder-2027', unit: 'oketa', start: '2027-05-01', end: '2027-09-30', nights: 2 },
    { id: 'oketa-summer-2027', unit: 'oketa', start: '2027-07-01', end: '2027-08-31', nights: 5 },
    { id: 'orixol-summer-2027', unit: 'orixol', start: '2027-07-01', end: '2027-08-31', nights: 2 },
  ],
  manualBlocks: [],
};

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

  return config;
}

export async function readCalendarConfig(env) {
  if (!env?.DB) return structuredClone(DEFAULT_CALENDAR_CONFIG);

  try {
    const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?')
      .bind('calendar')
      .first();
    return row?.value ? sanitizeCalendarConfig(JSON.parse(row.value)) : structuredClone(DEFAULT_CALENDAR_CONFIG);
  } catch {
    return structuredClone(DEFAULT_CALENDAR_CONFIG);
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
