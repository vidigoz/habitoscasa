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
  await sql`
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      total_points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
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
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      week_start DATE NOT NULL,
      week_label TEXT,
      points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
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
    // Always ensure tables exist (Neon is serverless, cold starts are fast)
    await initDb(sql);

    switch (action) {

      // ── LOAD ALL ─────────────────────────────────────────────────
      case "load": {
        const [children, habits, completions, premios, history, settings_rows] = await Promise.all([
          sql`SELECT * FROM children ORDER BY created_at`,
          sql`SELECT * FROM habits ORDER BY created_at`,
          sql`SELECT * FROM completions ORDER BY created_at`,
          sql`SELECT * FROM premios ORDER BY created_at`,
          sql`SELECT * FROM history ORDER BY created_at`,
          sql`SELECT key, value FROM settings`,
        ]);
        const settings = {};
        settings_rows.forEach(r => { try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; } });
        return ok({ children, habits, completions, premios, history, settings });
      }

      // ── CHILDREN ─────────────────────────────────────────────────
      case "add_child": {
        const { id, name } = payload;
        if (!id || !name) return err("id and name required");
        await sql`INSERT INTO children (id, name, total_points) VALUES (${id}, ${name}, 0) ON CONFLICT (id) DO NOTHING`;
        return ok({ id, name, total_points: 0 });
      }
      case "delete_child": {
        const { child_id } = payload;
        await sql`DELETE FROM completions WHERE child_id = ${child_id}`;
        await sql`DELETE FROM habits WHERE child_id = ${child_id}`;
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
        const { id, child_id, category, name, type, points, week_start } = payload;
        await sql`INSERT INTO habits (id, child_id, category, name, type, points, week_start)
                  VALUES (${id}, ${child_id}, ${category}, ${name}, ${type}, ${points}, ${week_start})
                  ON CONFLICT (id) DO NOTHING`;
        return ok(payload);
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
        const { week_start } = payload;
        await sql`DELETE FROM completions WHERE week_start = ${week_start}`;
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
        const { premio_id } = payload;
        await sql`UPDATE premios SET redeemed = true WHERE id = ${premio_id}`;
        return ok({ premio_id });
      }
      case "delete_premio": {
        const { premio_id } = payload;
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

      // ── SETTINGS ─────────────────────────────────────────────────
      case "save_setting": {
        const { key, value } = payload;
        const val = typeof value === "string" ? value : JSON.stringify(value);
        await sql`INSERT INTO settings (key, value) VALUES (${key}, ${val})
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        return ok({ key, value });
      }

      // ── CLEAR ALL ────────────────────────────────────────────────
      case "clear_all": {
        await sql`DELETE FROM completions`;
        await sql`DELETE FROM habits`;
        await sql`DELETE FROM premios`;
        await sql`DELETE FROM history`;
        await sql`DELETE FROM children`;
        await sql`DELETE FROM settings`;
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
