import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import '../calendar-pricing.js';
import {
  getActiveYears,
  getPublicCalendarConfig,
  readOffers,
  sanitizeCalendarConfig,
  writeCalendarConfig,
} from '../functions/_shared/calendar-config.js';
import {
  onRequestGet as getAdminOffers,
  onRequestPost as createOffer,
  onRequestPut as updateOffer,
} from '../functions/api/admin/offers.js';
import { onRequestGet as getCalendar } from '../functions/api/calendar.js';
import { onRequestGet as getSettings } from '../functions/api/settings.js';

const pricing = globalThis.SolapetxeaPricing;

const ROOT = new URL('../', import.meta.url);
const INDEX_SOURCE = await readFile(new URL('index.html', ROOT), 'utf8');
const ADMIN_SOURCE = await readFile(new URL('admin/index.html', ROOT), 'utf8');
const SHARED_SOURCE = await readFile(new URL('functions/_shared/calendar-config.js', ROOT), 'utf8');
const PRICING_SOURCE = await readFile(new URL('calendar-pricing.js', ROOT), 'utf8');

class OffersDB {
  constructor(rows = []) {
    this.rows = structuredClone(rows);
  }

  prepare(sql) {
    const DB = this;
    let values = [];
    return {
      bind(...nextValues) {
        values = nextValues;
        return this;
      },
      async all() {
        const rows = /WHERE enabled = 1/.test(sql) ? DB.rows.filter(row => row.enabled === 1) : DB.rows;
        return { results: structuredClone(rows) };
      },
      async first() {
        const [unit, end, start, minimumStay, excludedId] = values;
        return DB.rows.find(row => (
          row.id !== excludedId
          && row.unit === unit
          && row.enabled === 1
          && row.start_date < end
          && row.end_date > start
          && row.minimum_stay !== null
          && row.minimum_stay !== undefined
          && row.minimum_stay !== minimumStay
        )) || null;
      },
      async run() {
        if (/INSERT INTO offers/.test(sql)) {
          const [id, unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled] = values;
          DB.rows.push({ id, unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled });
        } else if (/UPDATE offers/.test(sql)) {
          const [unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled, id] = values;
          const index = DB.rows.findIndex(row => row.id === id);
          if (index >= 0) DB.rows[index] = { id, unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled };
        }
        return { success: true };
      },
    };
  }
}

