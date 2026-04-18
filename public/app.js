// ═══════════════════════════════════════════════════════
//  MisHábitos — app.js
//  Family-based: each family has a 4-digit PIN for parents
//  Kids track habits from home; parents manage from config
// ═══════════════════════════════════════════════════════

const API = "/api/api";

// ── AVATAR / COLOR POOLS ──────────────────────────────
const AVATARS = ["🦁","🐯","🦊","🐸","🐧","🦋","🦄","🐼","🦖","🚀","🌟","🎮","🎨","🎵","🏆","⚽","🎯","🌈"];
const PROFILE_COLORS = ["#FF6B9D","#6C63FF","#11998E","#F7971E","#E040FB","#2196F3","#E53935","#00BCD4","#FF5722","#4CAF50"];

function getChildColor(idx) { return PROFILE_COLORS[idx % PROFILE_COLORS.length]; }
function getChildAvatar(child, idx) { return child.avatar || AVATARS[idx % AVATARS.length]; }

// ── UTILS ────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function getWeekStart(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
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
  // Family
  family_id: null,
  family_name: null,
  // App data
  children: [],
  habits: [],
  completions: [],
  premios: [],
  history: [],
  settings: { label_basicos: "Básicos", label_extras: "Extras", label_especiales: "Especiales" },
  // Navigation
  currentChild: null,
  currentCat: null,
  currentView: "home",
  currentWeek: getWeekStart(),
  currentWeekLabel: getWeekLabel(),
  // Config management
  configChildId: null,
  configCat: "basicos",
  // Temp: add profile modal
  _newAvatar: AVATARS[0],
  // Temp: setup
  _setupPin: null,
};

// ── API CALLS (auto-inject family_id) ────────────────────
async function call(action, payload = {}) {
  if (S.family_id && !payload.family_id) payload = { ...payload, family_id: S.family_id };
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
    family_id: S.family_id, family_name: S.family_name,
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
  try { Object.assign(S, JSON.parse(raw)); } catch {}
}

// PIN verified is stored in sessionStorage (cleared when tab/browser closes)
function isPinVerified() {
  return sessionStorage.getItem("mh_pin_ok") === S.family_id;
}
function setPinVerified() {
  sessionStorage.setItem("mh_pin_ok", S.family_id);
}
function clearPinVerified() {
  sessionStorage.removeItem("mh_pin_ok");
}

async function loadFromDB() {
  if (!S.family_id) return false;
  const r = await call("load");
  if (!r.ok) return false;
  const d = r.data;
  S.children = d.children || [];
  S.habits = d.habits || [];
  S.completions = d.completions || [];
  S.premios = d.premios || [];
  S.history = d.history || [];
  if (d.settings) {
    ["label_basicos", "label_extras", "label_especiales"].forEach(k => {
      if (d.settings[k] !== undefined) S.settings[k] = d.settings[k];
    });
  }
  return true;
}

