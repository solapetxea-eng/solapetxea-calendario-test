import { getActiveYears } from '../../_shared/calendar-config.js';

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

export async function onRequestGet(context) {
  if (!isAuthorized(context.request, context.env)) {
    return json({ ok: false, error: 'Acceso no autorizado.' }, 401);
  }

  return json({ ok: true, years: await getActiveYears(context.env) });
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
    const year = Number(body.year);
    
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return json({ ok: false, error: 'Año inválido. Debe estar entre 2000 y 2100.' }, 400);
    }

    // Insertar o reactivar año
    await context.env.DB.prepare(
      'INSERT OR REPLACE INTO active_years (year, enabled) VALUES (?, 1)'
    ).bind(year).run();

    const years = await getActiveYears(context.env);
    
    return json({ ok: true, years });
  } catch (error) {
    return json({ 
      ok: false, 
      error: error instanceof Error ? error.message : 'No se pudo agregar el año.' 
    }, 400);
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
    const year = Number(body.year);
    const currentYear = new Date().getUTCFullYear();

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return json({ ok: false, error: 'Año inválido.' }, 400);
    }

    if (year <= currentYear) {
      return json({ 
        ok: false, 
        error: 'No se pueden eliminar años pasados o del año actual.' 
      }, 400);
    }

    // Marcar como deshabilitado en lugar de borrar
    await context.env.DB.prepare(
      'UPDATE active_years SET enabled = 0 WHERE year = ?'
    ).bind(year).run();

    const years = await getActiveYears(context.env);
    
    return json({ ok: true, years });
  } catch (error) {
    return json({ 
      ok: false, 
      error: error instanceof Error ? error.message : 'No se pudo eliminar el año.' 
    }, 400);
  }
}
