function isAuthorized(request, env) {
  const accessEmail = request.headers.get('cf-access-authenticated-user-email');
  if (accessEmail) return true;
  if (!env?.ADMIN_PASSWORD) return false;
  return request.headers.get('x-admin-password') === env.ADMIN_PASSWORD;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

const UNIT_IDS = ['oketa', 'orixol'];
const DISCOUNT_TYPES = ['fixed_price', 'percentage'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseMinimumStay(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

function sanitizeOffer(item) {
  const start = typeof item?.start_date === 'string' && DATE_RE.test(item.start_date) ? item.start_date : '';
  const end = typeof item?.end_date === 'string' && DATE_RE.test(item.end_date) ? item.end_date : '';
  const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 100) : '';
  const unit = UNIT_IDS.includes(item?.unit) ? item.unit : 'oketa';
  const discountType = DISCOUNT_TYPES.includes(item?.discount_type) ? item.discount_type : 'fixed_price';
  const value = Number(item?.discount_value);

  return {
    id: typeof item?.id === 'string' ? item.id : '',
    start,
    end,
    name,
    unit,
    discountType,
    discountValue: Number.isFinite(value) ? Math.max(0, value) : 0,
    minimumStay: parseMinimumStay(item?.minimum_stay),
    enabled: item?.enabled !== false,
  };
}

function validateOffer(offer) {
  if (!offer.start || !offer.end || offer.start >= offer.end) {
    return 'Fechas inválidas. El inicio debe ser anterior al final.';
  }
  if (!offer.name) return 'El nombre de la oferta es requerido.';
  if (offer.discountType === 'fixed_price' && offer.discountValue <= 0) {
    return 'El precio debe ser mayor a 0.';
  }
  if (offer.discountType === 'percentage' && (offer.discountValue <= 0 || offer.discountValue > 100)) {
    return 'El descuento debe estar entre 1 y 100%.';
  }
  if (offer.minimumStay !== null && (
    !Number.isInteger(offer.minimumStay) || offer.minimumStay < 1 || offer.minimumStay > 60
  )) {
    return 'La estancia mínima de la oferta debe ser un número entero entre 1 y 60 noches.';
  }
  return '';
}

function publicOffer(offer) {
  return {
    id: offer.id,
    unit: offer.unit,
    start_date: offer.start,
    end_date: offer.end,
    name: offer.name,
    discount_type: offer.discountType,
    discount_value: offer.discountValue,
    minimum_stay: offer.minimumStay,
    enabled: offer.enabled,
  };
}

async function hasMinimumStayConflict(DB, offer, excludedId = '') {
  if (!offer.enabled || offer.minimumStay === null) return false;

  let sql = `
    SELECT id FROM offers
    WHERE unit = ? AND enabled = 1
      AND start_date < ? AND end_date > ?
      AND minimum_stay IS NOT NULL AND minimum_stay <> ?
  `;
  const values = [offer.unit, offer.end, offer.start, offer.minimumStay];
  if (excludedId) {
    sql += ' AND id <> ?';
    values.push(excludedId);
  }
  sql += ' LIMIT 1';
  return Boolean(await DB.prepare(sql).bind(...values).first());
}

function conflictResponse() {
  return json({
    ok: false,
    error: 'No se puede guardar: existe otra oferta activa solapada para este alojamiento con una estancia mínima propia distinta.',
  }, 409);
}

export async function onRequestGet(context) {
  if (!context.env?.DB) return json({ ok: true, offers: [] });

  try {
    const rows = await context.env.DB.prepare(
      'SELECT id, unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled FROM offers ORDER BY start_date DESC'
    ).all();
    const offers = (rows.results || []).map(row => ({
      id: row.id,
      unit: row.unit,
      start_date: row.start_date,
      end_date: row.end_date,
      name: row.name,
      discount_type: row.discount_type,
      discount_value: row.discount_value,
      minimum_stay: row.minimum_stay ?? null,
      enabled: row.enabled === 1,
    }));
    return json({ ok: true, offers });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Error cargando ofertas' }, 400);
  }
}

export async function onRequestPost(context) {
  if (!isAuthorized(context.request, context.env)) {
    return json({ ok: false, error: 'Acceso no autorizado.' }, 401);
  }
  if (!context.env?.DB) {
    return json({ ok: false, error: 'Falta configurar el binding D1 con el nombre DB.' }, 400);
  }

  try {
    const body = await context.request.json();
    const offer = sanitizeOffer({ ...body, id: `offer-${crypto.randomUUID()}` });
    const validationError = validateOffer(offer);
    if (validationError) return json({ ok: false, error: validationError }, 400);
    if (await hasMinimumStayConflict(context.env.DB, offer)) return conflictResponse();

    await context.env.DB.prepare(`
      INSERT INTO offers (id, unit, start_date, end_date, name, discount_type, discount_value, minimum_stay, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      offer.id,
      offer.unit,
      offer.start,
      offer.end,
      offer.name,
      offer.discountType,
      offer.discountValue,
      offer.minimumStay,
      offer.enabled ? 1 : 0,
    ).run();

    return json({ ok: true, id: offer.id, offer: publicOffer(offer) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo crear la oferta.' }, 400);
  }
}

export async function onRequestPut(context) {
  if (!isAuthorized(context.request, context.env)) {
    return json({ ok: false, error: 'Acceso no autorizado.' }, 401);
  }
  if (!context.env?.DB) {
    return json({ ok: false, error: 'Falta configurar el binding D1 con el nombre DB.' }, 400);
  }

  try {
    const body = await context.request.json();
    const { id, ...updates } = body;
    if (!id) return json({ ok: false, error: 'ID de oferta requerido.' }, 400);

    const offer = sanitizeOffer(updates);
    const validationError = validateOffer(offer);
    if (validationError) return json({ ok: false, error: validationError }, 400);
    if (await hasMinimumStayConflict(context.env.DB, offer, id)) return conflictResponse();

    await context.env.DB.prepare(`
      UPDATE offers
      SET unit = ?, start_date = ?, end_date = ?, name = ?, discount_type = ?, discount_value = ?,
          minimum_stay = ?, enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      offer.unit,
      offer.start,
      offer.end,
      offer.name,
      offer.discountType,
      offer.discountValue,
      offer.minimumStay,
      offer.enabled ? 1 : 0,
      id,
    ).run();

    return json({ ok: true, offer: publicOffer({ ...offer, id }) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo actualizar la oferta.' }, 400);
  }
}

export async function onRequestDelete(context) {
  if (!isAuthorized(context.request, context.env)) {
    return json({ ok: false, error: 'Acceso no autorizado.' }, 401);
  }
  if (!context.env?.DB) {
    return json({ ok: false, error: 'Falta configurar el binding D1 con el nombre DB.' }, 400);
  }

  try {
    const body = await context.request.json();
    if (!body.id) return json({ ok: false, error: 'ID de oferta requerido.' }, 400);
    await context.env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(body.id).run();
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo eliminar la oferta.' }, 400);
  }
}