function adminRequest(method, body) {
  return new Request('https://calendario-test.example/api/admin/offers', {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-password': 'test-password' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function offer(overrides = {}) {
  return {
    unit: 'oketa',
    start_date: '2026-11-10',
    end_date: '2026-11-16',
    name: 'Oferta noviembre',
    discount_type: 'percentage',
    discount_value: 15,
    enabled: true,
    ...overrides,
  };
}

test('frontend completo conserva años automáticos, días pasados, idioma y formulario moderno', () => {
  assert.match(INDEX_SOURCE, /rollingYears\s*=\s*\(\)\s*=>/);
  assert.match(INDEX_SOURCE, /yearNavContainer/);
  assert.match(INDEX_SOURCE, /\/api\/years/);
  assert.match(INDEX_SOURCE, /isPastIso/);
  assert.match(INDEX_SOURCE, /\.cell\.past/);
  assert.match(INDEX_SOURCE, /id="langSelect"/);
  assert.match(INDEX_SOURCE, /const translations/);
  assert.match(INDEX_SOURCE, /id="sendWa"/);
  assert.match(INDEX_SOURCE, /formPrice/);
  assert.match(INDEX_SOURCE, /openWhatsApp|wa\.me|api\.whatsapp/);
});

test('frontend conserva ofertas, temporadas, tarifas, bloqueos y responsive', () => {
  assert.match(INDEX_SOURCE, /activeOffers/);
  assert.match(INDEX_SOURCE, /offer-badge/);
  assert.match(PRICING_SOURCE, /config\?\.seasons/);
  assert.match(PRICING_SOURCE, /minimumStays/);
  assert.match(INDEX_SOURCE, /manualBlocks/);
  assert.match(INDEX_SOURCE, /@media\s*\(max-width:\s*980px\)/);
  assert.match(INDEX_SOURCE, /@media\s*\(max-width:\s*700px\)/);
  assert.match(SHARED_SOURCE, /rates/);
  assert.match(SHARED_SOURCE, /addManualBlocks/);
  assert.match(INDEX_SOURCE, /Temporada media/);
  assert.match(INDEX_SOURCE, /--season-medium:#e09f1f/);
  assert.match(INDEX_SOURCE, /SolapetxeaPricing/);
});

test('panel de administración completo conserva autenticación, años, ofertas, temporadas y tarifas', () => {
  assert.match(ADMIN_SOURCE, /x-admin-password/);
  assert.match(ADMIN_SOURCE, /yearsContainer/);
  assert.match(ADMIN_SOURCE, /offerRows/);
  assert.match(ADMIN_SOURCE, /seasonRows/);
  assert.match(ADMIN_SOURCE, /minimumRows/);
  assert.match(ADMIN_SOURCE, /blockRows/);
  assert.match(ADMIN_SOURCE, /oketaLow/);
  assert.match(ADMIN_SOURCE, /oketaHigh/);
  assert.match(ADMIN_SOURCE, /oketaMedium/);
  assert.match(ADMIN_SOURCE, /orixolLow/);
  assert.match(ADMIN_SOURCE, /orixolMedium/);
  assert.match(ADMIN_SOURCE, /orixolHigh/);
  assert.match(ADMIN_SOURCE, /rateYearTabs/);
  assert.match(ADMIN_SOURCE, /value="medium"/);
});

test('los scripts incrustados del calendario y Administración tienen sintaxis válida', () => {
  for (const [name, source] of [['calendario', INDEX_SOURCE], ['administración', ADMIN_SOURCE]]) {
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.ok(scripts.length > 0, name);
    scripts.forEach((script, index) => assert.doesNotThrow(
      () => new vm.Script(script, { filename: `${name}-${index}.js` }),
      `${name}, script ${index}`,
    ));
  }
});

test('migra tarifas globales sin perder importes y crea Media a partir de Baja', () => {
  const legacy = {
    version: 1,
    singleOccupancyDiscount: 12,
    units: {
      oketa: { name: 'Oketa', rates: { low: 101, high: 131 } },
      orixol: { name: 'Orixol', rates: { low: 82, high: 94 } },
    },
    seasons: [{ id: 'legacy', name: 'Existente', type: 'high', start: '2025-12-20', end: '2026-01-05' }],
    minimumStays: [{ id: 'minimum', unit: 'oketa', start: '2025-12-20', end: '2026-01-05', nights: 4 }],
    manualBlocks: [{ id: 'block', unit: 'orixol', start: '2025-12-30', end: '2026-01-02', note: 'Conservar' }],
  };

  const migrated = sanitizeCalendarConfig(legacy, [2026, 2027]);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.units.oketa.rates, { low: 101, high: 131 });
  assert.deepEqual(migrated.units.oketa.ratesByYear['2026'], { low: 101, medium: 101, high: 131 });
  assert.deepEqual(migrated.units.oketa.ratesByYear['2027'], { low: 101, medium: 101, high: 131 });
  assert.deepEqual(migrated.units.orixol.ratesByYear['2026'], { low: 82, medium: 82, high: 94 });
  assert.ok(migrated.seasons.some(item => item.id === 'legacy'));
  assert.ok(migrated.minimumStays.some(item => item.id === 'minimum' && item.nights === 4));
  assert.ok(migrated.manualBlocks.some(item => item.id === 'block' && item.note === 'Conservar'));
});

test('conserva tarifas ya configuradas de años no visibles y añade cualquier año nuevo', () => {
  const config = sanitizeCalendarConfig({
    units: {
      oketa: { rates: { low: 95, high: 120 }, ratesByYear: { 2028: { low: 108, medium: 118, high: 138 } } },
      orixol: { rates: { low: 80, high: 90 }, ratesByYear: { 2028: { low: 88, medium: 98, high: 108 } } },
    },
  }, [2026, 2027]);
  assert.deepEqual(config.units.oketa.ratesByYear['2028'], { low: 108, medium: 118, high: 138 });

  const with2029 = sanitizeCalendarConfig(config, [2026, 2027, 2029]);
  assert.deepEqual(with2029.units.oketa.ratesByYear['2029'], { low: 95, medium: 95, high: 120 });
  assert.deepEqual(with2029.units.orixol.ratesByYear['2029'], { low: 80, medium: 80, high: 90 });
});

test('los años visibles se leen de D1 y mantienen fallback seguro', async () => {
  const DB = {
    prepare(sql) {
      assert.match(sql, /active_years/);
      return { async all() { return { results: [{ year: 2026 }, { year: 2027 }, { year: 2028 }] }; } };
    },
  };
  assert.deepEqual(await getActiveYears({ DB }), [2026, 2027, 2028]);
  assert.equal((await getActiveYears({})).length, 2);
});

test('la escritura persiste el formato nuevo en el mismo registro D1', async () => {
  let savedKey = '';
  let savedValue = '';
  const DB = {
    prepare(sql) {
      if (sql.includes('active_years')) {
        return { async all() { return { results: [{ year: 2026 }, { year: 2027 }] }; } };
      }
      assert.match(sql, /INSERT INTO app_config/);
      return {
        bind(key, value) { savedKey = key; savedValue = value; return this; },
        async run() { return { success: true }; },
      };
    },
  };
  const saved = await writeCalendarConfig({ DB }, {
    version: 1,
    units: {
      oketa: { rates: { low: 99, high: 129 } },
      orixol: { rates: { low: 79, high: 89 } },
    },
  });
  assert.equal(savedKey, 'calendar');
  assert.deepEqual(JSON.parse(savedValue), saved);
  assert.equal(saved.version, 2);
  assert.equal(saved.units.oketa.ratesByYear['2027'].medium, 99);
});

test('calcula Baja, Media y Alta por alojamiento y por año', () => {
  const config = {
    singleOccupancyDiscount: 10,
    units: {
      oketa: { rates: { low: 95, high: 120 }, ratesByYear: {
        2026: { low: 100, medium: 110, high: 120 }, 2027: { low: 130, medium: 140, high: 150 },
      } },
      orixol: { rates: { low: 80, high: 90 }, ratesByYear: {
        2026: { low: 80, medium: 90, high: 100 }, 2027: { low: 110, medium: 120, high: 130 },
      } },
    },
    seasons: [
      { type: 'medium', start: '2026-06-10', end: '2026-06-11' },
      { type: 'high', start: '2026-06-12', end: '2026-06-14' },
      { type: 'medium', start: '2027-06-10', end: '2027-06-11' },
      { type: 'high', start: '2027-06-12', end: '2027-06-14' },
    ],
  };
  const cases = [
    ['oketa', '2026-06-09', 100], ['oketa', '2026-06-10', 110], ['oketa', '2026-06-12', 120],
    ['oketa', '2027-06-09', 130], ['oketa', '2027-06-10', 140], ['oketa', '2027-06-12', 150],
    ['orixol', '2026-06-09', 80], ['orixol', '2026-06-10', 90], ['orixol', '2026-06-12', 100],
    ['orixol', '2027-06-09', 110], ['orixol', '2027-06-10', 120], ['orixol', '2027-06-12', 130],
  ];
  for (const [unit, iso, expected] of cases) {
    assert.equal(pricing.getNightBaseRate(config, unit, iso), expected, `${unit} ${iso}`);
  }
});

test('suma cada noche al cruzar temporadas y años', () => {
  const config = {
    singleOccupancyDiscount: 10,
    units: {
      oketa: { ratesByYear: { 2026: { low: 100, medium: 110, high: 120 }, 2027: { low: 130, medium: 140, high: 150 } } },
      orixol: { ratesByYear: { 2026: { low: 80, medium: 90, high: 100 }, 2027: { low: 110, medium: 120, high: 130 } } },
    },
    seasons: [
      { type: 'medium', start: '2026-10-10', end: '2026-10-11' },
      { type: 'high', start: '2026-10-12', end: '2026-10-20' },
    ],
  };
  assert.equal(pricing.getStayBasePrice(config, [], 'oketa', '2026-10-09', '2026-10-11'), 210);
  assert.equal(pricing.getStayBasePrice(config, [], 'oketa', '2026-10-11', '2026-10-13'), 230);
  assert.equal(pricing.getStayBasePrice(config, [], 'oketa', '2026-12-30', '2027-01-02'), 330);
  assert.equal(pricing.getStayBasePrice(config, [], 'orixol', '2026-12-30', '2027-01-02'), 270);
  assert.equal(pricing.getAdjustedStayPrice(config, [], 'oketa', '2026-12-30', '2027-01-02', 1), 297);
});

test('las ofertas siguen aplicándose por noche sobre la tarifa anual correspondiente', () => {
  const config = {
    units: { oketa: { ratesByYear: { 2027: { low: 130, medium: 140, high: 150 } } } },
    seasons: [{ type: 'medium', start: '2027-10-10', end: '2027-10-12' }],
  };
  const percentage = [{ unit: 'oketa', start_date: '2027-10-10', end_date: '2027-10-11', discount_type: 'percentage', discount_value: 10 }];
  assert.equal(pricing.getStayBasePrice(config, percentage, 'oketa', '2027-10-10', '2027-10-12'), 266);
  const fixed = [{ unit: 'oketa', start_date: '2027-10-10', end_date: '2027-10-11', discount_type: 'fixed_price', discount_value: 70 }];
  assert.equal(pricing.getStayBasePrice(config, fixed, 'oketa', '2027-10-10', '2027-10-12'), 210);
  assert.match(PRICING_SOURCE, /getNightRate/);
});

test('el panel muestra y persiste la estancia mínima opcional de cada oferta', () => {
  assert.match(ADMIN_SOURCE, /id="offerMinimumStay"/);
  assert.match(ADMIN_SOURCE, /data-field="minimum_stay"/);
  assert.match(ADMIN_SOURCE, /Usar mínimo normal/);
});

test('el mínimo de oferta sustituye al normal en ambas direcciones y conserva ofertas antiguas', () => {
  const normalTwo = { minimumStays: [{ unit: 'oketa', start: '2026-11-01', end: '2026-11-30', nights: 2 }] };
  const normalFive = { minimumStays: [{ unit: 'oketa', start: '2026-11-01', end: '2026-11-30', nights: 5 }] };

  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer({ minimum_stay: null })], 'oketa', '2026-11-10'), 2);
  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer({ minimum_stay: 3 })], 'oketa', '2026-11-10'), 3);
  assert.equal(pricing.getEffectiveMinimumStay(normalFive, [offer({ minimum_stay: 2 })], 'oketa', '2026-11-10'), 2);
  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer({ minimum_stay: 3, enabled: false })], 'oketa', '2026-11-10'), 2);
  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer({ minimum_stay: 3 })], 'oketa', '2026-11-20'), 2);
  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer()], 'oketa', '2026-11-10'), 2);
  assert.equal(pricing.getEffectiveMinimumStay(normalTwo, [offer({ minimum_stay: 3 })], 'orixol', '2026-11-10'), 1);
});

