// ═══════════════════════════════════════════════════════
//  MisHábitos — app.js
//  Talks to /api/api (Netlify Function → Neon PostgreSQL)
//  Falls back to localStorage when offline / API fails
// ═══════════════════════════════════════════════════════

const API = "/api/api";

// ── UTILS ────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function getWeekStart(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split("T")[0];
}
function getWeekLabel(d = new Date()) {
  const start = new Date(getWeekStart(d));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = { day: "numeric", month: "long" };
  return `${start.toLocaleDateString("es-MX", f)} – ${end.toLocaleDateString("es-MX", f)}`;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
}

// ── STATE ────────────────────────────────────────────────
const S = {
  children: [],       // {id, name, total_points}
  habits: [],         // {id, child_id, category, name, type, points, week_start}
  completions: [],    // {id, habit_id, child_id, day, week_start}
  premios: [],        // {id, child_id, name, points_required, redeemed}
  history: [],        // {id, child_id, week_start, week_label, points}
  settings: {
    label_basicos: "Básicos",
    label_extras: "Extras",
    label_especiales: "Especiales",
  },
  currentChild: null,
  currentCat: null,
  currentView: "home",
  currentWeek: getWeekStart(),
  currentWeekLabel: getWeekLabel(),
};

// ── API CALLS ─────────────────────────────────────────────
async function call(action, payload = {}) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`API [${action}] failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ── PERSISTENCE ──────────────────────────────────────────
function saveLocal() {
  const snap = {
    children: S.children, habits: S.habits, completions: S.completions,
    premios: S.premios, history: S.history, settings: S.settings,
    currentChild: S.currentChild, currentWeek: S.currentWeek,
    currentWeekLabel: S.currentWeekLabel,
  };
  localStorage.setItem("mh_state", JSON.stringify(snap));
}
function loadLocal() {
  const raw = localStorage.getItem("mh_state");
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    Object.assign(S, s);
  } catch {}
}

async function loadFromDB() {
  const r = await call("load");
  if (!r.ok) return false;
  const d = r.data;
  S.children = d.children || [];
  S.habits = d.habits || [];
  S.completions = d.completions || [];
  S.premios = d.premios || [];
  S.history = d.history || [];
  // Map settings rows
  if (d.settings) {
    const raw = d.settings;
    ["label_basicos", "label_extras", "label_especiales"].forEach(k => {
      if (raw[k] !== undefined) S.settings[k] = raw[k];
    });
  }
  return true;
}

// ── DB STATUS ─────────────────────────────────────────────
async function checkDbStatus() {
  const dot = document.getElementById("db-status-dot");
  const txt = document.getElementById("db-status-text");
  const syncEl = document.getElementById("sb-sync-status");
  dot.className = "db-dot db-dot-checking";
  txt.textContent = "Verificando conexión…";
  const r = await call("load");
  if (r.ok) {
    dot.className = "db-dot db-dot-ok";
    txt.textContent = "✅ Conectado a Neon (datos en la nube)";
    syncEl.textContent = "🟢 Neon conectado";
    syncEl.className = "sb-sync ok";
    syncEl.classList.remove("hidden");
  } else {
    dot.className = "db-dot db-dot-err";
    txt.textContent = "❌ Sin conexión — usando datos locales";
    syncEl.textContent = "⚠️ Sin BD — datos locales";
    syncEl.className = "sb-sync err";
    syncEl.classList.remove("hidden");
  }
}

// ── COMPUTED HELPERS ──────────────────────────────────────
function getCatLabel(cat) { return S.settings[`label_${cat}`] || cat; }
function getCatIcon(cat) { return cat === "basicos" ? "🔒" : cat === "extras" ? "🔄" : "🏆"; }
const DAYS = [
  { k: "lun", l: "L" }, { k: "mar", l: "M" }, { k: "mie", l: "X" },
  { k: "jue", l: "J" }, { k: "vie", l: "V" }, { k: "sab", l: "S" }, { k: "dom", l: "D" },
];

function childHabits(child_id, cat) {
  return S.habits.filter(h => h.child_id === child_id && h.category === cat && h.week_start === S.currentWeek);
}
function countDone(habit) {
  return S.completions.filter(c => c.habit_id === habit.id && c.week_start === S.currentWeek).length;
}
function isDayDone(habit, day) {
  return S.completions.some(c => c.habit_id === habit.id && c.day === day && c.week_start === S.currentWeek);
}
function isHabitComplete(habit) {
  const n = countDone(habit);
  return habit.type === "semanal" ? n >= 1 : n >= 4;
}
function basicosComplete(child_id) {
  const bas = S.habits.filter(h => h.child_id === child_id && h.category === "basicos" && h.week_start === S.currentWeek);
  if (!bas.length) return true;
  return bas.every(isHabitComplete);
}
function getTotalPts(child_id) {
  const c = S.children.find(x => x.id === child_id);
  return c ? (c.total_points || 0) : 0;
}
function getValidPts(child_id) {
  return basicosComplete(child_id) ? getTotalPts(child_id) : 0;
}

// ── RENDER ALL ────────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderHomeBars();
  renderCatCards();
  renderBottomNav();
  renderPremios();
  renderDashboard();
  renderHistorial();
  renderChildrenCfg();
  syncLabelInputs();
}

function renderHeader() {
  const child = S.children.find(c => c.id === S.currentChild);
  document.getElementById("hdr-pts").textContent = child ? getValidPts(child.id) : 0;
  document.getElementById("chip-name").textContent = child ? child.name : "—";
  document.getElementById("sb-wk-val").textContent = S.currentWeekLabel;
}

function renderHomeBars() {
  const child = S.children.find(c => c.id === S.currentChild);
  const noChild = document.getElementById("banner-no-child");
  const weekBar = document.getElementById("week-bar");
  const lockBanner = document.getElementById("lock-banner");
  if (!child) {
    noChild.classList.remove("hidden"); weekBar.classList.add("hidden"); lockBanner.classList.add("hidden");
    return;
  }
  noChild.classList.add("hidden"); weekBar.classList.remove("hidden");
  document.getElementById("wk-label").textContent = S.currentWeekLabel;
  document.getElementById("home-pts").textContent = getValidPts(child.id);
  const hasNonBasicos = S.habits.some(h => h.child_id === child.id && h.category !== "basicos" && h.week_start === S.currentWeek);
  if (!basicosComplete(child.id) && hasNonBasicos) lockBanner.classList.remove("hidden");
  else lockBanner.classList.add("hidden");
}

function renderCatCards() {
  ["basicos", "extras", "especiales"].forEach(cat => {
    const habits = S.currentChild
      ? S.habits.filter(h => h.child_id === S.currentChild && h.category === cat && h.week_start === S.currentWeek)
      : [];
    const done = habits.filter(isHabitComplete).length;
    document.getElementById(`cnt-${cat}`).textContent = habits.length;
    document.getElementById(`lbl-${cat}`).textContent = getCatLabel(cat);
    const pct = habits.length ? (done / habits.length) * 100 : 0;
    document.getElementById(`prog-${cat}`).style.width = pct + "%";
  });
}

function renderCatView() {
  const cat = S.currentCat;
  document.getElementById("catv-icon").textContent = getCatIcon(cat);
  document.getElementById("catv-title").textContent = getCatLabel(cat);
  // Hide pts selector for basicos (they don't earn points)
  document.getElementById("pts-field-group").classList.toggle("hidden", cat === "basicos");

  const habits = S.currentChild
    ? S.habits.filter(h => h.child_id === S.currentChild && h.category === cat && h.week_start === S.currentWeek)
    : [];

  const list = document.getElementById("habits-list");
  if (!habits.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--t3);padding:22px;font-weight:600;">Sin hábitos — agrega el primero</p>';
    return;
  }
  list.innerHTML = habits.map(h => buildHabitCard(h)).join("");
  attachHabitHandlers();
}

function buildHabitCard(h) {
  const ptsLabel = h.category !== "basicos" ? ` · ${h.points} pts` : "";
  const typeLabel = h.type === "semanal" ? "☀️ Semanal" : "📅 Diario";
  const done = countDone(h);

  if (h.type === "semanal") {
    const c = done >= 1;
    return `<div class="habit-card">
      <div class="hc-header">
        <div><div class="hc-name">${h.name}</div><div class="hc-meta">${typeLabel}${ptsLabel}</div></div>
        <button class="hc-del" data-del="${h.id}">🗑️</button>
      </div>
      <button class="weekly-btn ${c ? "done" : ""}" data-weekly="${h.id}">
        ${c ? "✅ Completado esta semana" : "❌ Marcar como completado"}
      </button>
    </div>`;
  }

  const pct = Math.min(100, (done / 7) * 100);
  const needed = 4;
  return `<div class="habit-card">
    <div class="hc-header">
      <div><div class="hc-name">${h.name}</div><div class="hc-meta">${typeLabel}${ptsLabel}</div></div>
      <button class="hc-del" data-del="${h.id}">🗑️</button>
    </div>
    <div class="days-row">
      ${DAYS.map(d => {
        const ok = isDayDone(h, d.k);
        return `<button class="day-btn ${ok ? "done" : ""}" data-day="${d.k}" data-habit="${h.id}">${ok ? "✓" : d.l}</button>`;
      }).join("")}
    </div>
    <div class="hc-prog">
      <div class="hc-prog-track"><div class="hc-prog-fill" style="width:${pct}%"></div></div>
      <div class="hc-prog-lbl">${done}/7 días · ${done >= needed ? "✅ Completo" : `faltan ${needed - done} para contar`}</div>
    </div>
  </div>`;
}

function attachHabitHandlers() {
  document.querySelectorAll(".day-btn").forEach(b => b.addEventListener("click", () => toggleDay(b.dataset.habit, b.dataset.day)));
  document.querySelectorAll(".weekly-btn").forEach(b => b.addEventListener("click", () => toggleWeekly(b.dataset.weekly)));
  document.querySelectorAll(".hc-del").forEach(b => b.addEventListener("click", () => deleteHabit(b.dataset.del)));
}

function renderPremios() {
  const child = S.children.find(c => c.id === S.currentChild);
  const valid = child ? getValidPts(child.id) : 0;
  const total = child ? getTotalPts(child.id) : 0;
  document.getElementById("prem-pts").textContent = valid;
  const note = document.getElementById("prem-note");
  if (valid < total) note.textContent = `(+${total - valid} pts bloqueados — completa los Básicos)`;
  else note.textContent = "";

  const premios = child ? S.premios.filter(p => p.child_id === child.id) : [];
  const list = document.getElementById("premios-list");
  if (!premios.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--t3);padding:16px;font-weight:600;">Sin premios creados</p>';
    return;
  }
  list.innerHTML = premios.map(p => {
    const can = !p.redeemed && valid >= p.points_required;
    const pct = Math.min(100, (valid / p.points_required) * 100);
    return `<div class="prem-card ${p.redeemed ? "redeemed" : ""}">
      <div class="prem-info">
        <div class="prem-name">${p.redeemed ? "✅ " : "🎁 "}${p.name}</div>
        <div class="prem-pts-lbl">${p.redeemed ? "Canjeado" : `${p.points_required} pts requeridos`}</div>
        ${!p.redeemed ? `<div class="prem-prog"><div class="prem-prog-track"><div class="prem-prog-fill" style="width:${pct}%"></div></div></div>` : ""}
      </div>
      ${!p.redeemed ? `<button class="btn-canjear" data-canjear="${p.id}" ${can ? "" : "disabled"}>Canjear</button>` : ""}
      <button class="btn-del-prem" data-delprem="${p.id}" title="Eliminar">🗑️</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-canjear]").forEach(b => b.addEventListener("click", () => canjear(b.dataset.canjear)));
  list.querySelectorAll("[data-delprem]").forEach(b => b.addEventListener("click", () => deletePremio(b.dataset.delprem)));
}

