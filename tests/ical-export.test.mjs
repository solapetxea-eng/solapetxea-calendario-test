import assert from 'node:assert/strict';
import test from 'node:test';

import { generateIcalFeed, IcalExportError } from '../functions/_shared/ical-export.js';
import {
  onRequestGet as getIcal,
  onRequestHead as headIcal,
} from '../functions/api/ical/[unit]/[token].js';

const OKETA_TOKEN = 'oketa-token-local-only-12345678901234567890';
const ORIXOL_TOKEN = 'orixol-token-local-only-1234567890123456789';
const UPDATED_AT = '2026-11-18 12:34:56';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function baseConfig(manualBlocks = []) {
  return {
    version: 2,
    singleOccupancyDiscount: 13,
    units: {
      oketa: {
        name: 'Oketa',
        rates: { low: 101, high: 131 },
        ratesByYear: { 2026: { low: 101, medium: 111, high: 131 } },
      },
      orixol: {
        name: 'Orixol',
        rates: { low: 82, high: 94 },
        ratesByYear: { 2026: { low: 82, medium: 88, high: 94 } },
      },
    },
    seasons: [{ id: 'season', name: 'Temporada', type: 'high', start: '2026-07-01', end: '2026-08-31' }],
    minimumStays: [{ id: 'minimum', unit: 'oketa', start: '2026-07-01', end: '2026-08-31', nights: 5 }],
    manualBlocks,
  };
}

const MANUAL_BLOCKS = [
  { id: 'oketa-existing-id', unit: 'oketa', start: '2027-01-30', end: '2027-02-02', note: 'Nombre privado Oketa' },
  { id: 'orixol-existing-id', unit: 'orixol', start: '2027-03-10', end: '2027-03-12', note: 'Teléfono privado Orixol' },
];

class IcalDB {
  constructor({
    config = baseConfig(MANUAL_BLOCKS),
    updatedAt = UPDATED_AT,
    fail = false,
    missing = false,
    rawValue,
  } = {}) {
    this.config = structuredClone(config);
    this.updatedAt = updatedAt;
    this.fail = fail;
    this.missing = missing;
    this.rawValue = rawValue;
    this.reads = 0;
  }

