(function exposeSolapetxeaPricing(root) {
  const DEFAULT_RATES = Object.freeze({
    oketa: Object.freeze({ low: 95, high: 120 }),
    orixol: Object.freeze({ low: 80, high: 90 }),
  });
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function finiteRate(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getSeason(config, iso) {
    const matches = (config?.seasons || []).filter(item => iso >= item.start && iso <= item.end);
    if (matches.some(item => item.type === 'high')) return 'high';
    if (matches.some(item => item.type === 'medium')) return 'medium';
    return 'low';
  }

  function getRatesForYear(config, unit, year) {
    const defaults = DEFAULT_RATES[unit] || { low: 0, high: 0 };
    const legacy = config?.units?.[unit]?.rates || defaults;
    const yearly = config?.units?.[unit]?.ratesByYear?.[String(year)] || {};
    const low = finiteRate(yearly.low, finiteRate(legacy.low, defaults.low));
    return {
      low,
      medium: finiteRate(yearly.medium, low),
      high: finiteRate(yearly.high, finiteRate(legacy.high, defaults.high)),
    };
  }

  function getNightBaseRate(config, unit, iso) {
    if (!DATE_RE.test(iso)) return 0;
    const rates = getRatesForYear(config, unit, Number(iso.slice(0, 4)));
    return rates[getSeason(config, iso)];
  }

  function getApplicableOffer(offers, unit, iso) {
    return (offers || []).find(offer => (
      offer.unit === unit && offer.start_date <= iso && iso < offer.end_date
    ));
  }

  function getNightRate(config, offers, unit, iso) {
    const baseRate = getNightBaseRate(config, unit, iso);
    const offer = getApplicableOffer(offers, unit, iso);
    if (!offer) return baseRate;
    if (offer.discount_type === 'fixed_price') return finiteRate(offer.discount_value, baseRate);
    if (offer.discount_type === 'percentage') {
      const discount = finiteRate(offer.discount_value, 0);
      return Math.round(baseRate * (1 - discount / 100) * 100) / 100;
    }
    return baseRate;
  }

  function isoToUtcDate(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function addDays(iso, days) {
    const date = isoToUtcDate(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function diffNights(startIso, endIso) {
    return Math.round((isoToUtcDate(endIso) - isoToUtcDate(startIso)) / 86400000);
  }

  function getStayBasePrice(config, offers, unit, startIso, endIso) {
    const nights = diffNights(startIso, endIso);
    let total = 0;
    for (let index = 0; index < nights; index += 1) {
      total += getNightRate(config, offers, unit, addDays(startIso, index));
    }
    return Math.round(total * 100) / 100;
  }

  function getAdjustedStayPrice(config, offers, unit, startIso, endIso, guests) {
    const base = getStayBasePrice(config, offers, unit, startIso, endIso);
    const discount = finiteRate(config?.singleOccupancyDiscount, 10);
    return Number(guests) === 1
      ? Math.round(base * (1 - discount / 100) * 100) / 100
      : base;
  }

  root.SolapetxeaPricing = Object.freeze({
    addDays,
    diffNights,
    getAdjustedStayPrice,
    getApplicableOffer,
    getNightBaseRate,
    getNightRate,
    getRatesForYear,
    getSeason,
    getStayBasePrice,
  });
})(globalThis);