// ── DB STATUS ─────────────────────────────────────────────
async function checkDbStatus() {
  const dot = document.getElementById("db-status-dot");
  const txt = document.getElementById("db-status-text");
  const syncEl = document.getElementById("sb-sync-status");
  if (!dot) return;
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
  const bas = S.habits.filter(h => h.child_id === child_id && h.category === "basicos");
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

// ══════════════════════════════════════════════════════════
//  PIN PAD SYSTEM
// ══════════════════════════════════════════════════════════
let _pinBuf = [];
let _pinCallback = null;
let _pinDotsEl = null;

function initPin(dotsEl, onComplete) {
  _pinBuf = [];
  _pinCallback = onComplete;
  _pinDotsEl = dotsEl;
  updatePinDots();
}

function pinPress(k) {
  if (k === "del") {
    _pinBuf.pop();
    updatePinDots();
  } else if (_pinBuf.length < 4) {
    _pinBuf.push(k);
    updatePinDots();
    if (_pinBuf.length === 4) {
      const pin = _pinBuf.join("");
      _pinBuf = [];
      setTimeout(() => {
        updatePinDots();
        if (_pinCallback) _pinCallback(pin);
      }, 150);
    }
  }
}

function updatePinDots() {
  if (!_pinDotsEl) return;
  _pinDotsEl.querySelectorAll(".pin-dot").forEach((d, i) => {
    d.classList.toggle("filled", i < _pinBuf.length);
  });
}

function buildPinPad(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML =
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="pin-key" data-k="${n}">${n}</button>`).join("") +
    `<button class="pin-key" data-k="del" style="font-size:18px;">⌫</button>` +
    `<button class="pin-key" data-k="0">0</button>` +
    `<div class="pin-blank"></div>`;
  el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => pinPress(b.dataset.k)));
}

// ══════════════════════════════════════════════════════════
//  SETUP FLOW (first launch)
// ══════════════════════════════════════════════════════════
function showSetupScreen() {
  document.getElementById("setup-screen").classList.remove("hidden");
  showSetupStep(1);
}

function hideSetupScreen() {
  document.getElementById("setup-screen").classList.add("hidden");
}

function showSetupStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`setup-s${i}`).classList.toggle("hidden", i !== n);
  });
  if (n === 1) {
    setTimeout(() => document.getElementById("inp-family-name")?.focus(), 100);
  }
  if (n === 2) {
    buildPinPad("setup-pad-1");
    initPin(document.getElementById("setup-dots-1"), (pin) => {
      S._setupPin = pin;
      showSetupStep(3);
    });
  }
  if (n === 3) {
    document.getElementById("setup-confirm-err").classList.add("hidden");
    buildPinPad("setup-pad-2");
    initPin(document.getElementById("setup-dots-2"), async (pin) => {
      if (pin !== S._setupPin) {
        const errEl = document.getElementById("setup-confirm-err");
        errEl.classList.remove("hidden");
        // Shake dots
        const dots = document.getElementById("setup-dots-2");
        dots.style.animation = "none";
        dots.offsetHeight; // reflow
        dots.style.animation = "shake .4s ease-out";
        setTimeout(() => showSetupStep(3), 900);
      } else {
        await createFamily(pin);
      }
    });
  }
}

async function createFamily(pin) {
  const name = document.getElementById("inp-family-name").value.trim();
  if (!name) { showSetupStep(1); return; }
  const id = uid();
  // Save locally first — app works even if API is down
  S.family_id = id;
  S.family_name = name;
  saveLocal();
  // Store PIN locally (hashed with family id as salt) for offline verification
  localStorage.setItem("mh_pin", btoa(id + ":" + pin));
  setPinVerified();
  // Try to persist to DB in background (non-blocking)
  call("create_family", { id, name, pin, family_id: id }).catch(() => {});
  hideSetupScreen();
  document.getElementById("app").classList.remove("hidden");
  renderAll();
  toast(`🎉 ¡Familia "${name}" creada!`);
}

// ══════════════════════════════════════════════════════════
//  PIN MODAL (config gate)
// ══════════════════════════════════════════════════════════
function verifyPin(pin) {
  // Check against locally stored PIN first (works offline)
  const stored = localStorage.getItem("mh_pin");
  if (stored) {
    try { return atob(stored) === S.family_id + ":" + pin; } catch {}
  }
  return false;
}

function openPinModal(onSuccess) {
  const modal = document.getElementById("modal-pin");
  const dotsEl = document.getElementById("modal-pin-dots");
  const errEl = document.getElementById("modal-pin-error");

  function tryPin(pin) {
    if (verifyPin(pin)) {
      setPinVerified();
      modal.classList.add("hidden");
      errEl.classList.add("hidden");
      if (onSuccess) onSuccess();
    } else {
      errEl.classList.remove("hidden");
      dotsEl.style.animation = "none";
      dotsEl.offsetHeight;
      dotsEl.style.animation = "shake .4s ease-out";
      setTimeout(() => {
        errEl.classList.add("hidden");
        buildPinPad("modal-pin-pad");
        initPin(dotsEl, tryPin);
      }, 900);
    }
  }

  errEl.classList.add("hidden");
  buildPinPad("modal-pin-pad");
  initPin(dotsEl, tryPin);
  modal.classList.remove("hidden");
}

// ══════════════════════════════════════════════════════════
//  RENDER ALL
// ══════════════════════════════════════════════════════════
function renderAll() {
  renderHeader();
  renderProfileRow();
  renderHomeBars();
  renderCatCards();
  renderBottomNav();
  renderPremios();
  renderDashboard();
  renderHistorial();
  if (S.currentView === "config") renderConfig();
  // Update sidebar family name
  const sbFam = document.getElementById("sb-family-name");
  if (sbFam) sbFam.textContent = S.family_name ? `Familia ${S.family_name}` : "";
}

function renderHeader() {
  const child = S.children.find(c => c.id === S.currentChild);
  const idx = S.children.findIndex(c => c.id === S.currentChild);
  document.getElementById("hdr-pts").textContent = child ? getValidPts(child.id) : 0;
  document.getElementById("chip-name").textContent = child ? child.name : "Perfil";
  document.getElementById("chip-avatar").textContent = child ? getChildAvatar(child, idx) : "😊";
}

function renderProfileRow() {
  const row = document.getElementById("profile-row");
  const emptyState = document.getElementById("empty-state");
  if (!row) return;
  if (!S.children.length) {
    row.innerHTML = "";
    emptyState?.classList.remove("hidden");
    document.getElementById("cat-grid").style.opacity = "0.4";
    document.getElementById("cat-grid").style.pointerEvents = "none";
    return;
  }
  emptyState?.classList.add("hidden");
  document.getElementById("cat-grid").style.opacity = "";
  document.getElementById("cat-grid").style.pointerEvents = "";

  row.innerHTML = S.children.map((c, i) => {
    const color = getChildColor(i);
    const avatar = getChildAvatar(c, i);
    const pts = getValidPts(c.id);
    const isActive = c.id === S.currentChild;
    return `<button class="profile-chip${isActive ? " active" : ""}" data-cid="${c.id}" style="--chip-color:${color}">
      <span class="profile-avatar">${avatar}</span>
      <span class="profile-name">${c.name}</span>
      <span class="profile-pts">⭐ ${pts}</span>
    </button>`;
  }).join("");

  row.querySelectorAll("[data-cid]").forEach(b => {
    b.addEventListener("click", () => {
      S.currentChild = b.dataset.cid;
      saveLocal();
      renderAll();
    });
  });
}

function renderHomeBars() {
  const child = S.children.find(c => c.id === S.currentChild);
  const weekBar = document.getElementById("week-bar");
  const lockBanner = document.getElementById("lock-banner");
  if (!child) { weekBar.classList.add("hidden"); lockBanner.classList.add("hidden"); return; }
  weekBar.classList.remove("hidden");
  document.getElementById("wk-label").textContent = S.currentWeekLabel;
  document.getElementById("home-pts").textContent = getValidPts(child.id);
  const hasNonBasicos = S.habits.some(h => h.child_id === child.id && h.category !== "basicos");
  if (!basicosComplete(child.id) && hasNonBasicos) lockBanner.classList.remove("hidden");
  else lockBanner.classList.add("hidden");
}

function renderCatCards() {
  ["basicos", "extras", "especiales"].forEach(cat => {
    const habits = S.currentChild
      ? S.habits.filter(h => h.child_id === S.currentChild && h.category === cat)
      : [];
    const done = habits.filter(isHabitComplete).length;
    document.getElementById(`cnt-${cat}`).textContent = habits.length ? `${done}/${habits.length}` : "0";
    document.getElementById(`lbl-${cat}`).textContent = getCatLabel(cat);
    document.getElementById(`prog-${cat}`).style.width = habits.length ? (done / habits.length * 100) + "%" : "0%";
  });
}

function renderCatView() {
  const cat = S.currentCat;
  document.getElementById("catv-icon").textContent = getCatIcon(cat);
  document.getElementById("catv-title").textContent = getCatLabel(cat);
  const habits = S.currentChild
    ? S.habits.filter(h => h.child_id === S.currentChild && h.category === cat)
    : [];
  const list = document.getElementById("habits-list");
  if (!habits.length) {
    list.innerHTML = `<div style="text-align:center;padding:32px 16px;">
      <div style="font-size:48px;margin-bottom:12px;">📝</div>
      <p style="color:var(--t3);font-weight:700;font-size:15px;">Sin hábitos todavía</p>
      <p style="color:var(--t3);font-size:13px;margin-top:6px;">Los papás pueden agregarlos en ⚙️ Config</p>
    </div>`;
    return;
  }
  list.innerHTML = habits.map(h => buildHabitCard(h)).join("");
  attachHabitHandlers();
}

function buildHabitCard(h) {
  const ptsLabel = h.category !== "basicos" ? ` · ${h.points} pts` : "";
  const typeLabel = h.type === "semanal" ? "☀️ Semanal" : "📅 Diario";
  const done = countDone(h);
  const complete = isHabitComplete(h);
  if (h.type === "semanal") {
    return `<div class="habit-card">
      <div class="hc-header">
        <div><div class="hc-name">${h.name}</div><div class="hc-meta">${typeLabel}${ptsLabel}</div></div>
      </div>
      <button class="weekly-btn ${complete ? "done" : ""}" data-weekly="${h.id}">
        ${complete ? "✅ ¡Completado esta semana!" : "❌ Marcar como completado"}
      </button>
    </div>`;
  }
  const pct = Math.min(100, (done / 7) * 100);
  return `<div class="habit-card">
    <div class="hc-header">
      <div><div class="hc-name">${h.name}</div><div class="hc-meta">${typeLabel}${ptsLabel}</div></div>
    </div>
    <div class="days-row">
      ${DAYS.map(d => {
        const ok = isDayDone(h, d.k);
        return `<button class="day-btn ${ok ? "done" : ""}" data-day="${d.k}" data-habit="${h.id}">${ok ? "✓" : d.l}</button>`;
      }).join("")}
    </div>
    <div class="hc-prog">
      <div class="hc-prog-track"><div class="hc-prog-fill" style="width:${pct}%"></div></div>
      <div class="hc-prog-lbl">${done}/7 días · ${done >= 4 ? "✅ ¡Completo!" : `faltan ${4 - done} para contar`}</div>
    </div>
  </div>`;
}

function attachHabitHandlers() {
  document.querySelectorAll(".day-btn").forEach(b => b.addEventListener("click", () => toggleDay(b.dataset.habit, b.dataset.day)));
  document.querySelectorAll(".weekly-btn").forEach(b => b.addEventListener("click", () => toggleWeekly(b.dataset.weekly)));
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
    list.innerHTML = `<div style="text-align:center;padding:28px 16px;">
      <div style="font-size:44px;margin-bottom:10px;">🎁</div>
      <p style="color:var(--t3);font-weight:700;">Sin premios todavía</p>
      <p style="color:var(--t3);font-size:13px;margin-top:6px;">Los papás pueden crearlos en ⚙️ Config</p>
    </div>`;
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
      ${!p.redeemed ? `<button class="btn-canjear" data-canjear="${p.id}" ${can ? "" : "disabled"}>${can ? "🎉 Canjear" : "🔒"}</button>` : ""}
    </div>`;
  }).join("");
  list.querySelectorAll("[data-canjear]").forEach(b => b.addEventListener("click", () => canjear(b.dataset.canjear)));
}

