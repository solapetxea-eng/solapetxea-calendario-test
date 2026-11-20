import { generateIcalFeed, IcalExportError } from '../../../_shared/ical-export.js';

const TOKEN_BINDINGS = Object.freeze({
  oketa: 'ICAL_EXPORT_OKETA_TOKEN_HASH',
  orixol: 'ICAL_EXPORT_ORIXOL_TOKEN_HASH',
});

const encoder = new TextEncoder();

function responseHeaders(contentType = 'text/plain; charset=utf-8') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}

function notFound() {
  return new Response('No encontrado.', {
    status: 404,
    headers: responseHeaders(),
  });
}

function unavailable(code, unit) {
  console.error(JSON.stringify({
    event: 'ical_export_unavailable',
    code,
    unit: TOKEN_BINDINGS[unit] ? unit : 'invalid',
  }));
  return new Response('Calendario no disponible temporalmente.', {
    status: 503,
    headers: {
      ...responseHeaders(),
      'retry-after': '30',
    },
  });
}

function safeErrorCode(error) {
  if (error instanceof IcalExportError) return error.code;
  return 'ICAL_EXPORT_FAILED';
}

async function readIcalSource(env) {
  if (!env?.DB) throw new IcalExportError('D1_BINDING_MISSING');

  let row;
  try {
    row = await env.DB.prepare('SELECT value, updated_at FROM app_config WHERE key = ?')
      .bind('calendar')
      .first();
  } catch (error) {
    throw new IcalExportError('D1_CONFIG_READ_FAILED', error);
  }

  if (typeof row?.value !== 'string' || row.value.trim() === '') {
    throw new IcalExportError('D1_CONFIG_MISSING');
  }

  let config;
  try {
    config = JSON.parse(row.value);
  } catch (error) {
    throw new IcalExportError('D1_CONFIG_INVALID', error);
  }

  return {
    blocks: config?.manualBlocks,
    updatedAt: row.updated_at,
  };
}

async function sha256(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

function hexToBytes(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(left, right) {
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(left, right);
  }

  const leftBytes = new Uint8Array(left);
  const rightBytes = right instanceof Uint8Array ? right : new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index % leftBytes.length] ?? 0)
      ^ (rightBytes[index % rightBytes.length] ?? 0);
  }
  return difference === 0;
}

async function authorize(unit, token, env) {
  const bindingName = TOKEN_BINDINGS[unit];
  if (!bindingName) return { configured: true, authorized: false };

  const expectedHash = hexToBytes(env?.[bindingName]);
  if (!expectedHash) return { configured: false, authorized: false };
  const providedHash = await sha256(typeof token === 'string' ? token : '');
  return {
    configured: true,
    authorized: timingSafeEqual(providedHash, expectedHash),
  };
}

async function handle(context, includeBody) {
  const unit = typeof context.params?.unit === 'string' ? context.params.unit.toLowerCase() : '';
  const token = typeof context.params?.token === 'string' ? context.params.token : '';
  if (!TOKEN_BINDINGS[unit]) return notFound();

  const authorization = await authorize(unit, token, context.env);
  if (!authorization.configured) return unavailable('ICAL_EXPORT_TOKEN_NOT_CONFIGURED', unit);
  if (!authorization.authorized) return notFound();

  try {
    const { blocks, updatedAt } = await readIcalSource(context.env);
    const calendar = await generateIcalFeed({
      unit,
      blocks,
      updatedAt,
    });
    const headers = responseHeaders('text/calendar; charset=utf-8');
    headers['content-disposition'] = `inline; filename="solapetxea-${unit}.ics"`;
    return new Response(includeBody ? calendar : null, { headers });
  } catch (error) {
    return unavailable(safeErrorCode(error), unit);
  }
}

export async function onRequestGet(context) {
  return handle(context, true);
}

export async function onRequestHead(context) {
  return handle(context, false);
}
