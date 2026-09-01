import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import '../calendar-pricing.js';
import { getActiveYears, sanitizeCalendarConfig, writeCalendarConfig } from '../functions/_shared/calendar-config.js';

const pricing = globalThis.SolapetxeaPricing;

const ROOT = new URL('../', import.meta.url);
const INDEX_SOURCE = await readFile(new URL('index.html', ROOT), 'utf8');
const ADMIN_SOURCE = await readFile(new URL('admin/index.html', ROOT), 'utf8');
const SHARED_SOURCE = await readFile(new URL('functions/_shared/calendar-config.js', ROOT), 'utf8');
const PRICING_SOURCE = await readFile(new URL('calendar-pricing.js', ROOT), 'utf8');

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
  assert.match(INDEX_SOURCE, /minimumStays/);
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
