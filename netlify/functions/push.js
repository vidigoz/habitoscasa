// netlify/functions/push.js
// Sends a web-push notification to a specific family's subscriptions.
// Called from send-notifications.js (scheduled) or directly for instant pushes.

import webpush from 'web-push';
import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(data) {
  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data }) };
}
function err(msg, code = 400) {
  return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: msg }) };
}

function setupVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@habitoskids.app';
  if (!pub || !priv) throw new Error('VAPID keys not configured');
  webpush.setVapidDetails(email, pub, priv);
}

// Send push to all subscriptions of a family, returns { sent, failed }
export async function sendToFamily(sql, family_id, notification) {
  setupVapid();
  const subs = await sql`SELECT id, endpoint, keys FROM push_subscriptions WHERE family_id = ${family_id}`;
  let sent = 0;
  let failed = 0;
  const expired = [];

  await Promise.all(subs.map(async sub => {
    const pushSub = { endpoint: sub.endpoint, keys: sub.keys };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(notification));
      sent++;
    } catch (e) {
      // 410 Gone = subscription expired, remove it
      if (e.statusCode === 410 || e.statusCode === 404) {
        expired.push(sub.endpoint);
      }
      failed++;
    }
  }));

  if (expired.length) {
    await Promise.all(expired.map(ep =>
      sql`DELETE FROM push_subscriptions WHERE endpoint = ${ep}`
    ));
  }

  return { sent, failed };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return err('POST only', 405);

  let body;
  try { body = JSON.parse(event.body); } catch { return err('Invalid JSON'); }

  const { action, payload = {} } = body;

  let sql;
  try { sql = getDb(); } catch (e) { return err(e.message, 500); }

  try {
    if (action === 'send') {
      const { family_id, notification } = payload;
      if (!family_id || !notification) return err('family_id y notification requeridos');
      const result = await sendToFamily(sql, family_id, notification);
      return ok(result);
    }

    if (action === 'vapid_public_key') {
      const key = process.env.VAPID_PUBLIC_KEY;
      if (!key) return err('VAPID_PUBLIC_KEY no configurado');
      return ok({ key });
    }

    return err(`Unknown action: ${action}`);
  } catch (e) {
    console.error('Push error:', e);
    return err(e.message, 500);
  }
};
