// Cloudflare Pages Function
// Endpoint: /api/calendar?year=2026

const ICALS = {
  orixol: [
    'https://ical.booking.com/v1/export?t=6d705df1-fdda-4556-86ea-f9ff4c66cf46',
    'https://www.airbnb.es/calendar/ical/1294359505340084298.ics?t=9ed9b28b1d7043f09cb3de7f1979eea8',
  ],
  oketa: [
    'https://ical.booking.com/v1/export?t=389f17a6-d584-4136-b7d0-9a74f3046ee5',
    'https://www.airbnb.es/calendar/ical/1293618343719205245.ics?t=072c6f5c03b8402ab82a344d6d3875d3',
  ],
};

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

async function fetchOne(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 SolapetxeaCalendar/1.0',
      'accept': 'text/calendar,text/plain;q=0.9,*/*;q=0.8',
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) {
    throw new Error(`Error al leer iCal (${res.status}) en ${url}`);
  }
  return await res.text();
}

async function loadRoom(urls, year) {
  const merged = {};
  const texts = await Promise.all(urls.map(fetchOne));
  for (const txt of texts) {
    const occ = parseIcsToOccupancy(txt, year);
    Object.assign(merged, occ);
  }
  return merged;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const year = Number(url.searchParams.get('year') || new Date().getUTCFullYear());

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), context.request);
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const [orixol, oketa] = await Promise.all([
      loadRoom(ICALS.orixol, year),
      loadRoom(ICALS.oketa, year),
    ]);

    const body = JSON.stringify({
      ok: true,
      year,
      cached_minutes: 5,
      occupancy: { orixol, oketa },
      updated_at: new Date().toISOString(),
    });

    const response = new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido cargando iCal',
    }), {
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
}