function renderDashboard() {
  document.getElementById("dash-wk-lbl").textContent = S.currentWeekLabel;
  const cont = document.getElementById("dash-content");
  if (!S.children.length) { cont.innerHTML = '<p style="text-align:center;color:var(--t3);padding:22px;font-weight:600;">Sin perfiles</p>'; return; }
  cont.innerHTML = S.children.map(c => {
    const all = S.habits.filter(h => h.child_id === c.id && h.week_start === S.currentWeek);
    const done = all.filter(isHabitComplete).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const valid = getValidPts(c.id);
    const total = getTotalPts(c.id);
    const locked = !basicosComplete(c.id);
    return `<div class="dash-card">
      <div class="dash-name">${c.name}</div>
      <div class="dash-stats">
        <div class="ds ds-blue"><div class="ds-num">${all.length}</div><div class="ds-lbl">Hábitos</div></div>
        <div class="ds ds-green"><div class="ds-num">${done}</div><div class="ds-lbl">Completos</div></div>
        <div class="ds ds-gold"><div class="ds-num">${valid}</div><div class="ds-lbl">Pts válidos</div></div>
        <div class="ds ds-pink"><div class="ds-num">${pct}%</div><div class="ds-lbl">Progreso</div></div>
      </div>
      ${locked ? `<div class="dash-lock">🔒 Básicos incompletos — puntos bloqueados</div>` : ""}
    </div>`;
  }).join("");
}