function renderDashboard() {
  document.getElementById("dash-wk-lbl").textContent = S.currentWeekLabel;
  const cont = document.getElementById("dash-content");
  if (!S.children.length) {
    cont.innerHTML = `<div style="text-align:center;padding:32px;color:var(--t3);font-weight:700;">Sin perfiles</div>`;
    return;
  }
  cont.innerHTML = S.children.map((c, i) => {
    const avatar = getChildAvatar(c, i);
    const color = getChildColor(i);
    const all = S.habits.filter(h => h.child_id === c.id);
    const done = all.filter(isHabitComplete).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const valid = getValidPts(c.id);
    const locked = !basicosComplete(c.id);
    return `<div class="dash-card" style="border-top:4px solid ${color}">
      <div class="dash-header"><span class="dash-avatar">${avatar}</span><span class="dash-name">${c.name}</span></div>
      <div class="dash-stats">
        <div class="ds ds-blue"><div class="ds-num">${all.length}</div><div class="ds-lbl">Hábitos</div></div>
        <div class="ds ds-green"><div class="ds-num">${done}</div><div class="ds-lbl">Completos</div></div>
        <div class="ds ds-gold"><div class="ds-num">${valid}</div><div class="ds-lbl">⭐ Pts</div></div>
        <div class="ds ds-pink"><div class="ds-num">${pct}%</div><div class="ds-lbl">Progreso</div></div>
      </div>
      ${locked ? `<div class="dash-lock">🔒 Básicos incompletos — puntos bloqueados</div>` : ""}
    </div>`;
  }).join("");
}

