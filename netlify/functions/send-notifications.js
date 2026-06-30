// netlify/functions/send-notifications.js
// Scheduled function — runs every hour via netlify.toml cron.
// Evaluates which notifications should fire and sends them.
//
// Notification types:
//   1. nuevo_cuento  — daily at 00:05 (new story available after midnight reset)
//   2. recordatorio  — daily at configured hour (default 19:00) if habits incomplete
//   3. premios       — daily at 09:00 if a child has unclaimed rewards with enough points

import { neon } from '@neondatabase/serverless';
import { sendToFamily } from './push.js';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

function nowInTimezone(tz) {
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function todayStr(tz) {
  const d = nowInTimezone(tz);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStartStr(tz) {
  const d = nowInTimezone(tz);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Day-of-week key used in completions (matches app.js)
const DAY_KEYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const handler = async () => {
  const sql = getDb();

  // Load all families that have push subscriptions
  const families = await sql`
    SELECT DISTINCT ps.family_id, s.value AS notif_settings
    FROM push_subscriptions ps
    LEFT JOIN settings s ON s.key = ps.family_id || ':notif_settings'
  `;

  const results = [];

  for (const family of families) {
    let cfg;
    try { cfg = family.notif_settings ? JSON.parse(family.notif_settings) : {}; } catch { cfg = {}; }

    // Defaults — all enabled, recordatorio at 19:00, timezone America/Mexico_City
    const enabled     = cfg.enabled     !== false;
    const notifCuento = cfg.nuevo_cuento !== false;
    const notifRecord = cfg.recordatorio !== false;
    const notifPremios = cfg.premios     !== false;
    const recordHour  = typeof cfg.recordatorio_hora === 'number' ? cfg.recordatorio_hora : 19;
    const tz          = cfg.timezone || 'America/Mexico_City';

    if (!enabled) continue;

    const now       = nowInTimezone(tz);
    const nowHour   = now.getHours();
    const today     = todayStr(tz);
    const weekStart = getWeekStartStr(tz);
    const dayKey    = DAY_KEYS[now.getDay()];

    const family_id = family.family_id;
    const notifications = [];

    // 1. NUEVO CUENTO — fire at 00:xx (hour 0)
    if (notifCuento && nowHour === 0) {
      // Check that a story was already generated yesterday (i.e. there are children)
      const children = await sql`SELECT id, name FROM children WHERE family_id = ${family_id}`;
      if (children.length > 0) {
        // Only send if family has at least one child with stories
        const recentStory = await sql`
          SELECT id FROM stories
          WHERE family_id = ${family_id}
          AND created_at >= NOW() - INTERVAL '2 days'
          LIMIT 1`;
        if (recentStory.length > 0) {
          notifications.push({
            title: '📖 ¡Nuevo cuento listo!',
            body: 'Ya puedes leer un nuevo cuento esta noche. ¡A disfrutar!',
            tag: 'nuevo_cuento',
            url: '/',
          });
        }
      }
    }

    // 2. RECORDATORIO DE HÁBITOS — fire at configured hour (default 19)
    if (notifRecord && nowHour === recordHour) {
      const children = await sql`SELECT id, name FROM children WHERE family_id = ${family_id}`;

      for (const child of children) {
        // Get daily habits for today's day
        const dailyHabits = await sql`
          SELECT h.id, h.name FROM habits h
          WHERE h.child_id = ${child.id} AND h.type = 'diario'`;

        if (dailyHabits.length === 0) continue;

        // Check which ones are completed today
        const completed = await sql`
          SELECT habit_id FROM completions
          WHERE child_id = ${child.id}
          AND day = ${dayKey}
          AND week_start = ${weekStart}`;

        const completedIds = new Set(completed.map(c => c.habit_id));
        const pending = dailyHabits.filter(h => !completedIds.has(h.id));

        if (pending.length > 0) {
          notifications.push({
            title: `⏰ ¡Recuerda los hábitos de ${child.name}!`,
            body: pending.length === 1
              ? `Falta completar: ${pending[0].name}`
              : `Faltan ${pending.length} hábitos por completar hoy`,
            tag: `recordatorio_${child.id}`,
            url: '/',
          });
        }
      }
    }

    // 3. PREMIOS PENDIENTES — fire at 09:00
    if (notifPremios && nowHour === 9) {
      const children = await sql`SELECT id, name, total_points FROM children WHERE family_id = ${family_id}`;

      for (const child of children) {
        // Premios reachable (enough points, not yet redeemed today — check canjes from last 24h)
        const reachable = await sql`
          SELECT p.id, p.name, p.points_required
          FROM premios p
          WHERE p.child_id = ${child.id}
          AND p.points_required <= ${child.total_points}
          AND NOT EXISTS (
            SELECT 1 FROM canjes c
            WHERE c.premio_id = p.id
            AND c.redeemed_at >= NOW() - INTERVAL '7 days'
          )
          LIMIT 3`;

        if (reachable.length > 0) {
          const names = reachable.map(p => p.name).join(', ');
          notifications.push({
            title: `🎁 ¡${child.name} tiene premios disponibles!`,
            body: reachable.length === 1
              ? `Puede canjear: ${reachable[0].name} (${reachable[0].points_required} pts)`
              : `Puede canjear ${reachable.length} premios: ${names}`,
            tag: `premios_${child.id}`,
            url: '/',
          });
        }
      }
    }

    // Send collected notifications
    for (const notif of notifications) {
      try {
        const result = await sendToFamily(sql, family_id, notif);
        results.push({ family_id, notif: notif.tag, ...result });
      } catch (e) {
        results.push({ family_id, notif: notif.tag, error: e.message });
      }
    }
  }

  console.log('Notifications sent:', JSON.stringify(results));
  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
};