function renderHistorial() {
  const cont = document.getElementById("hist-content");
  if (!S.history.length) { cont.innerHTML = '<p style="text-align:center;color:var(--t3);padding:22px;font-weight:600;">Sin historial todavía</p>'; return; }
  const byWeek = {};
  S.history.forEach(h => {
    if (!byWeek[h.week_start]) byWeek[h.week_start] = { label: h.week_label, rows: [] };
    byWeek[h.week_start].rows.push(h);
  });
  const weeks = Object.keys(byWeek).sort().reverse();
  cont.innerHTML = weeks.map(w => {
    const { label, rows } = byWeek[w];
    return `<div class="hist-card">
      <div class="hist-title">📅 ${label || w}</div>
      ${rows.map(r => {
        const child = S.children.find(c => c.id === r.child_id);
        return `<div class="hist-row">
          <span class="hist-cname">${child ? child.name : r.child_id}</span>
          <span class="hist-badge">⭐ ${r.points} pts</span>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

function renderChildrenCfg() {
  const cont = document.getElementById("children-cfg");
  if (!S.children.length) { cont.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:8px 0;">Sin perfiles</p>'; return; }
  cont.innerHTML = S.children.map(c =>
    `<div class="child-row">
      <span class="child-row-name">${c.name}</span>
      <button class="btn-del-child" data-delchild="${c.id}">🗑️ Eliminar</button>
    </div>`
  ).join("");
  cont.querySelectorAll("[data-delchild]").forEach(b => b.addEventListener("click", () => deleteChild(b.dataset.delchild)));
}

function syncLabelInputs() {
  document.getElementById("lf-basicos").value = S.settings.label_basicos;
  document.getElementById("lf-extras").value = S.settings.label_extras;
  document.getElementById("lf-especiales").value = S.settings.label_especiales;
}

function renderBottomNav() {
  document.querySelectorAll(".bnav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === S.currentView));
}

// ── NAVIGATION ────────────────────────────────────────────
function showView(name) {
  S.currentView = name;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  renderBottomNav();
  closeSidebar();
  if (name === "premios") renderPremios();
  if (name === "dashboard") renderDashboard();
  if (name === "historial") renderHistorial();
}
function openCat(cat) {
  if (!S.currentChild) { toast("Selecciona un perfil primero"); return; }
  S.currentCat = cat;
  renderCatView();
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-category").classList.add("active");
  closeSidebar();
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sb-overlay").classList.add("hidden");
}

// ── ACTIONS ───────────────────────────────────────────────
async function addChild(inputId = "inp-new-child") {
  const configInput = document.getElementById("inp-new-child");
  const bannerInput = document.getElementById("inp-banner-child");
  const sourceInput = inputId ? document.getElementById(inputId) : null;
  const rawName = sourceInput?.value ?? configInput?.value ?? "";
  const name = rawName.trim();
  if (!name) return toast("Escribe un nombre");
  if (S.children.find(c => c.name.toLowerCase() === name.toLowerCase())) return toast("Ya existe ese perfil");
  const child = { id: uid(), name, total_points: 0 };
  const r = await call("add_child", child);
  if (!r.ok) toast("⚠️ Guardado local (sin BD)");
  S.children.push(child);
  if (!S.currentChild) S.currentChild = child.id;
  if (configInput) configInput.value = "";
  if (bannerInput) bannerInput.value = "";
  saveLocal();
  renderAll();
  toast(`✅ ${name} agregado`);
}

async function deleteChild(id) {
  if (!confirm("¿Eliminar este perfil y todos sus datos?")) return;
  await call("delete_child", { child_id: id });
  S.habits = S.habits.filter(h => h.child_id !== id);
  S.completions = S.completions.filter(c => c.child_id !== id);
  S.premios = S.premios.filter(p => p.child_id !== id);
  S.history = S.history.filter(h => h.child_id !== id);
  S.children = S.children.filter(c => c.id !== id);
  if (S.currentChild === id) S.currentChild = S.children[0]?.id || null;
  saveLocal();
  renderAll();
  toast("🗑️ Perfil eliminado");
}

async function addHabit() {
  const name = document.getElementById("inp-habit-name").value.trim();
  if (!name) return toast("Escribe el nombre del hábito");
  const type = document.getElementById("hval-type").value;
  const points = S.currentCat === "basicos" ? 0 : parseInt(document.getElementById("hval-pts").value) || 0;
  const habit = { id: uid(), child_id: S.currentChild, category: S.currentCat, name, type, points, week_start: S.currentWeek };
  const r = await call("add_habit", habit);
  if (!r.ok) toast("⚠️ Guardado local");
  S.habits.push(habit);
  document.getElementById("inp-habit-name").value = "";
  saveLocal();
  renderCatView();
  renderCatCards();
  toast("✅ Hábito agregado");
}

async function deleteHabit(id) {
  const h = S.habits.find(x => x.id === id);
  if (!h) return;
  // Reverse points for non-basicos
  if (h.category !== "basicos") {
    const earned = S.completions.filter(c => c.habit_id === id).length * h.points;
    if (earned > 0) await adjustPts(S.currentChild, -earned);
  }
  await call("delete_habit", { habit_id: id });
  S.completions = S.completions.filter(c => c.habit_id !== id);
  S.habits = S.habits.filter(x => x.id !== id);
  saveLocal();
  renderCatView();
  renderCatCards();
  renderHeader();
  toast("🗑️ Hábito eliminado");
}

async function toggleDay(habit_id, day) {
  const habit = S.habits.find(h => h.id === habit_id);
  if (!habit) return;
  const existing = S.completions.find(c => c.habit_id === habit_id && c.day === day && c.week_start === S.currentWeek);
  if (existing) {
    await call("delete_completion", { comp_id: existing.id });
    S.completions = S.completions.filter(c => c.id !== existing.id);
    if (habit.category !== "basicos") await adjustPts(S.currentChild, -habit.points);
    toast(`${day.toUpperCase()} ❌`);
  } else {
    const comp = { id: uid(), habit_id, child_id: S.currentChild, day, week_start: S.currentWeek };
    const r = await call("add_completion", comp);
    if (!r.ok) toast("⚠️ Guardado local");
    S.completions.push(comp);
    if (habit.category !== "basicos") await adjustPts(S.currentChild, habit.points);
    toast(`${day.toUpperCase()} ✅${habit.category !== "basicos" ? " +" + habit.points + " pts" : ""}`);
  }
  saveLocal();
  renderCatView();
  renderCatCards();
  renderHeader();
  renderHomeBars();
  renderPremios();
}

async function toggleWeekly(habit_id) {
  const habit = S.habits.find(h => h.id === habit_id);
  if (!habit) return;
  const existing = S.completions.find(c => c.habit_id === habit_id && c.week_start === S.currentWeek);
  if (existing) {
    await call("delete_completion", { comp_id: existing.id });
    S.completions = S.completions.filter(c => c.id !== existing.id);
    if (habit.category !== "basicos") await adjustPts(S.currentChild, -habit.points);
    toast("❌ Desmarcado");
  } else {
    const comp = { id: uid(), habit_id, child_id: S.currentChild, day: "semanal", week_start: S.currentWeek };
    const r = await call("add_completion", comp);
    if (!r.ok) toast("⚠️ Guardado local");
    S.completions.push(comp);
    if (habit.category !== "basicos") await adjustPts(S.currentChild, habit.points);
    toast(`✅ Completado${habit.category !== "basicos" ? " +" + habit.points + " pts" : ""}`);
  }
  saveLocal();
  renderCatView();
  renderCatCards();
  renderHeader();
  renderHomeBars();
  renderPremios();
}

async function adjustPts(child_id, diff) {
  const child = S.children.find(c => c.id === child_id);
  if (!child) return;
  child.total_points = Math.max(0, (child.total_points || 0) + diff);
  await call("update_points", { child_id, total_points: child.total_points });
}

async function addPremio() {
  const name = document.getElementById("inp-prem-name").value.trim();
  const pts = parseInt(document.getElementById("inp-prem-pts").value);
  if (!name || !pts || pts <= 0) return toast("Completa todos los campos");
  if (!S.currentChild) return toast("Selecciona un perfil primero");
  const premio = { id: uid(), child_id: S.currentChild, name, points_required: pts, redeemed: false };
  const r = await call("add_premio", premio);
  if (!r.ok) toast("⚠️ Guardado local");
  S.premios.push(premio);
  document.getElementById("inp-prem-name").value = "";
  document.getElementById("inp-prem-pts").value = "";
  saveLocal();
  renderPremios();
  toast("🎁 Premio creado");
}

async function canjear(id) {
  const p = S.premios.find(x => x.id === id);
  if (!p) return;
  const valid = getValidPts(S.currentChild);
  if (valid < p.points_required) return toast("No tienes suficientes puntos");
  if (!basicosComplete(S.currentChild)) return toast("Completa todos los Básicos primero");
  p.redeemed = true;
  await call("redeem_premio", { premio_id: id });
  await adjustPts(S.currentChild, -p.points_required);
  saveLocal();
  renderPremios();
  renderHeader();
  renderDashboard();
  toast(`🎉 ¡${p.name} canjeado!`);
}

async function deletePremio(id) {
  await call("delete_premio", { premio_id: id });
  S.premios = S.premios.filter(p => p.id !== id);
  saveLocal();
  renderPremios();
  toast("🗑️ Premio eliminado");
}

async function startNewWeek() {
  const label = document.getElementById("inp-week-title").value.trim();
  if (!label) return toast("Escribe el título de la semana");
  const oldWeek = S.currentWeek;
  // Save history for each child
  for (const child of S.children) {
    const entry = { id: uid(), child_id: child.id, week_start: oldWeek, week_label: S.currentWeekLabel, points: getTotalPts(child.id) };
    await call("add_history", entry);
    S.history.push(entry);
    child.total_points = 0;
    await call("update_points", { child_id: child.id, total_points: 0 });
  }
  // Delete old completions
  await call("delete_completions_by_week", { week_start: oldWeek });
  S.completions = S.completions.filter(c => c.week_start !== oldWeek);
  S.currentWeek = getWeekStart();
  S.currentWeekLabel = label;
  document.getElementById("modal-week").classList.add("hidden");
  saveLocal();
  renderAll();
  toast("✨ ¡Nueva semana iniciada!");
}

async function saveLabels() {
  S.settings.label_basicos = document.getElementById("lf-basicos").value.trim() || "Básicos";
  S.settings.label_extras = document.getElementById("lf-extras").value.trim() || "Extras";
  S.settings.label_especiales = document.getElementById("lf-especiales").value.trim() || "Especiales";
  await call("save_setting", { key: "label_basicos", value: S.settings.label_basicos });
  await call("save_setting", { key: "label_extras", value: S.settings.label_extras });
  await call("save_setting", { key: "label_especiales", value: S.settings.label_especiales });
  saveLocal();
  renderAll();
  toast("✅ Nombres guardados");
}

async function clearAll() {
  await call("clear_all");
  S.children = []; S.habits = []; S.completions = []; S.premios = []; S.history = [];
  S.currentChild = null;
  localStorage.removeItem("mh_state");
  document.getElementById("clear-confirm").classList.add("hidden");
  renderAll();
  toast("🗑️ Datos eliminados");
}

// ── INIT ──────────────────────────────────────────────────
async function init() {
  loadLocal();
  if (!S.currentChild && S.children.length) S.currentChild = S.children[0].id;

  // Pre-fill new week input
  document.getElementById("inp-week-title").value = getWeekLabel();

  // ── EVENT LISTENERS ───────────────────────────────────
  // Sidebar
  document.getElementById("btn-menu").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sb-overlay").classList.remove("hidden");
  });
  document.getElementById("btn-sb-close").addEventListener("click", closeSidebar);
  document.getElementById("sb-overlay").addEventListener("click", closeSidebar);

  // Nav (sidebar + bottom)
  document.querySelectorAll(".nav-btn[data-view], .bnav-btn[data-view]").forEach(b => {
    b.addEventListener("click", () => showView(b.dataset.view));
  });

  // Category cards
  document.querySelectorAll(".cat-card[data-cat]").forEach(c => {
    c.addEventListener("click", () => openCat(c.dataset.cat));
  });
  document.getElementById("btn-back-cat").addEventListener("click", () => showView("home"));

  // Child switch
  document.getElementById("btn-child-switch").addEventListener("click", () => {
    const modal = document.getElementById("modal-child");
    const list = document.getElementById("modal-child-list");
    list.innerHTML = S.children.map(c =>
      `<button class="modal-child-btn ${c.id === S.currentChild ? "sel" : ""}" data-cid="${c.id}">${c.name}</button>`
    ).join("") || '<p style="color:var(--t3);text-align:center;padding:10px;">Sin perfiles — ve a ⚙️ Config</p>';
    list.querySelectorAll("[data-cid]").forEach(b => {
      b.addEventListener("click", () => {
        S.currentChild = b.dataset.cid;
        modal.classList.add("hidden");
        renderAll();
      });
    });
    modal.classList.remove("hidden");
  });
  document.getElementById("btn-modal-child-close").addEventListener("click", () => document.getElementById("modal-child").classList.add("hidden"));

  // Nueva semana
  document.getElementById("btn-new-week").addEventListener("click", () => {
    document.getElementById("modal-week").classList.remove("hidden");
    closeSidebar();
  });
  document.getElementById("btn-week-confirm").addEventListener("click", startNewWeek);
  document.getElementById("btn-week-cancel").addEventListener("click", () => document.getElementById("modal-week").classList.add("hidden"));
  document.getElementById("inp-week-title").addEventListener("keypress", e => { if (e.key === "Enter") startNewWeek(); });

  // Habit form
  document.getElementById("btn-add-habit").addEventListener("click", addHabit);
  document.getElementById("inp-habit-name").addEventListener("keypress", e => { if (e.key === "Enter") addHabit(); });
  document.querySelectorAll(".seg-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("hval-type").value = b.dataset.val;
    });
  });
  document.querySelectorAll(".pts-b").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".pts-b").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("hval-pts").value = b.dataset.p;
    });
  });

  // Premios
  document.getElementById("btn-add-premio").addEventListener("click", addPremio);

  // Config
  document.getElementById("btn-add-child").addEventListener("click", addChild);
  document.getElementById("inp-new-child").addEventListener("keypress", e => { if (e.key === "Enter") addChild(); });
  document.getElementById("btn-save-labels").addEventListener("click", saveLabels);
  document.getElementById("btn-clear-all").addEventListener("click", () => document.getElementById("clear-confirm").classList.remove("hidden"));
  document.getElementById("btn-clear-yes").addEventListener("click", clearAll);
  document.getElementById("btn-clear-no").addEventListener("click", () => document.getElementById("clear-confirm").classList.add("hidden"));

  const bannerCreateBtn = document.getElementById("btn-banner-create");
  const bannerInput = document.getElementById("inp-banner-child");
  if (bannerCreateBtn) {
    bannerCreateBtn.addEventListener("click", () => addChild("inp-banner-child"));
    if (bannerInput) bannerInput.addEventListener("keypress", e => { if (e.key === "Enter") addChild("inp-banner-child"); });
  }

  // Initial render (local data while DB loads)
  renderAll();

  // Load from DB (may overwrite local)
  const loaded = await loadFromDB();
  if (loaded) {
    if (!S.currentChild && S.children.length) S.currentChild = S.children[0].id;
    saveLocal();
    renderAll();
  }

  // Check DB status in config
  checkDbStatus();

  // Hide splash
  setTimeout(() => {
    const splash = document.getElementById("splash");
    splash.style.transition = "opacity .4s";
    splash.style.opacity = "0";
    setTimeout(() => {
      splash.classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");
    }, 400);
  }, 1000);
}

document.addEventListener("DOMContentLoaded", init);
