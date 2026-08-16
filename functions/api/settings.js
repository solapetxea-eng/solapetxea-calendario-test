import { readCalendarConfig } from '../_shared/calendar-config.js';

export async function onRequestGet(context) {
  const config = await readCalendarConfig(context.env);
  return Response.json({ ok: true, config }, {
    headers: { 'cache-control': 'no-store' },
  });
}
