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

function sanitizeOffer(item) {
  const start = typeof item?.start_date === 'string' && DATE_RE.test(item.start_date) ? item.start_date : '';
  const end = typeof item?.end_date === 'string' && DATE_RE.test(item.end_date) ? item.end_date : '';
  const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 100) : '';
  const unit = item?.unit && UNIT_IDS.includes(item.unit) ? item.unit : 'oketa';
  const discountType = item?.discount_type && DISCOUNT_TYPES.includes(item.discount_type) ? item.discount_type : 'fixed_price';
  const value = Number(item?.discount_value);
  const discountValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  
  return {
    id: typeof item?.id === 'string' ? item.id : '',
    start,
    end,
    name,
    unit,
    discountType,
    discountValue,
    enabled: item?.enabled !== false
  };
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
    enabled: offer.enabled
  };
}

export async function onRequestGet(context) {
  if (!context.env?.DB) {
    return json({ ok: true, offers: [] });
  }

  try {
    const rows = await context.env.DB.prepare(
      'SELECT id, unit, start_date, end_date, name, discount_type, discount_value, enabled FROM offers ORDER BY start_date DESC'
    ).all();
    
    const offers = rows.results?.map(r => ({
      id: r.id,
      unit: r.unit,
      start_date: r.start_date,
      end_date: r.end_date,
      name: r.name,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      enabled: r.enabled === 1
    })) || [];
    
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
    const id = `offer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const offer = sanitizeOffer({ ...body, id });
    
    if (!offer.start || !offer.end || offer.start >= offer.end) {
      return json({ ok: false, error: 'Fechas inválidas. El inicio debe ser anterior al final.' }, 400);
    }
    
    if (!offer.name) {
      return json({ ok: false, error: 'El nombre de la oferta es requerido.' }, 400);
    }
    
    if (offer.discountType === 'fixed_price' && offer.discountValue <= 0) {
      return json({ ok: false, error: 'El precio debe ser mayor a 0.' }, 400);
    }
    
    if (offer.discountType === 'percentage' && (offer.discountValue <= 0 || offer.discountValue > 100)) {
      return json({ ok: false, error: 'El descuento debe estar entre 1 y 100%.' }, 400);
    }
    
    await context.env.DB.prepare(`
      INSERT INTO offers (id, unit, start_date, end_date, name, discount_type, discount_value, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      offer.id,
      offer.unit,
      offer.start,
      offer.end,
      offer.name,
      offer.discountType,
      offer.discountValue,
      offer.enabled ? 1 : 0
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
    
    if (!id) {
      return json({ ok: false, error: 'ID de oferta requerido.' }, 400);
    }
    
    const offer = sanitizeOffer(updates);
    
    if (offer.start && offer.end && offer.start >= offer.end) {
      return json({ ok: false, error: 'Fechas inválidas.' }, 400);
    }
    
    await context.env.DB.prepare(`
      UPDATE offers 
      SET unit = ?, start_date = ?, end_date = ?, name = ?, discount_type = ?, discount_value = ?, 
          enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      offer.unit,
      offer.start,
      offer.end,
      offer.name,
      offer.discountType,
      offer.discountValue,
      updates.enabled ? 1 : 0,
      id
    ).run();
    
    return json({ ok: true });
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
    const { id } = body;
    
    if (!id) {
      return json({ ok: false, error: 'ID de oferta requerido.' }, 400);
    }
    
    await context.env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo eliminar la oferta.' }, 400);
  }
}
