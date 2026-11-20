// Cloudflare Pages Function
// Endpoint: /api/calendar?year=2026 (también admite 2027)

import { addManualBlocks, readCalendarConfig, readOffers } from '../_shared/calendar-config.js';

const FEED_CONFIG = Object.freeze({
  orixol: Object.freeze([
    Object.freeze({
      secretName: 'ICAL_ORIXOL_BOOKING',
      missingErrorCode: 'ICAL_SECRET_MISSING_ORIXOL_BOOKING',
      fetchErrorCode: 'ICAL_FETCH_FAILED_ORIXOL_BOOKING',
    }),
    Object.freeze({
      secretName: 'ICAL_ORIXOL_AIRBNB',
      missingErrorCode: 'ICAL_SECRET_MISSING_ORIXOL_AIRBNB',
      fetchErrorCode: 'ICAL_FETCH_FAILED_ORIXOL_AIRBNB',
    }),
  ]),
  oketa: Object.freeze([
    Object.freeze({
      secretName: 'ICAL_OKETA_BOOKING',
      missingErrorCode: 'ICAL_SECRET_MISSING_OKETA_BOOKING',
      fetchErrorCode: 'ICAL_FETCH_FAILED_OKETA_BOOKING',
    }),
    Object.freeze({
      secretName: 'ICAL_OKETA_AIRBNB',
      missingErrorCode: 'ICAL_SECRET_MISSING_OKETA_AIRBNB',
      fetchErrorCode: 'ICAL_FETCH_FAILED_OKETA_AIRBNB',
    }),
  ]),
});

class SafeIcalError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SafeIcalError';
    this.code = code;
  }
}

function feedsFromEnv(env) {
  return Object.fromEntries(Object.entries(FEED_CONFIG).map(([room, definitions]) => [
    room,
    definitions.map((definition) => {
      const url = env?.[definition.secretName];
      if (typeof url !== 'string' || url.trim() === '') {
        throw new SafeIcalError(definition.missingErrorCode);
      }
      return Object.freeze({ url, fetchErrorCode: definition.fetchErrorCode });
    }),
  ]));
}

function pad(v) {
  return String(v).padStart(2, '0');
}

function dateToIsoUTC(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseIcsDate(raw) {
  if (!raw) return null;
  const value = raw.trim();

  // all-day format: YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return new Date(Date.UTC(y, m - 1, d));
  }

  // date-time format: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) {
    const [, yy, mm, dd, hh, mi, ss] = m;
    return new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  }

  return null;
}

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function eventRangeToDates(start, end) {
  const dates = [];
  if (!start || !end) return dates;
  const cursor = new Date(start.getTime());
  while (cursor < end) {
    dates.push(dateToIsoUTC(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function parseIcsToOccupancy(icsText, year) {
  const occupied = {};
  const text = unfoldIcs(icsText);
  const blocks = text.split('BEGIN:VEVENT').slice(1);

  for (const block of blocks) {
    const endIdx = block.indexOf('END:VEVENT');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const lines = body.split(/\r?\n/);

    let dtstart = null;
    let dtend = null;

    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep);
      const value = line.slice(sep + 1).trim();
      if (key.startsWith('DTSTART')) dtstart = parseIcsDate(value);
      if (key.startsWith('DTEND')) dtend = parseIcsDate(value);
    }

    if (!dtstart) continue;
    // If DTEND is missing, assume one-night block for all-day events.
    if (!dtend) {
      dtend = new Date(dtstart.getTime());
      dtend.setUTCDate(dtend.getUTCDate() + 1);
    }

    for (const iso of eventRangeToDates(dtstart, dtend)) {
      if (iso.startsWith(String(year) + '-')) occupied[iso] = 1;
    }
  }

  return occupied;
}

async function fetchOne(feed) {
  try {
    const response = await fetch(feed.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 SolapetxeaCalendar/1.0',
        'accept': 'text/calendar,text/plain;q=0.9,*/*;q=0.8',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!response.ok) throw new SafeIcalError(feed.fetchErrorCode);
    return await response.text();
  } catch {
    throw new SafeIcalError(feed.fetchErrorCode);
  }
}

async function loadRoom(feeds, year) {
  const merged = {};
  const texts = await Promise.all(feeds.map(fetchOne));
  for (const text of texts) {
    const occupancy = parseIcsToOccupancy(text, year);
    Object.assign(merged, occupancy);
  }
  return merged;
}

function safeErrorCode(error) {
  return error instanceof SafeIcalError ? error.code : 'ICAL_LOAD_FAILED';
}

async function loadOccupancy(env, year) {
  if (env?.CALENDAR_DATA_MODE === 'synthetic') {
    return { orixol: {}, oketa: {} };
  }
  const feeds = feedsFromEnv(env);
  const [orixol, oketa] = await Promise.all([
    loadRoom(feeds.orixol, year),
    loadRoom(feeds.oketa, year),
  ]);
  return { orixol, oketa };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const year = Number(url.searchParams.get('year') || new Date().getUTCFullYear());

  try {
    const [loadedOccupancy, config, offers] = await Promise.all([
      loadOccupancy(context.env, year),
      readCalendarConfig(context.env),
      readOffers(context.env),
    ]);
    const occupancy = addManualBlocks(loadedOccupancy, config, year);

    const body = JSON.stringify({
      ok: true,
      year,
      cached_minutes: 5,
      data_mode: context.env?.CALENDAR_DATA_MODE === 'synthetic' ? 'synthetic' : 'live',
      occupancy,
      offers: offers || [],
      updated_at: new Date().toISOString(),
    });

    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: safeErrorCode(error),
    }), {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
}
