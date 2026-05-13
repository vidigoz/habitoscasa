// netlify/functions/api.js
// Single function — routes by req.body.action
// Uses Neon serverless PostgreSQL via DATABASE_URL env var

import { neon } from "@neondatabase/serverless";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(data) {
  return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, data }) };
}
function err(msg, code = 400) {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: msg }) };
}

// ── INIT DB TABLES ─────────────────────────────────────────────────────────
async function initDb(sql) {
  // Families — top-level entity with PIN
  await sql`
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`ALTER TABLE families ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL`;

  // Children
  await sql`
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      total_points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  // Migration: add family_id and avatar if missing
  await sql`ALTER TABLE children ADD COLUMN IF NOT EXISTS family_id TEXT DEFAULT 'default'`;
  await sql`ALTER TABLE children ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '🦁'`;
  await sql`ALTER TABLE habits ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT ''`;
  await sql`ALTER TABLE habits ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      week_start DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS completions (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      day TEXT,
      week_start DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS premios (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      name TEXT NOT NULL,
      points_required INTEGER NOT NULL,
      redeemed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS canjes (
      id TEXT PRIMARY KEY,
      premio_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      redeemed_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      week_start DATE NOT NULL,
      week_label TEXT,
      points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  // Settings keyed as "family_id:key"
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`;
}