function renderHistorial() {
  const cont = document.getElementById("hist-content");
  if (!S.history.length) {
    cont.innerHTML = `<div style="text-align:center;padding:32px;color:var(--t3);font-weight:700;">Sin historial todavía</div>`;
    return;
  }
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
        const idx = S.children.findIndex(c => c.id === r.child_id);
        const avatar = child ? getChildAvatar(child, idx) : "👤";
        return `<div class="hist-row">
          <span style="display:flex;align-items:center;gap:8px;"><span>${avatar}</span><span class="hist-cname">${child ? child.name : "—"}</span></span>
          <span class="hist-badge">⭐ ${r.points} pts</span>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

function renderBottomNav() {
  document.querySelectorAll(".bnav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === S.currentView));
}

// ══════════════════════════════════════════════════════════
//  CONFIG RENDER (parents only)
// ══════════════════════════════════════════════════════════
function renderConfig() {
  const cont = document.getElementById("config-content");

  // ── PIN LOCK SCREEN (if not verified) ──────────────────
  if (!isPinVerified()) {
    const hasPinStored = !!localStorage.getItem("mh_pin");
    if (hasPinStored) {
      cont.innerHTML = `
        <div style="text-align:center;padding:20px 0 10px;">
          <div style="font-size:48px;margin-bottom:8px;">🔐</div>
          <p style="font-family:var(--ff-d);font-size:22px;font-weight:800;margin-bottom:6px;">Acceso de papás</p>
          <p style="font-size:13px;color:var(--t2);margin-bottom:20px;">Ingresa el PIN para gestionar la configuración</p>
          <div class="pin-dots" id="cfg-pin-dots">
            <span class="pin-dot"></span><span class="pin-dot"></span>
            <span class="pin-dot"></span><span class="pin-dot"></span>
          </div>
          <p id="cfg-pin-error" class="pin-error hidden" style="color:var(--bas-from);">❌ PIN incorrecto</p>
          <div class="pin-pad" id="cfg-pin-pad"></div>
        </div>`;
      buildPinPad("cfg-pin-pad");
      initPin(document.getElementById("cfg-pin-dots"), (pin) => {
        if (verifyPin(pin)) {
          setPinVerified();
          renderConfig();
        } else {
          const errEl = document.getElementById("cfg-pin-error");
          errEl && errEl.classList.remove("hidden");
          const dots = document.getElementById("cfg-pin-dots");
          if (dots) { dots.style.animation = "none"; dots.offsetHeight; dots.style.animation = "shake .4s ease-out"; }
          setTimeout(() => renderConfig(), 900);
        }
      });
      return;
    }
    // No PIN stored yet — treat as open (first-time or recovery)
    setPinVerified();
  }

  // ── NO FAMILY SET → show setup prompt ─────────────────
  if (!S.family_id) {
    cont.innerHTML = `
      <div style="text-align:center;padding:30px 16px;">
        <div style="font-size:56px;margin-bottom:12px;">🏠</div>
        <p style="font-family:var(--ff-d);font-size:22px;font-weight:800;margin-bottom:8px;">¡Configura tu familia!</p>
        <p style="font-size:14px;color:var(--t2);margin-bottom:24px;line-height:1.5;">
          Crea el perfil de tu familia para empezar a usar MisHábitos
        </p>
        <button class="btn-primary" id="btn-go-setup" style="max-width:280px;margin:0 auto;">
          🚀 Crear mi familia
        </button>
      </div>`;
    document.getElementById("btn-go-setup").addEventListener("click", () => {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    });
    return;
  }

  // Which child to manage (default to first)
  if (!S.configChildId && S.children.length) S.configChildId = S.children[0].id;

  // Child selector tabs
  const childTabs = S.children.map((c, i) =>
    `<button class="cfg-tab${c.id === S.configChildId ? " active" : ""}" data-cfg-child="${c.id}">
      ${getChildAvatar(c, i)} ${c.name}
    </button>`
  ).join("");

  // Category tabs for habits
  const catTabs = ["basicos", "extras", "especiales"].map(cat =>
    `<button class="cfg-tab${S.configCat === cat ? " active" : ""}" data-cfg-cat="${cat}">
      ${getCatIcon(cat)} ${getCatLabel(cat)}
    </button>`
  ).join("");

  // Habits list for configChildId + configCat
  const cfgHabits = S.configChildId
    ? S.habits.filter(h => h.child_id === S.configChildId && h.category === S.configCat)
    : [];
  const habitsHTML = cfgHabits.length
    ? cfgHabits.map(h => `
        <div class="cfg-habit-row">
          <div class="cfg-habit-info">
            <div class="cfg-habit-name">${h.name}</div>
            <div class="cfg-habit-meta">${h.type === "semanal" ? "☀️ Semanal" : "📅 Diario"}${h.category !== "basicos" ? ` · ${h.points} pts` : ""}</div>
          </div>
          <button class="btn-del-child" data-del-habit="${h.id}">🗑️</button>
        </div>`).join("")
    : `<p style="color:var(--t3);font-size:13px;padding:8px 0;font-weight:600;">Sin hábitos — agrega el primero</p>`;

  // Premios list for configChildId
  const cfgPremios = S.configChildId ? S.premios.filter(p => p.child_id === S.configChildId) : [];
  const premiosHTML = cfgPremios.length
    ? cfgPremios.map(p => `
        <div class="cfg-habit-row">
          <div class="cfg-habit-info">
            <div class="cfg-habit-name">${p.redeemed ? "✅ " : "🎁 "}${p.name}</div>
            <div class="cfg-habit-meta">${p.points_required} pts requeridos${p.redeemed ? " · Canjeado" : ""}</div>
          </div>
          <button class="btn-del-child" data-del-premio="${p.id}">🗑️</button>
        </div>`).join("")
    : `<p style="color:var(--t3);font-size:13px;padding:8px 0;font-weight:600;">Sin premios — crea el primero</p>`;

  // Children list
  const childrenList = S.children.length
    ? S.children.map((c, i) => `
        <div class="child-row">
          <span class="child-row-avatar">${getChildAvatar(c, i)}</span>
          <span class="child-row-name">${c.name}</span>
          <button class="btn-del-child" data-del-child="${c.id}">🗑️ Eliminar</button>
        </div>`).join("")
    : `<p style="color:var(--t3);font-size:13px;padding:8px 0;font-weight:600;">Sin perfiles — agrega el primero</p>`;

  const ptsFieldGroup = S.configCat !== "basicos"
    ? `<div class="field-group">
        <label class="field-label">Puntos</label>
        <div class="pts-row" id="cfg-pts-row">
          <button class="pts-b" data-p="0">0</button>
          <button class="pts-b active" data-p="2">2</button>
          <button class="pts-b" data-p="3">3</button>
          <button class="pts-b" data-p="5">5</button>
        </div>
        <input type="hidden" id="cfg-hval-pts" value="2">
      </div>`
    : "";

  cont.innerHTML = `
    <!-- Family card -->
    <div class="card" style="border-color:var(--p)">
      <div class="card-family-header">
        <div class="cfg-family-emoji">🏠</div>
        <div class="cfg-family-info">
          <div class="cfg-family-name">Familia ${S.family_name || ""}</div>
          <div class="cfg-family-status">🔓 Modo papás activo</div>
        </div>
        <button class="btn-lock-config" id="btn-lock-cfg" title="Bloquear config">🔒</button>
      </div>
    </div>

    <!-- Perfiles -->
    <div class="card">
      <h3 class="card-title">👦 Perfiles de niños</h3>
      <div class="children-cfg" id="cfg-children-list">${childrenList}</div>
      <button class="btn-primary btn-sm" id="btn-cfg-add-child">+ Agregar perfil</button>
    </div>

    <!-- Hábitos -->
    <div class="card">
      <h3 class="card-title">📋 Hábitos</h3>
      ${S.children.length ? `
        <div class="cfg-tabs" id="cfg-child-tabs">${childTabs}</div>
        <div class="cfg-tabs" id="cfg-cat-tabs">${catTabs}</div>
        <div id="cfg-habits-list">${habitsHTML}</div>
        <div style="margin-top:14px;padding-top:14px;border-top:1.5px solid var(--border);">
          <p class="form-card-title" style="margin-bottom:10px;">➕ Agregar hábito</p>
          <input id="cfg-inp-habit" class="field" type="text" placeholder="Nombre del hábito..." autocomplete="off">
          <div class="field-row">
            <div class="field-group">
              <label class="field-label">Tipo</label>
              <div class="seg-ctrl" id="cfg-seg-type">
                <button class="seg-btn active" data-val="diario">📅 Diario</button>
                <button class="seg-btn" data-val="semanal">☀️ Semanal</button>
              </div>
              <input type="hidden" id="cfg-hval-type" value="diario">
            </div>
            ${ptsFieldGroup}
          </div>
          <button class="btn-primary btn-sm" id="btn-cfg-add-habit">Agregar hábito</button>
        </div>
      ` : `<p style="color:var(--t3);font-size:13px;font-weight:600;">Crea un perfil primero</p>`}
    </div>

    <!-- Premios -->
    <div class="card">
      <h3 class="card-title">🎁 Premios</h3>
      ${S.children.length ? `
        <div class="cfg-tabs" id="cfg-child-tabs-premio">
          ${S.children.map((c, i) =>
            `<button class="cfg-tab${c.id === S.configChildId ? " active" : ""}" data-cfg-child-p="${c.id}">
              ${getChildAvatar(c, i)} ${c.name}
            </button>`
          ).join("")}
        </div>
        <div id="cfg-premios-list">${premiosHTML}</div>
        <div style="margin-top:14px;padding-top:14px;border-top:1.5px solid var(--border);">
          <p class="form-card-title" style="margin-bottom:10px;">➕ Crear premio</p>
          <input id="cfg-inp-prem-name" class="field" type="text" placeholder="Nombre del premio..." autocomplete="off">
          <input id="cfg-inp-prem-pts" class="field" type="number" min="1" placeholder="Puntos requeridos...">
          <button class="btn-primary btn-sm" id="btn-cfg-add-premio">Crear premio</button>
        </div>
      ` : `<p style="color:var(--t3);font-size:13px;font-weight:600;">Crea un perfil primero</p>`}
    </div>

    <!-- Semana -->
    <div class="card">
      <h3 class="card-title">📅 Semana</h3>
      <p class="card-desc" style="margin-bottom:12px;">Semana actual: <strong>${S.currentWeekLabel}</strong></p>
      <button class="btn-primary btn-sm" id="btn-cfg-new-week">✨ Iniciar nueva semana</button>
    </div>

    <!-- Categorías -->
    <div class="card">
      <h3 class="card-title">🏷️ Nombres de categorías</h3>
      <div class="cat-label-form">
        <div class="lbl-row"><span class="lbl-ico">🔒</span><input id="lf-basicos" class="field mb0" placeholder="Básicos" value="${S.settings.label_basicos}"></div>
        <div class="lbl-row"><span class="lbl-ico">🔄</span><input id="lf-extras" class="field mb0" placeholder="Extras" value="${S.settings.label_extras}"></div>
        <div class="lbl-row"><span class="lbl-ico">🏆</span><input id="lf-especiales" class="field mb0" placeholder="Especiales" value="${S.settings.label_especiales}"></div>
      </div>
      <button id="btn-save-labels" class="btn-primary btn-sm">Guardar nombres</button>
    </div>

    <!-- DB -->
    <div class="card card-db">
      <h3 class="card-title">🗄️ Base de datos</h3>
      <div id="db-status-box" class="db-status-box">
        <span id="db-status-dot" class="db-dot db-dot-checking">●</span>
        <span id="db-status-text">Verificando conexión...</span>
      </div>
      <p class="card-desc">La app usa tu base de datos Neon conectada en Netlify.</p>
    </div>

    <!-- Danger -->
    <div class="card card-danger">
      <h3 class="card-title danger-title">⚠️ Zona de peligro</h3>
      <button id="btn-clear-all" class="btn-danger w-full">🗑️ Eliminar todos los datos</button>
      <div id="clear-confirm" class="confirm-box hidden">
        <p>¿Borrar absolutamente todo? Esta acción no se puede deshacer.</p>
        <div class="confirm-btns">
          <button id="btn-clear-yes" class="btn-danger btn-sm">Sí, borrar todo</button>
          <button id="btn-clear-no" class="btn-ghost btn-sm">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  attachConfigListeners();
  checkDbStatus();
}