  prepare(sql) {
    this.reads += 1;
    if (this.fail) throw new Error('simulated D1 failure');
    if (sql.includes('FROM app_config')) {
      const DB = this;
      return {
        bind() { return this; },
        async first() {
          if (DB.missing) return null;
          return {
            value: DB.rawValue === undefined ? JSON.stringify(DB.config) : DB.rawValue,
            updated_at: DB.updatedAt,
          };
        },
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

async function tokenEnv(DB = new IcalDB()) {
  return {
    DB,
    ICAL_EXPORT_OKETA_TOKEN_HASH: await sha256Hex(OKETA_TOKEN),
    ICAL_EXPORT_ORIXOL_TOKEN_HASH: await sha256Hex(ORIXOL_TOKEN),
  };
}

function context(unit, token, env) {
  return {
    request: new Request(`https://calendar.example/api/ical/${unit}/${token}`),
    params: { unit, token },
    env,
  };
}

function unfoldIcal(value) {
  return value.replace(/\r\n[ \t]/g, '');
}

function eventUids(value) {
  return [...unfoldIcal(value).matchAll(/^UID:(.+)$/gm)].map(match => match[1].trim());
}

test('genera feeds RFC 5545 independientes con entrada inclusiva y salida exclusiva', async () => {
  const oketa = await generateIcalFeed({ unit: 'oketa', blocks: MANUAL_BLOCKS, updatedAt: UPDATED_AT });
  const orixol = await generateIcalFeed({ unit: 'orixol', blocks: MANUAL_BLOCKS, updatedAt: UPDATED_AT });
  const unfoldedOketa = unfoldIcal(oketa);
  const unfoldedOrixol = unfoldIcal(orixol);

  assert.match(oketa, /^BEGIN:VCALENDAR\r\n/);
  assert.match(oketa, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(unfoldedOketa, /DTSTART;VALUE=DATE:20270130\r\nDTEND;VALUE=DATE:20270202/);
  assert.match(unfoldedOrixol, /DTSTART;VALUE=DATE:20270310\r\nDTEND;VALUE=DATE:20270312/);
  assert.doesNotMatch(unfoldedOketa, /20270310|orixol-existing-id/i);
  assert.doesNotMatch(unfoldedOrixol, /20270130|oketa-existing-id/i);
  assert.equal(eventUids(oketa).length, 1);
  assert.equal(eventUids(orixol).length, 1);
  assert.ok(oketa.split('\r\n').every(line => new TextEncoder().encode(line).byteLength <= 75));
});

test('mantiene el UID al modificar fechas o notas y nunca exporta datos privados', async () => {
  const original = await generateIcalFeed({ unit: 'oketa', blocks: MANUAL_BLOCKS, updatedAt: UPDATED_AT });
  const changed = await generateIcalFeed({
    unit: 'oketa',
    blocks: [
      { ...MANUAL_BLOCKS[0], start: '2027-02-01', end: '2027-02-04', note: 'Otro huésped y 600000000' },
      MANUAL_BLOCKS[1],
    ],
    updatedAt: '2026-11-19T08:00:00Z',
  });

  assert.deepEqual(eventUids(changed), eventUids(original));
  assert.doesNotMatch(changed, /Nombre privado|Otro huésped|600000000|note/i);
  assert.match(changed, /SUMMARY:No disponible/);
});

test('un bloqueo eliminado desaparece sin alterar los identificadores restantes', async () => {
  const blocks = [
    ...MANUAL_BLOCKS,
    { id: 'oketa-second-id', unit: 'oketa', start: '2027-04-01', end: '2027-04-03', note: '' },
  ];
  const before = await generateIcalFeed({ unit: 'oketa', blocks, updatedAt: UPDATED_AT });
  const after = await generateIcalFeed({ unit: 'oketa', blocks: [blocks[1], blocks[2]], updatedAt: UPDATED_AT });

  assert.equal(eventUids(before).length, 2);
  assert.equal(eventUids(after).length, 1);
  assert.equal(eventUids(after)[0], eventUids(before)[1]);
});

test('rechaza fechas imposibles, rangos vacíos, IDs y rangos duplicados sin omitirlos', async () => {
  const invalidCases = [
    [{ id: 'bad-date', unit: 'oketa', start: '2027-02-30', end: '2027-03-02', note: '' }],
    [{ id: 'zero', unit: 'oketa', start: '2027-03-02', end: '2027-03-02', note: '' }],
    [MANUAL_BLOCKS[0], { ...MANUAL_BLOCKS[1], id: MANUAL_BLOCKS[0].id }],
    [MANUAL_BLOCKS[0], { ...MANUAL_BLOCKS[0], id: 'different-id' }],
  ];

  for (const blocks of invalidCases) {
    await assert.rejects(
      () => generateIcalFeed({ unit: 'oketa', blocks, updatedAt: UPDATED_AT }),
      error => error instanceof IcalExportError && error.code === 'ICAL_BLOCKS_INVALID',
    );
  }
});

test('los tokens de Oketa y Orixol son independientes y el rechazo no consulta D1', async () => {
  const DB = new IcalDB();
  const env = await tokenEnv(DB);

  const oketa = await getIcal(context('oketa', OKETA_TOKEN, env));
  assert.equal(oketa.status, 200);
  assert.match(oketa.headers.get('content-type'), /^text\/calendar/);

  const readsBeforeWrongToken = DB.reads;
  const wrongUnitToken = await getIcal(context('oketa', ORIXOL_TOKEN, env));
  assert.equal(wrongUnitToken.status, 404);
  assert.equal(DB.reads, readsBeforeWrongToken);
  const readsAfterWrongToken = DB.reads;

  const unknown = await getIcal(context('unknown', OKETA_TOKEN, env));
  assert.equal(unknown.status, 404);
  assert.equal(DB.reads, readsAfterWrongToken);

  const orixol = await getIcal(context('orixol', ORIXOL_TOKEN, env));
  assert.equal(orixol.status, 200);
});

test('rotar el hash revoca el enlace anterior sin afectar al otro alojamiento', async () => {
  const env = await tokenEnv();
  const replacement = 'oketa-replacement-local-only-123456789012345';
  env.ICAL_EXPORT_OKETA_TOKEN_HASH = await sha256Hex(replacement);

  assert.equal((await getIcal(context('oketa', OKETA_TOKEN, env))).status, 404);
  assert.equal((await getIcal(context('oketa', replacement, env))).status, 200);
  assert.equal((await getIcal(context('orixol', ORIXOL_TOKEN, env))).status, 200);
});

test('un token no configurado y un fallo D1 responden 503 sin calendario parcial', async () => {
  const envWithoutToken = { DB: new IcalDB() };
  const missingToken = await getIcal(context('oketa', OKETA_TOKEN, envWithoutToken));
  assert.equal(missingToken.status, 503);
  assert.doesNotMatch(await missingToken.text(), /BEGIN:VCALENDAR/);

  const failedDB = new IcalDB({ fail: true });
  const failed = await getIcal(context('oketa', OKETA_TOKEN, await tokenEnv(failedDB)));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('retry-after'), '30');
  assert.doesNotMatch(await failed.text(), /BEGIN:VCALENDAR/);
});

test('la ausencia de D1, del registro o de JSON válido cierra el feed', async () => {
  const missingBinding = await getIcal(context('oketa', OKETA_TOKEN, {
    ICAL_EXPORT_OKETA_TOKEN_HASH: await sha256Hex(OKETA_TOKEN),
  }));
  assert.equal(missingBinding.status, 503);

  for (const DB of [
    new IcalDB({ missing: true }),
    new IcalDB({ rawValue: '' }),
    new IcalDB({ rawValue: '{not-json' }),
  ]) {
    const response = await getIcal(context('oketa', OKETA_TOKEN, await tokenEnv(DB)));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.doesNotMatch(await response.text(), /BEGIN:VCALENDAR/);
  }
});

test('una configuración D1 inválida cierra el feed y la recuperación lo restablece', async () => {
  const DB = new IcalDB({
    config: baseConfig([{ id: 'bad', unit: 'oketa', start: '2027-05-01', end: '2027-05-01', note: '' }]),
  });
  const env = await tokenEnv(DB);
  const failed = await getIcal(context('oketa', OKETA_TOKEN, env));
  assert.equal(failed.status, 503);

  DB.config = baseConfig(MANUAL_BLOCKS);
  const recovered = await getIcal(context('oketa', OKETA_TOKEN, env));
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /DTSTART;VALUE=DATE:20270130/);
});

test('no consulta feeds externos ni modifica la configuración D1', async () => {
  const DB = new IcalDB();
  const env = {
    ...await tokenEnv(DB),
    ICAL_OKETA_BOOKING: 'https://private.invalid/booking',
    ICAL_OKETA_AIRBNB: 'https://private.invalid/airbnb',
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('external feed must not be requested');
  };

  try {
    const before = structuredClone(DB.config);
    const response = await getIcal(context('oketa', OKETA_TOKEN, env));
    assert.equal(response.status, 200);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(DB.config, before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admite un feed verificado sin bloqueos y responde HEAD sin cuerpo', async () => {
  const DB = new IcalDB({ config: baseConfig([]) });
  const env = await tokenEnv(DB);
  const empty = await getIcal(context('oketa', OKETA_TOKEN, env));
  assert.equal(empty.status, 200);
  assert.equal(eventUids(await empty.text()).length, 0);

  const head = await headIcal(context('oketa', OKETA_TOKEN, env));
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /^text\/calendar/);
  assert.equal(await head.text(), '');
});
