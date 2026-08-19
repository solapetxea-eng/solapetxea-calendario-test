import { getActiveYears } from '../_shared/calendar-config.js';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const years = await getActiveYears(context.env);
  return json({ ok: true, years });
}