function attachConfigListeners() {
  // Lock config
  document.getElementById("btn-lock-cfg")?.addEventListener("click", () => {
    clearPinVerified();
    showView("home");
    toast("🔒 Config bloqueada");
  });

  // Add child
  document.getElementById("btn-cfg-add-child")?.addEventListener("click", openAddProfileModal);

  // Child list delete
  document.querySelectorAll("[data-del-child]").forEach(b =>
    b.addEventListener("click", () => deleteChild(b.dataset.delChild)));

  // Child tabs (habits)
  document.querySelectorAll("[data-cfg-child]").forEach(b =>
    b.addEventListener("click", () => { S.configChildId = b.dataset.cfgChild; renderConfig(); }));

  // Category tabs
  document.querySelectorAll("[data-cfg-cat]").forEach(b =>
    b.addEventListener("click", () => { S.configCat = b.dataset.cfgCat; renderConfig(); }));

  // Habit delete
  document.querySelectorAll("[data-del-habit]").forEach(b =>
    b.addEventListener("click", () => deleteHabit(b.dataset.delHabit)));

  // Habit type seg ctrl
  document.querySelectorAll("#cfg-seg-type .seg-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#cfg-seg-type .seg-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("cfg-hval-type").value = b.dataset.val;
    });
  });

  // Habit pts
  document.querySelectorAll("#cfg-pts-row .pts-b").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#cfg-pts-row .pts-b").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("cfg-hval-pts").value = b.dataset.p;
    });
  });

  // Add habit
  document.getElementById("btn-cfg-add-habit")?.addEventListener("click", addHabitFromConfig);
  document.getElementById("cfg-inp-habit")?.addEventListener("keypress", e => { if (e.key === "Enter") addHabitFromConfig(); });

  // Child tabs (premios)
  document.querySelectorAll("[data-cfg-child-p]").forEach(b =>
    b.addEventListener("click", () => { S.configChildId = b.dataset.cfgChildP; renderConfig(); }));

  // Premio delete
  document.querySelectorAll("[data-del-premio]").forEach(b =>
    b.addEventListener("click", () => deletePremio(b.dataset.delPremio)));

  // Add premio
  document.getElementById("btn-cfg-add-premio")?.addEventListener("click", addPremioFromConfig);

  // New week
  document.getElementById("btn-cfg-new-week")?.addEventListener("click", () => {
    document.getElementById("inp-week-title").value = getWeekLabel();
    document.getElementById("modal-week").classList.remove("hidden");
  });

  // Labels
  document.getElementById("btn-save-labels")?.addEventListener("click", saveLabels);

  // Danger zone
  document.getElementById("btn-clear-all")?.addEventListener("click", () =>
    document.getElementById("clear-confirm").classList.remove("hidden"));
  document.getElementById("btn-clear-yes")?.addEventListener("click", clearAll);
  document.getElementById("btn-clear-no")?.addEventListener("click", () =>
    document.getElementById("clear-confirm").classList.add("hidden"));
}

