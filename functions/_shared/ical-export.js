const UNIT_NAMES = Object.freeze({
  oketa: 'Oketa',
  orixol: 'Orixol',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const encoder = new TextEncoder();

export class IcalExportError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = 'IcalExportError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function compactDate(value) {
  return value.replaceAll('-', '');
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function invalidBlocks(cause) {
  throw new IcalExportError('ICAL_BLOCKS_INVALID', cause);
}

function validateManualBlocks(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 500) invalidBlocks();

  const ids = new Set();
  const ranges = new Set();

  return input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalidBlocks();

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || id.length > 60 || ids.has(id)) invalidBlocks();
    ids.add(id);

    if (!Object.hasOwn(UNIT_NAMES, item.unit)) invalidBlocks();
    if (!validCalendarDate(item.start)
      || !validCalendarDate(item.end)
      || item.start >= item.end) {
      invalidBlocks();
    }

    const rangeKey = `${item.unit}\u0000${item.start}\u0000${item.end}`;
    if (ranges.has(rangeKey)) invalidBlocks();
    ranges.add(rangeKey);

    return {
      id,
      unit: item.unit,
      start: item.start,
      end: item.end,
    };
  });
}

function compactTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IcalExportError('ICAL_CONFIG_TIMESTAMP_INVALID');
  }

  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new IcalExportError('ICAL_CONFIG_TIMESTAMP_INVALID');
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldLine(line) {
  const folded = [];
  let current = '';

  for (const character of line) {
    if (current && encoder.encode(current + character).byteLength > 75) {
      folded.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }

  folded.push(current);
  return folded;
}

async function eventLines(unit, block, timestamp) {
  const uidHash = await sha256Hex(`solapetxea\u0000manual\u0000${unit}\u0000${block.id}`);
  return [
    'BEGIN:VEVENT',
    `UID:manual-${uidHash}@calendar.solapetxea`,
    `DTSTAMP:${timestamp}`,
    `LAST-MODIFIED:${timestamp}`,
    `DTSTART;VALUE=DATE:${compactDate(block.start)}`,
    `DTEND;VALUE=DATE:${compactDate(block.end)}`,
    'SUMMARY:No disponible',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

export async function generateIcalFeed({ unit, blocks, updatedAt }) {
  const unitName = UNIT_NAMES[unit];
  if (!unitName) throw new IcalExportError('ICAL_UNIT_INVALID');

  const validatedBlocks = validateManualBlocks(blocks);
  const timestamp = compactTimestamp(updatedAt);
  const selectedBlocks = validatedBlocks
    .filter(block => block.unit === unit)
    .sort((a, b) => a.start.localeCompare(b.start)
      || a.end.localeCompare(b.end)
      || a.id.localeCompare(b.id));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Solapetxea//Availability Calendar 1.0//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Solapetxea ${unitName}`,
  ];

  for (const block of selectedBlocks) {
    lines.push(...await eventLines(unit, block, timestamp));
  }
  lines.push('END:VCALENDAR');

  return `${lines.flatMap(foldLine).join('\r\n')}\r\n`;
}
