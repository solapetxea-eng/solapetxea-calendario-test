import { getPublicCalendarConfig, readCalendarConfig } from '../_shared/calendar-config.js';

export async function onRequestGet(context) {
  const config = getPublicCalendarConfig(await readCalendarConfig(context.env));
  return Response.json({
    ok: true,
    data_mode: context.env?.CALENDAR_DATA_MODE === 'synthetic' ? 'synthetic' : 'live',
    config,
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}