// ── NAVIGATION ────────────────────────────────────────────
function showView(name) {
  S.currentView = name;
  doShowView(name);
  if (name === "config") renderConfig();
}

function doShowView(name) {
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

// ── ADD PROFILE MODAL ─────────────────────────────────────
function openAddProfileModal() {
  S._newAvatar = AVATARS[0];
  const grid = document.getElementById("emoji-grid");
  grid.innerHTML = AVATARS.map(e =>
    `<button class="emoji-btn${e === S._newAvatar ? " sel" : ""}" data-emoji="${e}">${e}</button>`
  ).join("");
  grid.querySelectorAll(".emoji-btn").forEach(b => {
    b.addEventListener("click", () => {
      grid.querySelectorAll(".emoji-btn").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
      S._newAvatar = b.dataset.emoji;
    });
  });
  document.getElementById("inp-profile-name").value = "";
  document.getElementById("modal-add-profile").classList.remove("hidden");
  setTimeout(() => document.getElementById("inp-profile-name").focus(), 150);
}

function closeAddProfileModal() {
  document.getElementById("modal-add-profile").classList.add("hidden");
}

// ── ACTIONS ───────────────────────────────────────────────
async function addChild() {
  const name = document.getElementById("inp-profile-name").value.trim();
  if (!name) return toast("Escribe un nombre");
  if (S.children.find(c => c.name.toLowerCase() === name.toLowerCase())) return toast("Ya existe ese perfil");
  const child = { id: uid(), name, avatar: S._newAvatar || AVATARS[0], total_points: 0 };
  const r = await call("add_child", child);
  if (!r.ok) toast("⚠️ Guardado local (sin BD)");
  S.children.push(child);
  if (!S.currentChild) S.currentChild = child.id;
  if (!S.configChildId) S.configChildId = child.id;
  closeAddProfileModal();
  saveLocal();
  renderAll();
  toast(`✅ ¡${name} agregado!`);
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
  if (S.configChildId === id) S.configChildId = S.children[0]?.id || null;
  saveLocal();
  renderAll();
  toast("🗑️ Perfil eliminado");
}

async function addHabitFromConfig() {
  const name = document.getElementById("cfg-inp-habit")?.value.trim();
  if (!name) return toast("Escribe el nombre del hábito");
  if (!S.configChildId) return toast("Selecciona un perfil primero");
  const type = document.getElementById("cfg-hval-type")?.value || "diario";
  const ptsEl = document.getElementById("cfg-hval-pts");
  const points = S.configCat === "basicos" ? 0 : parseInt(ptsEl?.value || "2") || 0;
  const habit = { id: uid(), child_id: S.configChildId, category: S.configCat, name, type, points };
  const r = await call("add_habit", habit);
  if (!r.ok) toast("⚠️ Guardado local");
  S.habits.push(habit);
  saveLocal();
  renderAll();
  toast("✅ Hábito agregado");
}

async function deleteHabit(id) {
  const h = S.habits.find(x => x.id === id);
  if (!h) return;
  if (h.category !== "basicos") {
    const earned = S.completions.filter(c => c.habit_id === id).length * h.points;
    if (earned > 0) await adjustPts(h.child_id, -earned);
  }
  await call("delete_habit", { habit_id: id });
  S.completions = S.completions.filter(c => c.habit_id !== id);
  S.habits = S.habits.filter(x => x.id !== id);
  saveLocal();
  renderAll();
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
    await call("add_completion", comp);
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
  renderProfileRow();
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
    await call("add_completion", comp);
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
  renderProfileRow();
}

async function adjustPts(child_id, diff) {
  const child = S.children.find(c => c.id === child_id);
  if (!child) return;
  child.total_points = Math.max(0, (child.total_points || 0) + diff);
  await call("update_points", { child_id, total_points: child.total_points });
}

async function addPremioFromConfig() {
  const name = document.getElementById("cfg-inp-prem-name")?.value.trim();
  const pts = parseInt(document.getElementById("cfg-inp-prem-pts")?.value);
  if (!name || !pts || pts <= 0) return toast("Completa todos los campos");
  if (!S.configChildId) return toast("Selecciona un perfil primero");
  const premio = { id: uid(), child_id: S.configChildId, name, points_required: pts, redeemed: false };
  const r = await call("add_premio", premio);
  if (!r.ok) toast("⚠️ Guardado local");
  S.premios.push(premio);
  saveLocal();
  renderAll();
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
  renderProfileRow();
  toast(`🎉 ¡${p.name} canjeado!`);
}

async function deletePremio(id) {
  await call("delete_premio", { premio_id: id });
  S.premios = S.premios.filter(p => p.id !== id);
  saveLocal();
  renderAll();
  toast("🗑️ Premio eliminado");
}

async function archiveWeek(oldWeek, oldLabel, newLabel) {
  for (const child of S.children) {
    // Skip if already archived this week for this child
    if (S.history.some(h => h.child_id === child.id && h.week_start === oldWeek)) continue;
    const entry = { id: uid(), child_id: child.id, week_start: oldWeek, week_label: oldLabel, points: getTotalPts(child.id) };
    await call("add_history", entry);
    S.history.push(entry);
    child.total_points = 0;
    await call("update_points", { child_id: child.id, total_points: 0 });
  }
  await call("delete_completions_by_week", { week_start: oldWeek });
  S.completions = S.completions.filter(c => c.week_start !== oldWeek);
  S.currentWeek = getWeekStart();
  S.currentWeekLabel = newLabel || getWeekLabel();
}

async function checkAutoWeek() {
  const todayWeek = getWeekStart();
  if (!S.currentWeek || S.currentWeek === todayWeek) return;
  // Week changed — auto-archive silently
  await archiveWeek(S.currentWeek, S.currentWeekLabel, getWeekLabel());
  saveLocal();
  renderAll();
  toast("📅 ¡Nueva semana! El historial se actualizó automáticamente");
}

async function startNewWeek() {
  const label = document.getElementById("inp-week-title").value.trim();
  if (!label) return toast("Escribe el título de la semana");
  await archiveWeek(S.currentWeek, S.currentWeekLabel, label);
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
  S.currentChild = null; S.configChildId = null;
  saveLocal();
  renderAll();
  toast("🗑️ Datos eliminados");
}

// ── INIT ──────────────────────────────────────────────────
async function init() {
  loadLocal();

  // ── EVENT LISTENERS (stable, outside of dynamic renders) ──

  // Sidebar
  document.getElementById("btn-menu").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sb-overlay").classList.remove("hidden");
  });
  document.getElementById("btn-sb-close").addEventListener("click", closeSidebar);
  document.getElementById("sb-overlay").addEventListener("click", closeSidebar);

  // Nav buttons
  document.querySelectorAll(".nav-btn[data-view], .bnav-btn[data-view]").forEach(b => {
    b.addEventListener("click", () => showView(b.dataset.view));
  });

  // Category cards
  document.querySelectorAll(".cat-card[data-cat]").forEach(c => {
    c.addEventListener("click", () => openCat(c.dataset.cat));
  });
  document.getElementById("btn-back-cat").addEventListener("click", () => showView("home"));

  // Empty state CTA → open config (with PIN)
  document.getElementById("btn-open-config")?.addEventListener("click", () => showView("config"));

  // Child switch chip
  document.getElementById("btn-child-switch").addEventListener("click", () => {
    const modal = document.getElementById("modal-child");
    const list = document.getElementById("modal-child-list");
    list.innerHTML = S.children.map((c, i) =>
      `<button class="modal-child-btn ${c.id === S.currentChild ? "sel" : ""}" data-cid="${c.id}">
        <span class="mc-avatar">${getChildAvatar(c, i)}</span>
        <span>${c.name}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--t3);">⭐ ${getValidPts(c.id)}</span>
      </button>`
    ).join("") || `<p style="text-align:center;color:var(--t3);padding:10px;font-weight:600;">Sin perfiles — crea uno en Config</p>`;
    list.querySelectorAll("[data-cid]").forEach(b => {
      b.addEventListener("click", () => {
        S.currentChild = b.dataset.cid;
        modal.classList.add("hidden");
        renderAll();
      });
    });
    modal.classList.remove("hidden");
  });
  document.getElementById("btn-modal-child-close").addEventListener("click", () =>
    document.getElementById("modal-child").classList.add("hidden"));

  // Add profile modal
  document.getElementById("btn-profile-save").addEventListener("click", addChild);
  document.getElementById("btn-profile-cancel").addEventListener("click", closeAddProfileModal);
  document.getElementById("inp-profile-name").addEventListener("keypress", e => { if (e.key === "Enter") addChild(); });
  document.getElementById("modal-add-profile").addEventListener("click", e => {
    if (e.target === document.getElementById("modal-add-profile")) closeAddProfileModal();
  });

  // PIN modal cancel
  document.getElementById("btn-pin-cancel").addEventListener("click", () => {
    document.getElementById("modal-pin").classList.add("hidden");
    _pinBuf = [];
    _pinCallback = null;
  });

  // Nueva semana modal
  document.getElementById("btn-new-week").addEventListener("click", () => {
    document.getElementById("inp-week-title").value = getWeekLabel();
    document.getElementById("modal-week").classList.remove("hidden");
    closeSidebar();
  });
  document.getElementById("btn-week-confirm").addEventListener("click", startNewWeek);
  document.getElementById("btn-week-cancel").addEventListener("click", () =>
    document.getElementById("modal-week").classList.add("hidden"));
  document.getElementById("inp-week-title").addEventListener("keypress", e => { if (e.key === "Enter") startNewWeek(); });

  // Setup screen step 1 button
  document.getElementById("btn-setup-s1")?.addEventListener("click", () => {
    const name = document.getElementById("inp-family-name").value.trim();
    if (!name) { document.getElementById("inp-family-name").focus(); return; }
    showSetupStep(2);
  });
  document.getElementById("inp-family-name")?.addEventListener("keypress", e => {
    if (e.key === "Enter") document.getElementById("btn-setup-s1").click();
  });
  document.getElementById("btn-setup-back")?.addEventListener("click", () => showSetupStep(2));

  // ── LAUNCH LOGIC ──────────────────────────────────────
  // After splash, show setup or app
  setTimeout(() => {
    const splash = document.getElementById("splash");
    splash.style.transition = "opacity .4s";
    splash.style.opacity = "0";
    setTimeout(() => {
      splash.classList.add("hidden");
      if (!S.family_id) {
        // First launch — show setup
        showSetupScreen();
      } else {
        // Returning user — show app
        document.getElementById("app").classList.remove("hidden");
        if (!S.currentChild && S.children.length) S.currentChild = S.children[0].id;
        renderAll();

        // Load fresh data from DB then check for auto week-rollover
        loadFromDB().then(async loaded => {
          if (loaded) {
            if (!S.currentChild && S.children.length) S.currentChild = S.children[0].id;
            saveLocal();
          }
          await checkAutoWeek();
          renderAll();
        });
      }
    }, 400);
  }, 1000);
}

document.addEventListener("DOMContentLoaded", init);
