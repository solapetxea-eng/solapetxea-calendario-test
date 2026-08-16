import { readCalendarConfig, writeCalendarConfig } from '../../_shared/calendar-config.js';

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
  const config = await readCalendarConfig(context.env);
  return json({ ok: true, config });
}

export async function onRequestPut(context) {
  if (!isAuthorized(context.request, context.env)) {
    return json({ ok: false, error: 'Acceso no autorizado.' }, 401);
  }

  try {
    const body = await context.request.json();
    const config = await writeCalendarConfig(context.env, body.config);
    return json({ ok: true, config, saved_at: new Date().toISOString() });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo guardar.' }, 400);
  }
}