test('caso real Oketa 29/09: una noche no es válida y dos noches cuestan 180 €', () => {
  const config = {
    units: {
      oketa: { ratesByYear: { 2026: { low: 95, medium: 105, high: 120 } } },
      orixol: { ratesByYear: { 2026: { low: 80, medium: 85, high: 90 } } },
    },
    seasons: [],
    minimumStays: [],
  };
  const offers = [{
    unit: 'oketa',
    start_date: '2026-09-29',
    end_date: '2026-10-01',
    name: 'fin de verano',
    discount_type: 'fixed_price',
    discount_value: 90,
    minimum_stay: 2,
    enabled: true,
  }];

  assert.equal(pricing.getEffectiveMinimumStay(config, offers, 'oketa', '2026-09-29'), 2);
  assert.deepEqual(pricing.getConsultableUnits(config, offers, ['oketa'], '2026-09-29', '2026-09-30'), []);
  assert.deepEqual(pricing.getConsultableUnits(config, offers, ['oketa', 'orixol'], '2026-09-29', '2026-09-30'), ['orixol']);
  assert.deepEqual(pricing.getUnmetOfferMinimums(offers, ['oketa', 'orixol'], '2026-09-29', '2026-09-30').map(item => ({
    unit: item.unit,
    minimumStay: item.minimumStay,
  })), [{ unit: 'oketa', minimumStay: 2 }]);
  assert.deepEqual(pricing.getConsultableUnits(config, offers, ['oketa'], '2026-09-29', '2026-10-01'), ['oketa']);
  assert.deepEqual(pricing.getUnmetOfferMinimums(offers, ['oketa', 'orixol'], '2026-09-29', '2026-10-01'), []);
  assert.equal(pricing.getStayBasePrice(config, offers, 'oketa', '2026-09-29', '2026-10-01'), 180);
});