// ── HANDLER ────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return err("POST only", 405);

  let body;
  try { body = JSON.parse(event.body); } catch { return err("Invalid JSON"); }

  const { action, payload = {} } = body;

  let sql;
  try { sql = getDb(); } catch (e) { return err(e.message, 500); }

  try {
    await initDb(sql);

    switch (action) {

      // ── FAMILIES ─────────────────────────────────────────────────
      case "create_family": {
        const { id, name, pin } = payload;
        if (!id || !name || !pin) return err("id, name y pin son requeridos");
        if (!/^\d{4}$/.test(pin)) return err("El PIN debe ser exactamente 4 dígitos numéricos");
        await sql`INSERT INTO families (id, name, pin) VALUES (${id}, ${name}, ${pin}) ON CONFLICT (id) DO NOTHING`;
        return ok({ id, name });
      }

      case "auth_family": {
        const { family_id, pin } = payload;
        if (!family_id || !pin) return err("family_id y pin requeridos");
        const rows = await sql`SELECT * FROM families WHERE id = ${family_id}`;
        if (!rows.length) return err("Familia no encontrada");
        if (rows[0].pin !== pin) return err("PIN incorrecto");
        return ok({ name: rows[0].name, email: rows[0].email || null });
      }

      case "link_email": {
        const { family_id, email } = payload;
        if (!family_id || !email) return err("family_id y email requeridos");
        if (!email.toLowerCase().endsWith("@gmail.com")) return err("Solo se aceptan correos @gmail.com");
        const existing = await sql`SELECT id FROM families WHERE email = ${email.toLowerCase()} AND id != ${family_id}`;
        if (existing.length) return err("Este correo ya está asociado a otra familia");
        const rows = await sql`SELECT id FROM families WHERE id = ${family_id}`;
        if (!rows.length) return err("Familia no encontrada");
        await sql`UPDATE families SET email = ${email.toLowerCase()} WHERE id = ${family_id}`;
        return ok({ linked: true, email: email.toLowerCase() });
      }

      case "find_by_email": {
        const { email } = payload;
        if (!email) return err("email requerido");
        if (!email.toLowerCase().endsWith("@gmail.com")) return err("Solo se aceptan correos @gmail.com");
        const rows = await sql`SELECT id, name FROM families WHERE email = ${email.toLowerCase()}`;
        if (!rows.length) return err("No se encontró ninguna familia con ese correo");
        return ok({ family_id: rows[0].id, name: rows[0].name });
      }

      case "get_family_email": {
        const { family_id } = payload;
        if (!family_id) return err("family_id requerido");
        const rows = await sql`SELECT email FROM families WHERE id = ${family_id}`;
        if (!rows.length) return err("Familia no encontrada");
        return ok({ email: rows[0].email || null });
      }

      // ── LOAD ALL (scoped to family) ───────────────────────────────
      case "load": {
        const { family_id } = payload;
        if (!family_id) return ok({ children: [], habits: [], completions: [], premios: [], history: [], settings: {} });

        const children = await sql`SELECT * FROM children WHERE family_id = ${family_id} ORDER BY created_at`;
        const ids = children.map(c => c.id);

        const [habits, completions, premios, history, canjes, sRows] = await Promise.all([
          ids.length ? sql`SELECT * FROM habits WHERE child_id = ANY(${ids}) ORDER BY sort_order, created_at` : Promise.resolve([]),
          ids.length ? sql`SELECT * FROM completions WHERE child_id = ANY(${ids}) ORDER BY created_at` : Promise.resolve([]),
          ids.length ? sql`SELECT * FROM premios WHERE child_id = ANY(${ids}) ORDER BY created_at` : Promise.resolve([]),
          ids.length ? sql`SELECT * FROM history WHERE child_id = ANY(${ids}) ORDER BY created_at` : Promise.resolve([]),
          ids.length ? sql`SELECT * FROM canjes WHERE child_id = ANY(${ids}) ORDER BY redeemed_at` : Promise.resolve([]),
          sql`SELECT key, value FROM settings WHERE key LIKE ${family_id + ":%"}`,
        ]);

        const settings = {};
        sRows.forEach(r => {
          const k = r.key.slice(family_id.length + 1);
          try { settings[k] = JSON.parse(r.value); } catch { settings[k] = r.value; }
        });

        return ok({ children, habits, completions, premios, history, canjes, settings });
      }

      // ── CHILDREN ─────────────────────────────────────────────────
      case "add_child": {
        const { id, name, family_id, avatar } = payload;
        if (!id || !name || !family_id) return err("id, name y family_id requeridos");
        await sql`INSERT INTO children (id, name, total_points, family_id, avatar)
                  VALUES (${id}, ${name}, 0, ${family_id}, ${avatar || "🦁"})
                  ON CONFLICT (id) DO NOTHING`;
        return ok({ id, name, total_points: 0, family_id, avatar: avatar || "🦁" });
      }

      case "delete_child": {
        const { child_id } = payload;
        await sql`DELETE FROM completions WHERE child_id = ${child_id}`;
        await sql`DELETE FROM habits WHERE child_id = ${child_id}`;
        await sql`DELETE FROM canjes WHERE child_id = ${child_id}`;
        await sql`DELETE FROM premios WHERE child_id = ${child_id}`;
        await sql`DELETE FROM history WHERE child_id = ${child_id}`;
        await sql`DELETE FROM children WHERE id = ${child_id}`;
        return ok({ deleted: child_id });
      }

      case "update_points": {
        const { child_id, total_points } = payload;
        await sql`UPDATE children SET total_points = ${total_points} WHERE id = ${child_id}`;
        return ok({ child_id, total_points });
      }

      // ── HABITS ───────────────────────────────────────────────────
      case "add_habit": {
        const { id, child_id, category, name, type, points, icon } = payload;
        await sql`INSERT INTO habits (id, child_id, category, name, type, points, icon, week_start)
                  VALUES (${id}, ${child_id}, ${category}, ${name}, ${type}, ${points}, ${icon || ""}, '1970-01-01')
                  ON CONFLICT (id) DO NOTHING`;
        return ok(payload);
      }

      case "update_habit_icon": {
        const { habit_id, icon } = payload;
        await sql`UPDATE habits SET icon = ${icon} WHERE id = ${habit_id}`;
        return ok({ habit_id, icon });
      }

      case "update_habit_name": {
        const { habit_id, name } = payload;
        await sql`UPDATE habits SET name = ${name} WHERE id = ${habit_id}`;
        return ok({ habit_id, name });
      }

      case "update_habits_order": {
        // payload.order = [{ id, sort_order }, ...]
        const { order } = payload;
        await Promise.all(order.map(({ id, sort_order }) =>
          sql`UPDATE habits SET sort_order = ${sort_order} WHERE id = ${id}`
        ));
        return ok({ updated: order.length });
      }

      case "delete_habit": {
        const { habit_id } = payload;
        await sql`DELETE FROM completions WHERE habit_id = ${habit_id}`;
        await sql`DELETE FROM habits WHERE id = ${habit_id}`;
        return ok({ deleted: habit_id });
      }

      // ── COMPLETIONS ──────────────────────────────────────────────
      case "add_completion": {
        const { id, habit_id, child_id, day, week_start } = payload;
        await sql`INSERT INTO completions (id, habit_id, child_id, day, week_start)
                  VALUES (${id}, ${habit_id}, ${child_id}, ${day}, ${week_start})
                  ON CONFLICT (id) DO NOTHING`;
        return ok(payload);
      }

      case "delete_completion": {
        const { comp_id } = payload;
        await sql`DELETE FROM completions WHERE id = ${comp_id}`;
        return ok({ deleted: comp_id });
      }

      case "delete_completions_by_week": {
        const { week_start, family_id } = payload;
        if (family_id) {
          const ch = await sql`SELECT id FROM children WHERE family_id = ${family_id}`;
          const ids = ch.map(c => c.id);
          if (ids.length) {
            await sql`DELETE FROM completions WHERE week_start = ${week_start} AND child_id = ANY(${ids})`;
          }
        } else {
          await sql`DELETE FROM completions WHERE week_start = ${week_start}`;
        }
        return ok({ deleted_week: week_start });
      }

      // ── PREMIOS ──────────────────────────────────────────────────
      case "add_premio": {
        const { id, child_id, name, points_required } = payload;
        await sql`INSERT INTO premios (id, child_id, name, points_required, redeemed)
                  VALUES (${id}, ${child_id}, ${name}, ${points_required}, false)
                  ON CONFLICT (id) DO NOTHING`;
        return ok(payload);
      }

      case "redeem_premio": {
        // Creates a canje record (the premio itself stays available for future redemptions)
        const { id, premio_id, child_id } = payload;
        await sql`INSERT INTO canjes (id, premio_id, child_id) VALUES (${id}, ${premio_id}, ${child_id}) ON CONFLICT (id) DO NOTHING`;
        return ok({ id, premio_id, child_id });
      }

      case "use_canje": {
        // Mark a canje as physically used — removes it from the pending list
        const { canje_id } = payload;
        await sql`DELETE FROM canjes WHERE id = ${canje_id}`;
        return ok({ deleted: canje_id });
      }

      case "delete_premio": {
        const { premio_id } = payload;
        await sql`DELETE FROM canjes WHERE premio_id = ${premio_id}`;
        await sql`DELETE FROM premios WHERE id = ${premio_id}`;
        return ok({ deleted: premio_id });
      }

      // ── HISTORY ──────────────────────────────────────────────────
      case "add_history": {
        const { id, child_id, week_start, week_label, points } = payload;
        await sql`INSERT INTO history (id, child_id, week_start, week_label, points)
                  VALUES (${id}, ${child_id}, ${week_start}, ${week_label}, ${points})
                  ON CONFLICT (id) DO NOTHING`;
        return ok(payload);
      }

      // ── SETTINGS (keyed as family_id:key) ────────────────────────
      case "save_setting": {
        const { key, value, family_id } = payload;
        const prefixed = family_id ? `${family_id}:${key}` : key;
        const val = typeof value === "string" ? value : JSON.stringify(value);
        await sql`INSERT INTO settings (key, value) VALUES (${prefixed}, ${val})
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        return ok({ key, value });
      }

      // ── CLEAR ALL (scoped to family) ──────────────────────────────
      case "clear_all": {
        const { family_id } = payload;
        if (!family_id) return err("family_id requerido");
        const ch = await sql`SELECT id FROM children WHERE family_id = ${family_id}`;
        const ids = ch.map(c => c.id);
        if (ids.length) {
          await sql`DELETE FROM completions WHERE child_id = ANY(${ids})`;
          await sql`DELETE FROM habits WHERE child_id = ANY(${ids})`;
          await sql`DELETE FROM canjes WHERE child_id = ANY(${ids})`;
          await sql`DELETE FROM premios WHERE child_id = ANY(${ids})`;
          await sql`DELETE FROM history WHERE child_id = ANY(${ids})`;
          await sql`DELETE FROM children WHERE family_id = ${family_id}`;
        }
        await sql`DELETE FROM settings WHERE key LIKE ${family_id + ":%"}`;
        return ok({ cleared: true });
      }

      default:
        return err(`Unknown action: ${action}`);
    }
  } catch (e) {
    console.error("DB error:", e);
    return err(e.message, 500);
  }
};