test('el contexto del modal no mezcla ofertas Oketa y Orixol en ninguno de los sentidos', () => {
  const config = {
    units: {
      oketa: { ratesByYear: { 2026: { low: 95, medium: 95, high: 95 } } },
      orixol: { ratesByYear: { 2026: { low: 80, medium: 80, high: 80 } } },
    },
    seasons: [],
    minimumStays: [],
  };
  const oketaOffer = [{
    unit: 'oketa', start_date: '2026-09-29', end_date: '2026-10-01', name: 'fin de verano',
    discount_type: 'fixed_price', discount_value: 90, minimum_stay: 2, enabled: true,
  }];
  const orixolOffer = [{
    unit: 'orixol', start_date: '2026-09-29', end_date: '2026-10-01', name: 'Orixol test',
    discount_type: 'fixed_price', discount_value: 70, minimum_stay: 2, enabled: true,
  }];

  const validWithOketaOffer = pricing.getConsultableUnits(config, oketaOffer, ['oketa', 'orixol'], '2026-09-29', '2026-09-30');
  assert.deepEqual(validWithOketaOffer, ['orixol']);
  assert.deepEqual(pricing.getUnmetOfferMinimums(oketaOffer, ['oketa', 'orixol'], '2026-09-29', '2026-09-30').map(item => item.unit), ['oketa']);
  assert.equal(pricing.getApplicableOffer(oketaOffer, 'orixol', '2026-09-29'), undefined);
  assert.equal(pricing.getStayBasePrice(config, oketaOffer, 'orixol', '2026-09-29', '2026-09-30'), 80);

  const validWithOrixolOffer = pricing.getConsultableUnits(config, orixolOffer, ['oketa', 'orixol'], '2026-09-29', '2026-09-30');
  assert.deepEqual(validWithOrixolOffer, ['oketa']);
  assert.deepEqual(pricing.getUnmetOfferMinimums(orixolOffer, ['oketa', 'orixol'], '2026-09-29', '2026-09-30').map(item => item.unit), ['orixol']);
  assert.equal(pricing.getApplicableOffer(orixolOffer, 'oketa', '2026-09-29'), undefined);
  assert.equal(pricing.getStayBasePrice(config, orixolOffer, 'oketa', '2026-09-29', '2026-09-30'), 95);

  assert.match(INDEX_SOURCE, /const offersByUnit = getConsultableModalUnits\(\)\.flatMap/);
  assert.match(INDEX_SOURCE, /if\(selectedUnit \|\| !selectedStart \|\| !selectedEnd/);
  assert.match(INDEX_SOURCE, /function showForm\(type\)[\s\S]*?selectedUnit = type;[\s\S]*?updateRangeOfferNotice\(\);[\s\S]*?updateFormPrice\(\);/);
  assert.match(INDEX_SOURCE, /backBtn'\)\.onclick = \(\)=>\{\s*selectedUnit = '';/);
  assert.match(INDEX_SOURCE, /Oferta \{unit\}: estancia mínima \{nights\} noches\. No se aplica a la selección actual\./);
  assert.match(INDEX_SOURCE, /function updateRangeMinimumNotice\(\)[\s\S]*?pricing\.getUnmetOfferMinimums/);
});

test('la fecha de entrada fija el mínimo aunque la estancia cruce el límite de la oferta', () => {
  const config = { minimumStays: [{ unit: 'oketa', start: '2026-11-01', end: '2026-11-30', nights: 5 }] };
  const offers = [offer({ minimum_stay: 2 })];

  assert.equal(pricing.getEffectiveMinimumStay(config, offers, 'oketa', '2026-11-15'), 2, 'entra dentro y sale fuera');
  assert.equal(pricing.getEffectiveMinimumStay(config, offers, 'oketa', '2026-11-09'), 5, 'entra fuera y después cruza la oferta');
  assert.equal(pricing.getEffectiveMinimumStay(config, offers, 'oketa', '2026-11-16'), 5, 'checkout de oferta es exclusivo');
});

test('los descuentos permanecen por noche al cruzar una oferta', () => {
  const config = {
    units: { oketa: { ratesByYear: { 2026: { low: 100, medium: 100, high: 100 } } } },
    seasons: [],
  };
  const offers = [offer({ start_date: '2026-11-10', end_date: '2026-11-12', minimum_stay: 3, discount_value: 20 })];
  assert.equal(pricing.getStayBasePrice(config, offers, 'oketa', '2026-11-09', '2026-11-13'), 360);
});

test('crear, recargar, editar y quitar el mínimo de una oferta lo persiste como nullable', async () => {
  const DB = new OffersDB();
  const env = { DB, ADMIN_PASSWORD: 'test-password' };
  const createdResponse = await createOffer({ request: adminRequest('POST', offer({ minimum_stay: 3 })), env });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.offer.minimum_stay, 3);

  let loaded = await (await getAdminOffers({ env })).json();
  assert.equal(loaded.offers[0].minimum_stay, 3);

  const updatedResponse = await updateOffer({
    request: adminRequest('PUT', offer({ id: created.id, minimum_stay: null })),
    env,
  });
  assert.equal(updatedResponse.status, 200);
  loaded = await (await getAdminOffers({ env })).json();
  assert.equal(loaded.offers[0].minimum_stay, null);
});

test('rechaza mínimos distintos en ofertas activas solapadas del mismo alojamiento', async () => {
  const DB = new OffersDB();
  const env = { DB, ADMIN_PASSWORD: 'test-password' };
  assert.equal((await createOffer({ request: adminRequest('POST', offer({ minimum_stay: 2 })), env })).status, 200);
  assert.equal((await createOffer({
    request: adminRequest('POST', offer({ start_date: '2026-11-12', end_date: '2026-11-18', minimum_stay: 3 })),
    env,
  })).status, 409);

  assert.equal((await createOffer({
    request: adminRequest('POST', offer({ start_date: '2026-11-12', end_date: '2026-11-18', minimum_stay: 2 })),
    env,
  })).status, 200, 'permite el mismo mínimo');
  assert.equal((await createOffer({
    request: adminRequest('POST', offer({ unit: 'orixol', start_date: '2026-11-12', end_date: '2026-11-18', minimum_stay: 3 })),
    env,
  })).status, 200, 'no mezcla alojamientos');
  assert.equal((await createOffer({
    request: adminRequest('POST', offer({ start_date: '2026-11-12', end_date: '2026-11-18', minimum_stay: 3, enabled: false })),
    env,
  })).status, 200, 'permite guardar la oferta conflictiva desactivada');

  const inactive = DB.rows.find(row => row.minimum_stay === 3 && row.enabled === 0 && row.unit === 'oketa');
  assert.equal((await updateOffer({
    request: adminRequest('PUT', offer({ id: inactive.id, start_date: '2026-11-12', end_date: '2026-11-18', minimum_stay: 3, enabled: true })),
    env,
  })).status, 409, 'también impide activar una oferta conflictiva');
});

test('la API pública incluye minimum_stay sin exponer notas ni datos de huéspedes', async () => {
  const publicConfig = getPublicCalendarConfig({
    units: {}, seasons: [], minimumStays: [],
    manualBlocks: [{ id: 'block-1', unit: 'oketa', start: '2026-11-10', end: '2026-11-12', note: 'Nombre de huésped' }],
  });
  assert.deepEqual(publicConfig.manualBlocks, [{ id: 'block-1', unit: 'oketa', start: '2026-11-10', end: '2026-11-12' }]);

  const DB = new OffersDB([{ id: 'old', ...offer(), minimum_stay: null, enabled: 1 }]);
  const publicOffers = await readOffers({ DB });
  assert.equal(publicOffers[0].minimum_stay, null, 'una fila antigua queda representada como sin override');
  const serialized = JSON.stringify({ config: publicConfig, offers: publicOffers });
  assert.doesNotMatch(serialized, /Nombre de huésped|phone|email|document|reservation|guest/i);
});

test('el modo sintético funciona sin feeds iCal ni secretos operativos', async () => {
  const env = { CALENDAR_DATA_MODE: 'synthetic' };
  const calendarResponse = await getCalendar({
    request: new Request('https://calendario-test.example/api/calendar?year=2027'),
    env,
  });
  const calendar = await calendarResponse.json();
  assert.equal(calendar.ok, true);
  assert.equal(calendar.data_mode, 'synthetic');
  assert.deepEqual(calendar.occupancy, { orixol: {}, oketa: {} });

  const settings = await (await getSettings({ env })).json();
  assert.equal(settings.data_mode, 'synthetic');
  assert.equal(settings.config.manualBlocks.length, 0);
});
