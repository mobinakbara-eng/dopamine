(() => {
  "use strict";

  const CONFIG = Object.freeze({
    supabaseUrl: "https://xqgkawskftzurbujrpex.supabase.co",
    publishableKey: "sb_publishable_DA_L16_qVM9opFpQcYz16g_kTBwFpKZ",
    workspaceSlug: "aora-demo",
    timezone: "Europe/Berlin",
    refreshMs: 15000
  });

  const ICONS = {
    overview: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    schedule: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M7 3v4M17 3v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    team: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 11a3 3 0 1 0 0-6M21 20v-2a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    time: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    leave: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 3v18M5 5h11l-2 4 2 4H5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    news: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    device: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M10 18h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    logout: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronLeft: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronRight: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };

  const app = document.getElementById("app");
  const toastRoot = document.getElementById("toast-root");

  const store = {
    role: routeRole() || "admin",
    directory: null,
    session: null,
    state: null,
    revision: 0,
    view: "overview",
    employeeView: "today",
    weekStart: startOfWeek(new Date()),
    selectedEmployeeId: null,
    loading: true,
    connection: navigator.onLine,
    refreshTimer: null
  };

  function routeRole() {
    const match = location.pathname.match(/^\/(admin|employee|kiosk)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#096;");
  }

  function brand() {
    return `<span class="brand"><span class="brand-mark">A</span><span class="brand-copy"><span class="brand-word">aora</span><span class="brand-sub">Workforce</span></span></span>`;
  }

  function fmtDate(value, options = {}) {
    if (!value) return "–";
    const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: CONFIG.timezone,
      day: "2-digit",
      month: options.long ? "long" : "2-digit",
      year: options.year === false ? undefined : "numeric",
      weekday: options.weekday ? "short" : undefined
    }).format(date);
  }

  function isoDate(date) {
    const copy = new Date(date);
    copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
    return copy.toISOString().slice(0, 10);
  }

  function startOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(12, 0, 0, 0);
    return isoDate(d);
  }

  function addDays(dateString, days) {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  }

  function minutesBetween(start, end, breakMinutes = 0) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let value = eh * 60 + em - sh * 60 - sm;
    if (value < 0) value += 1440;
    return Math.max(0, value - Number(breakMinutes || 0));
  }

  function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(Number(minutes || 0)));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} h`;
  }

  function currentBerlin() {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: CONFIG.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    }).formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }

  function employeeById(id) {
    return store.state?.employees?.find(item => item.id === id) || store.directory?.employees?.find(item => item.id === id);
  }

  function locationById(id) {
    return store.state?.locations?.find(item => item.id === id) || store.directory?.locations?.find(item => item.id === id);
  }

  function liveEntry(employeeId) {
    return store.state?.timeEntries?.find(entry => entry.employeeId === employeeId && ["live", "paused"].includes(entry.status));
  }

  function initials(name) {
    return String(name || "AO").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  }

  function statusPill(status) {
    const map = {
      published: ["Veröffentlicht", "success"], draft: ["Entwurf", "warning"], pending: ["Offen", "warning"],
      approved: ["Genehmigt", "success"], rejected: ["Abgelehnt", "danger"], live: ["Eingestempelt", "success"],
      paused: ["Pause", "warning"], complete: ["Abgeschlossen", ""]
    };
    const [label, tone] = map[status] || [status || "–", ""];
    return `<span class="pill ${tone}">${esc(label)}</span>`;
  }

  async function api(path, options = {}) {
    const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
      ...options,
      headers: {
        apikey: CONFIG.publishableKey,
        Authorization: options.authToken ? `Bearer ${options.authToken}` : `Bearer ${CONFIG.publishableKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text || "Ungültige Serverantwort" }; }
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function rpc(name, body) {
    const payload = await api(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    if (Array.isArray(payload) && payload.length === 1) return payload[0]?.[name] ?? payload[0];
    return payload;
  }

  async function loadDirectory() {
    const directory = await rpc("demo_directory", { p_workspace_slug: CONFIG.workspaceSlug });
    store.directory = directory?.demo_directory || directory;
    return store.directory;
  }

  function sessionKey(role = store.role) { return `aora:session:${role}`; }
  function readSession(role = store.role) {
    try { return JSON.parse(sessionStorage.getItem(sessionKey(role)) || "null"); } catch { return null; }
  }
  function saveSession(session) { sessionStorage.setItem(sessionKey(session.role), JSON.stringify(session)); }

  async function login(role, subjectId, pin) {
    const session = await rpc("demo_login", {
      p_workspace_slug: CONFIG.workspaceSlug,
      p_role: role,
      p_subject_id: subjectId,
      p_pin: pin || null
    });
    store.role = role;
    store.session = session;
    saveSession(session);
    history.replaceState({}, "", `/${role}`);
    await loadWorkspace();
    configureRefresh();
  }

  async function logout() {
    const token = store.session?.token;
    try { if (token) await rpc("demo_logout", { p_token: token }); } catch {}
    sessionStorage.removeItem(sessionKey(store.role));
    store.session = null;
    store.state = null;
    clearInterval(store.refreshTimer);
    renderLogin();
  }

  async function workspace(body) {
    return api("/functions/v1/workspace", { method: "POST", body: JSON.stringify({ ...body, token: store.session?.token }) });
  }

  async function loadWorkspace({ quiet = false } = {}) {
    if (!quiet) { store.loading = true; renderLoading(); }
    try {
      const payload = await workspace({ action: "load" });
      store.state = payload.state;
      store.revision = payload.revision;
      store.session = { ...store.session, ...payload.session, token: store.session.token };
      saveSession(store.session);
      store.loading = false;
      renderProduct();
    } catch (error) {
      store.loading = false;
      if (error.status === 401) {
        sessionStorage.removeItem(sessionKey(store.role));
        store.session = null;
        toast("Sitzung abgelaufen. Bitte erneut anmelden.", "error");
        renderLogin();
      } else {
        toast(error.message, "error");
        if (!quiet) renderError(error.message);
      }
    }
  }

  async function applyEvent(event) {
    setBusy(true);
    try {
      const payload = await workspace({ action: "apply", event, expectedRevision: store.revision });
      store.state = payload.state;
      store.revision = payload.revision;
      renderProduct();
      toast("Änderung gespeichert.");
      return payload;
    } catch (error) {
      if (error.status === 409 || error.payload?.conflict) {
        toast("Daten wurden parallel geändert. Ansicht wird aktualisiert.", "error");
        await loadWorkspace({ quiet: true });
      } else toast(error.message, "error");
      throw error;
    } finally { setBusy(false); }
  }

  function configureRefresh() {
    clearInterval(store.refreshTimer);
    const interval = store.role === "kiosk" ? CONFIG.refreshMs : CONFIG.refreshMs * 4;
    store.refreshTimer = setInterval(() => {
      if (!document.hidden && store.session && navigator.onLine) loadWorkspace({ quiet: true });
    }, interval);
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function setBusy(busy) {
    document.querySelectorAll("[data-busy-sensitive]").forEach(button => { button.disabled = busy; });
  }

  function renderLoading() {
    app.innerHTML = `<main class="login-layout"><section class="login-visual">${brand()}<div class="login-copy"><div class="eyebrow">Aora Workforce</div><h1>Ein System.<br>Alle im Takt.</h1><p>Arbeitsbereich wird sicher geladen.</p></div><div class="feature-strip"><span>Dienstplan</span><span>Zeiterfassung</span><span>Urlaub</span></div></section><section class="login-panel"><div class="login-card"><div class="skeleton"></div><div style="height:12px"></div><div class="skeleton"></div></div></section></main>`;
  }

  function renderError(message) {
    app.innerHTML = `<main class="login-layout"><section class="login-visual">${brand()}<div class="login-copy"><div class="eyebrow">Verbindungsfehler</div><h1>Aora ist gerade nicht erreichbar.</h1><p>${esc(message)}</p></div><span></span></section><section class="login-panel"><div class="login-card"><button class="btn" data-action="retry">Erneut versuchen</button><button class="btn ghost" style="margin-left:8px" data-action="logout">Neu anmelden</button></div></section></main>`;
  }

  function renderLogin() {
    const role = store.role;
    const directory = store.directory || { admins: [], employees: [], kioskDevices: [], locations: [] };
    const subjects = role === "admin" ? directory.admins : role === "employee" ? directory.employees : directory.kioskDevices;
    const pinHint = role === "admin" ? "Testzugang: Administrator · PIN 583104" : role === "employee" ? "Testzugang: Amir Hassan · PIN 731926" : "Kiosk Tacheles · Aktivierungscode AORA-642915";
    app.innerHTML = `<main class="login-layout">
      <section class="login-visual">${brand()}<div class="login-copy"><div class="eyebrow">Workforce OS</div><h1>Arbeit läuft besser, wenn alles zusammenläuft.</h1><p>Dienstplanung, Zeiterfassung, Urlaub und Kommunikation für Mitarbeiter, Führungskräfte und Kiosk – in einem gemeinsamen Arbeitsbereich.</p></div><div class="feature-strip"><span>Web-based</span><span>Berlin timezone</span><span>Live synchronisiert</span><span>Rollenbasiert</span></div></section>
      <section class="login-panel"><div class="login-card"><div class="eyebrow">Aora Café · Staging</div><h2 style="margin:8px 0 8px">Arbeitsbereich öffnen</h2><p class="muted">Wähle deinen geschützten Bereich und melde dich an.</p>
        <div class="role-tabs" role="tablist">${["admin","employee","kiosk"].map(item => `<button class="role-tab ${role === item ? "active" : ""}" type="button" data-action="select-role" data-role="${item}">${item === "admin" ? "Arbeitgeber" : item === "employee" ? "Mitarbeiter" : "Kiosk"}</button>`).join("")}</div>
        <form id="login-form"><div class="field"><label for="subject">Zugang</label><select class="select" id="subject" name="subject" required>${subjects.map(subject => { const location = locationById(subject.locationId); return `<option value="${attr(subject.id)}">${esc(subject.name || subject.display_name || subject.id)}${location ? ` · ${esc(location.name)}` : ""}</option>`; }).join("")}</select></div>
        <div class="field" style="margin-top:14px"><label for="pin">${role === "kiosk" ? "Aktivierungscode" : "PIN"}</label><input class="input" id="pin" name="pin" type="password" autocomplete="current-password" required></div>
        <div class="demo-hint"><strong>Demo:</strong> ${esc(pinHint)}<br><span class="muted">Die Sitzung wird nur in diesem Browser-Tab gespeichert.</span></div><div class="login-actions"><span class="connection ${store.connection ? "" : "offline"}">${store.connection ? "Supabase verbunden" : "Offline"}</span><button class="btn" type="submit" data-busy-sensitive>Weiter</button></div></form>
      </div></section></main>`;
    document.getElementById("login-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setBusy(true);
      try { await login(store.role, String(data.get("subject") || ""), String(data.get("pin") || "")); }
      catch (error) { toast(error.message, "error"); }
      finally { setBusy(false); }
    });
  }

  function renderProduct() {
    if (!store.state || !store.session) return renderLogin();
    if (store.role === "admin") renderAdmin();
    else if (store.role === "employee") renderEmployee();
    else renderKiosk();
  }

  const ADMIN_VIEWS = [["overview","Übersicht","overview"],["schedule","Dienstplan","schedule"],["team","Team","team"],["time","Zeiten","time"],["leave","Urlaub","leave"],["news","Kommunikation","news"],["devices","Geräte","device"]];
  function adminNav() { return ADMIN_VIEWS.map(([id,label,icon]) => `<button class="nav-btn ${store.view === id ? "active" : ""}" data-action="admin-view" data-view="${id}">${ICONS[icon]}<span>${label}</span></button>`).join(""); }

  function renderAdmin() {
    const user = store.state.admins?.find(item => item.id === store.session.adminId) || store.state.admins?.[0] || { name: "Administration", initials: "AO" };
    app.innerHTML = `<div class="dashboard-shell"><aside class="sidebar" id="sidebar">${brand()}<div class="eyebrow" style="padding:0 14px;color:#666">Workspace</div><nav class="nav">${adminNav()}</nav><div class="sidebar-footer"><div class="user-chip"><span class="avatar">${esc(user.initials || initials(user.name))}</span><span class="person-copy"><strong>${esc(user.name)}</strong><span class="brand-sub">Administrator</span></span></div><button class="nav-btn" style="width:100%" data-action="logout">${ICONS.logout}<span>Abmelden</span></button></div></aside><main class="main"><header class="topbar"><div class="topbar-left"><button class="icon-btn mobile-menu" data-action="toggle-sidebar">${ICONS.menu}</button><span class="connection ${store.connection ? "" : "offline"}">${store.connection ? "Live" : "Offline"}</span></div><div class="small muted">Revision ${esc(store.revision)} · ${esc(store.state.company?.name || "Aora")}</div></header><div class="content">${renderAdminView()}</div></main><nav class="mobile-bottom-nav">${ADMIN_VIEWS.slice(0,5).map(([id,label,icon]) => `<button class="${store.view === id ? "active" : ""}" data-action="admin-view" data-view="${id}">${ICONS[icon]}<span>${label}</span></button>`).join("")}</nav></div>`;
  }

  function renderAdminView() {
    if (store.view === "schedule") return scheduleView();
    if (store.view === "team") return teamView();
    if (store.view === "time") return timeView();
    if (store.view === "leave") return leaveView();
    if (store.view === "news") return newsView();
    if (store.view === "devices") return devicesView();
    return overviewView();
  }

  function shiftListRow(shift) {
    const employee = employeeById(shift.employeeId);
    const location = locationById(shift.locationId);
    return `<div class="list-row"><div class="person"><span class="avatar">${esc(employee?.initials || initials(employee?.name))}</span><span class="person-copy"><strong>${esc(employee?.name || "Mitarbeiter")}</strong><span class="small muted" style="display:block">${esc(shift.start)}–${esc(shift.end)} · ${esc(location?.name || "")}</span></span></div>${statusPill(shift.status)}</div>`;
  }

  function overviewView() {
    const today = currentBerlin().date;
    const activeEmployees = store.state.employees.filter(item => item.active);
    const live = store.state.timeEntries.filter(item => ["live","paused"].includes(item.status));
    const pendingLeave = store.state.leaveRequests.filter(item => item.status === "pending");
    const weekEnd = addDays(store.weekStart, 6);
    const weekShifts = store.state.shifts.filter(item => item.date >= store.weekStart && item.date <= weekEnd);
    const plannedMinutes = weekShifts.reduce((sum, item) => sum + minutesBetween(item.start, item.end, item.breakMinutes), 0);
    const todayShifts = store.state.shifts.filter(item => item.date === today).sort((a,b) => a.start.localeCompare(b.start));
    return `<section><div class="page-heading"><div><div class="eyebrow">${fmtDate(today,{weekday:true,long:true})}</div><h1>Guten Tag.</h1><p class="muted">Hier ist der aktuelle Stand im Aora-Arbeitsbereich.</p></div><div class="page-actions"><button class="btn secondary" data-action="refresh">Aktualisieren</button><button class="btn" data-action="open-add-shift">${ICONS.plus} Schicht</button></div></div>
      <div class="metric-grid"><div class="metric"><span class="metric-label">Aktive Mitarbeiter</span><strong class="metric-value">${activeEmployees.length}</strong><span class="small muted">${store.state.locations.filter(item=>item.active).length} Standorte</span></div><div class="metric"><span class="metric-label">Gerade im Dienst</span><strong class="metric-value">${live.filter(item=>item.status==="live").length}</strong><span class="small muted">${live.filter(item=>item.status==="paused").length} in Pause</span></div><div class="metric"><span class="metric-label">Offene Urlaubsanträge</span><strong class="metric-value">${pendingLeave.length}</strong><span class="small muted">Entscheidung erforderlich</span></div><div class="metric"><span class="metric-label">Geplant diese Woche</span><strong class="metric-value">${Math.round(plannedMinutes/60)}</strong><span class="small muted">Arbeitsstunden</span></div></div>
      <div class="dashboard-grid"><article class="card"><div class="card-header"><div><div class="eyebrow">Heute</div><h2>Dienstplan</h2></div><button class="btn ghost compact" data-action="admin-view" data-view="schedule">Alle anzeigen</button></div><div class="list">${todayShifts.length ? todayShifts.map(shiftListRow).join("") : `<div class="empty">Für heute sind keine Schichten geplant.</div>`}</div></article><article class="card black"><div class="card-header"><div><div class="eyebrow" style="color:#888">Live</div><h2>Zeiterfassung</h2></div><span class="pill dark">${live.length}</span></div><div class="list">${live.length ? live.map(entry => { const employee = employeeById(entry.employeeId); return `<div class="list-row" style="border-color:#2f2f2f"><div class="person"><span class="avatar">${esc(employee?.initials || initials(employee?.name))}</span><span class="person-copy"><strong>${esc(employee?.name || "Mitarbeiter")}</strong><span class="small" style="display:block;color:#999">${esc(entry.start)} · ${entry.status === "paused" ? "Pause" : "Aktiv"}</span></span></div>${statusPill(entry.status)}</div>`; }).join("") : `<div class="empty" style="border-color:#333;color:#999">Niemand ist aktuell eingestempelt.</div>`}</div></article></div>
      <div class="split-grid" style="margin-top:16px"><article class="card"><div class="card-header"><div><div class="eyebrow">Anträge</div><h2>Urlaub</h2></div></div><div class="list">${pendingLeave.slice(0,4).map(item => leaveRow(item,true)).join("") || `<div class="empty">Keine offenen Anträge.</div>`}</div></article><article class="card"><div class="card-header"><div><div class="eyebrow">Aktivität</div><h2>Letzte Änderungen</h2></div></div><div class="timeline">${store.state.audit.slice(0,5).map(item => `<div class="timeline-item"><strong>${esc(item.actor || "System")}</strong><div class="small muted">${esc(item.detail || item.action)} · ${new Date(item.createdAt).toLocaleString("de-DE")}</div></div>`).join("") || `<div class="empty">Noch keine Aktivität.</div>`}</div></article></div></section>`;
  }

  function scheduleView() {
    const days = Array.from({length:7}, (_,i) => addDays(store.weekStart,i));
    const employees = store.state.employees.filter(item => item.active);
    const end = days[6];
    const drafts = store.state.shifts.filter(item => item.date >= store.weekStart && item.date <= end && item.status === "draft").length;
    return `<section><div class="page-heading"><div><div class="eyebrow">Planung</div><h1>Dienstplan</h1><p class="muted">${fmtDate(store.weekStart,{weekday:true})} – ${fmtDate(end,{weekday:true})}</p></div><div class="page-actions"><div class="week-controls"><button class="icon-btn" data-action="week-prev">${ICONS.chevronLeft}</button><button class="btn ghost compact" data-action="week-today">Heute</button><button class="icon-btn" data-action="week-next">${ICONS.chevronRight}</button></div><button class="btn secondary" data-action="open-add-shift">${ICONS.plus} Schicht</button><button class="btn" data-action="publish-week" data-busy-sensitive ${drafts ? "" : "disabled"}>${drafts ? `${drafts} Änderungen veröffentlichen` : "Woche veröffentlicht"}</button></div></div><div class="schedule-scroll"><div class="schedule-grid"><div class="schedule-cell schedule-head">Mitarbeiter</div>${days.map(day => `<div class="schedule-cell schedule-head"><strong>${fmtDate(day,{weekday:true,year:false})}</strong><br><span class="muted">${day.slice(8,10)}.${day.slice(5,7)}.</span></div>`).join("")}${employees.map(employee => `<div class="schedule-cell"><div class="person"><span class="avatar">${esc(employee.initials || initials(employee.name))}</span><span class="person-copy"><strong>${esc(employee.name)}</strong><span class="small muted" style="display:block">${esc(employee.weeklyTarget || 0)} h Ziel</span></span></div></div>${days.map(day => { const shifts = store.state.shifts.filter(item => item.employeeId === employee.id && item.date === day); return `<div class="schedule-cell">${shifts.map(shift => `<button class="shift-card ${shift.status}" data-action="edit-shift" data-id="${attr(shift.id)}"><div class="shift-time">${esc(shift.start)}–${esc(shift.end)}</div><div>${esc(locationById(shift.locationId)?.name || "")}</div><div class="muted">${shift.status === "draft" ? "Entwurf" : "Veröffentlicht"}</div></button>`).join("")}</div>`; }).join("")}`).join("")}</div></div></section>`;
  }

  function teamView() {
    const employees = store.state.employees;
    return `<section><div class="page-heading"><div><div class="eyebrow">Organisation</div><h1>Team</h1><p class="muted">${employees.filter(item=>item.active).length} aktive Mitarbeiter.</p></div><button class="btn" data-action="open-add-employee">${ICONS.plus} Mitarbeiter</button></div><div class="card table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Standort</th><th>Wochenziel</th><th>Urlaub</th><th>Skills</th><th>Status</th></tr></thead><tbody>${employees.map(employee => { const remaining = Number(employee.vacationAllowance||0)-Number(employee.vacationUsed||0); return `<tr><td><div class="person"><span class="avatar">${esc(employee.initials || initials(employee.name))}</span><span class="person-copy"><strong>${esc(employee.name)}</strong><span class="small muted" style="display:block">${esc(employee.role)} · ${esc(employee.email || "")}</span></span></div></td><td>${esc(locationById(employee.locationId)?.name || "–")}</td><td>${esc(employee.weeklyTarget || 0)} h</td><td>${remaining} / ${esc(employee.vacationAllowance || 0)} Tage</td><td>${(employee.skills||[]).map(skill=>`<span class="pill" style="margin:2px">${esc(skill)}</span>`).join("")}</td><td>${employee.active ? `<span class="pill success">Aktiv</span>` : `<span class="pill danger">Inaktiv</span>`}</td></tr>`; }).join("")}</tbody></table></div></section>`;
  }

  function timeView() {
    const entries = [...store.state.timeEntries].sort((a,b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
    return `<section><div class="page-heading"><div><div class="eyebrow">Arbeitszeit</div><h1>Zeiterfassung</h1><p class="muted">Live-Status und abgeschlossene Arbeitszeiten.</p></div><button class="btn secondary" data-action="refresh">Aktualisieren</button></div><div class="card table-wrap"><table><thead><tr><th>Mitarbeiter</th><th>Datum</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Arbeitszeit</th><th>Status</th></tr></thead><tbody>${entries.map(entry => { const employee = employeeById(entry.employeeId); return `<tr><td><div class="person"><span class="avatar">${esc(employee?.initials || initials(employee?.name))}</span><strong>${esc(employee?.name || "Mitarbeiter")}</strong></div></td><td>${fmtDate(entry.date,{weekday:true})}</td><td>${esc(entry.start || "–")}</td><td>${esc(entry.end || "–")}</td><td>${esc(entry.breakMinutes || 0)} Min.</td><td>${entry.end ? formatMinutes(minutesBetween(entry.start,entry.end,entry.breakMinutes)) : "läuft"}</td><td>${statusPill(entry.status)}</td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">Noch keine Zeiteinträge.</div></td></tr>`}</tbody></table></div></section>`;
  }

  function leaveRow(request) {
    const employee = employeeById(request.employeeId);
    return `<div class="list-row"><div class="person"><span class="avatar">${esc(employee?.initials || initials(employee?.name))}</span><span class="person-copy"><strong>${esc(employee?.name || "Mitarbeiter")}</strong><span class="small muted" style="display:block">${esc(request.start)} – ${esc(request.end)} · ${esc(request.days || 0)} Tage</span></span></div><div class="page-actions">${statusPill(request.status)}${request.status === "pending" ? `<button class="btn ghost compact" data-action="decide-leave" data-id="${attr(request.id)}" data-decision="rejected">Ablehnen</button><button class="btn compact" data-action="decide-leave" data-id="${attr(request.id)}" data-decision="approved">Genehmigen</button>` : ""}</div></div>`;
  }

  function leaveView() {
    const requests = [...store.state.leaveRequests].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    return `<section><div class="page-heading"><div><div class="eyebrow">Abwesenheiten</div><h1>Urlaub</h1><p class="muted">${requests.filter(item=>item.status==="pending").length} offene Entscheidungen.</p></div></div><div class="split-grid"><article class="card"><div class="card-header"><div><div class="eyebrow">Offen</div><h2>Anträge</h2></div></div><div class="list">${requests.filter(item=>item.status==="pending").map(leaveRow).join("") || `<div class="empty">Keine offenen Anträge.</div>`}</div></article><article class="card"><div class="card-header"><div><div class="eyebrow">Historie</div><h2>Entschieden</h2></div></div><div class="list">${requests.filter(item=>item.status!=="pending").map(leaveRow).join("") || `<div class="empty">Noch keine Entscheidungen.</div>`}</div></article></div></section>`;
  }

  function newsView() {
    const announcements = [...store.state.announcements].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    return `<section><div class="page-heading"><div><div class="eyebrow">Kommunikation</div><h1>Neuigkeiten</h1><p class="muted">Informationen gezielt an Team oder Standort senden.</p></div><button class="btn" data-action="open-announcement">${ICONS.plus} Nachricht</button></div><div class="split-grid">${announcements.map(item => `<article class="card"><div class="card-header"><div><span class="pill">${item.audience === "all" ? "Alle" : esc(locationById(item.audience)?.name || item.audience)}</span></div><span class="small muted">${item.createdAt ? new Date(item.createdAt).toLocaleDateString("de-DE") : ""}</span></div><h2>${esc(item.title)}</h2><p>${esc(item.body)}</p><div class="small muted">${(item.readBy||[]).length} gelesen</div></article>`).join("") || `<div class="empty">Noch keine Mitteilungen.</div>`}</div></section>`;
  }

  function devicesView() {
    return `<section><div class="page-heading"><div><div class="eyebrow">Hardware</div><h1>Kiosk-Geräte</h1><p class="muted">Aktivierung und Sperrstatus zentral steuern.</p></div></div><div class="split-grid">${store.state.kioskDevices.map(device => { const location = locationById(device.locationId); return `<article class="card"><div class="card-header"><div><div class="eyebrow">${esc(location?.name || "")}</div><h2>${esc(device.name)}</h2></div>${device.locked ? `<span class="pill danger">Gesperrt</span>` : `<span class="pill success">Aktiv</span>`}</div><p class="muted">Aktivierungsversion ${esc(device.activationVersion || 1)}</p><div class="page-actions"><button class="btn ${device.locked ? "" : "danger"}" data-action="toggle-kiosk" data-id="${attr(device.id)}" data-busy-sensitive>${device.locked ? "Entsperren" : "Kiosk sperren"}</button><button class="btn ghost" data-action="renew-kiosk" data-id="${attr(device.id)}">Aktivierung erneuern</button></div></article>`; }).join("")}</div></section>`;
  }

  function renderEmployee() {
    const employee = store.state.employees[0] || employeeById(store.session.subjectId) || { name:"Mitarbeiter", initials:"AO" };
    app.innerHTML = `<div class="employee-shell"><header class="employee-top">${brand()}<div class="person"><span class="person-copy" style="text-align:right"><strong>${esc(employee.name)}</strong><span class="small muted" style="display:block">${esc(employee.role || "")}</span></span><span class="avatar dark">${esc(employee.initials || initials(employee.name))}</span><button class="icon-btn" data-action="logout">${ICONS.logout}</button></div></header><main class="employee-content"><div class="employee-tabs">${[["today","Heute"],["schedule","Dienstplan"],["time","Zeitkonto"],["leave","Urlaub"],["news","Nachrichten"]].map(([id,label])=>`<button class="employee-tab ${store.employeeView===id?"active":""}" data-action="employee-view" data-view="${id}">${label}</button>`).join("")}</div>${renderEmployeeView(employee)}</main></div>`;
  }

  function renderEmployeeView(employee) {
    const today = currentBerlin().date;
    const active = liveEntry(employee.id);
    const todayShift = store.state.shifts.find(item => item.employeeId===employee.id && item.date===today && item.status==="published");
    if (store.employeeView === "schedule") return `<div class="page-heading"><div><div class="eyebrow">Meine Planung</div><h1>Dienstplan</h1></div></div><div class="card"><div class="list">${[...store.state.shifts].filter(item=>item.status==="published").sort((a,b)=>`${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)).map(shiftListRow).join("")||`<div class="empty">Keine veröffentlichten Schichten.</div>`}</div></div>`;
    if (store.employeeView === "time") {
      const entries = [...store.state.timeEntries].sort((a,b)=>`${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
      const total = entries.filter(item=>item.end).reduce((sum,item)=>sum+minutesBetween(item.start,item.end,item.breakMinutes),0);
      return `<div class="page-heading"><div><div class="eyebrow">Meine Zeiten</div><h1>Zeitkonto</h1></div></div><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="metric"><span class="metric-label">Erfasst</span><strong class="metric-value">${formatMinutes(total)}</strong><span class="small muted">im sichtbaren Zeitraum</span></div><div class="metric"><span class="metric-label">Einträge</span><strong class="metric-value">${entries.length}</strong><span class="small muted">inklusive Live-Eintrag</span></div></div><div class="card" style="margin-top:16px"><div class="list">${entries.map(entry=>`<div class="list-row"><div><strong>${fmtDate(entry.date,{weekday:true})}</strong><div class="small muted">${esc(entry.start)}–${esc(entry.end||"läuft")} · ${esc(entry.breakMinutes||0)} Min. Pause</div></div>${statusPill(entry.status)}</div>`).join("")||`<div class="empty">Noch keine Zeiten.</div>`}</div></div>`;
    }
    if (store.employeeView === "leave") {
      const remaining = Number(employee.vacationAllowance||0)-Number(employee.vacationUsed||0);
      return `<div class="page-heading"><div><div class="eyebrow">Abwesenheit</div><h1>Urlaub</h1></div><button class="btn" data-action="open-leave-request">${ICONS.plus} Antrag</button></div><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="metric"><span class="metric-label">Resturlaub</span><strong class="metric-value">${remaining}</strong><span class="small muted">von ${esc(employee.vacationAllowance||0)} Tagen</span></div><div class="metric"><span class="metric-label">Genommen</span><strong class="metric-value">${esc(employee.vacationUsed||0)}</strong><span class="small muted">Tage</span></div></div><div class="card" style="margin-top:16px"><div class="list">${store.state.leaveRequests.map(leaveRow).join("")||`<div class="empty">Noch keine Anträge.</div>`}</div></div>`;
    }
    if (store.employeeView === "news") {
      const unread = store.state.notifications.filter(item=>!item.read).length;
      return `<div class="page-heading"><div><div class="eyebrow">Team</div><h1>Nachrichten</h1></div>${unread?`<button class="btn secondary" data-action="mark-notifications-read">Alle gelesen</button>`:""}</div><div class="split-grid">${store.state.notifications.map(item=>`<article class="card ${item.read?"":"soft"}"><div class="card-header"><span class="pill ${item.read?"":"dark"}">${item.read?"Gelesen":"Neu"}</span><span class="small muted">${item.createdAt?new Date(item.createdAt).toLocaleDateString("de-DE"):""}</span></div><h2>${esc(item.title)}</h2><p>${esc(item.body)}</p></article>`).join("")||`<div class="empty">Keine Nachrichten.</div>`}</div>`;
    }
    return `<div class="page-heading"><div><div class="eyebrow">${fmtDate(today,{weekday:true,long:true})}</div><h1>Hallo, ${esc(employee.name.split(" ")[0])}.</h1><p class="muted">Dein Arbeitstag auf einen Blick.</p></div><span class="connection ${store.connection?"":"offline"}">${store.connection?"Synchronisiert":"Offline"}</span></div><div class="employee-hero"><article class="card black today-card"><div><div class="today-date">${todayShift ? `${esc(locationById(todayShift.locationId)?.name||"")} · ${esc(todayShift.start)}–${esc(todayShift.end)}` : "Heute keine Schicht geplant"}</div><div class="today-time" data-live-clock>${currentBerlin().time}</div></div><div><div class="eyebrow" style="color:#777">Status</div><h2 style="margin:6px 0 0">${active ? (active.status==="paused"?"Pause läuft":"Arbeitszeit läuft") : "Nicht eingestempelt"}</h2>${active?`<p style="color:#aaa;margin:8px 0 0">Seit ${esc(active.start)} Uhr · ${esc(active.breakMinutes||0)} Min. Pause</p>`:""}</div></article><article class="card"><div class="card-header"><div><div class="eyebrow">Nächste Schicht</div><h2>${todayShift ? "Heute" : "Geplant"}</h2></div>${todayShift?statusPill(todayShift.status):""}</div>${todayShift?`<div class="metric-value">${esc(todayShift.start)}–${esc(todayShift.end)}</div><p class="muted">${esc(locationById(todayShift.locationId)?.name||"")} · ${formatMinutes(minutesBetween(todayShift.start,todayShift.end,todayShift.breakMinutes))}</p>`:`<div class="empty">Keine anstehende Schicht gefunden.</div>`}<div class="divider"></div><div class="list-row"><span>Resturlaub</span><strong>${Number(employee.vacationAllowance||0)-Number(employee.vacationUsed||0)} Tage</strong></div><div class="list-row"><span>Wochenziel</span><strong>${esc(employee.weeklyTarget||0)} h</strong></div></article></div>`;
  }

  function renderKiosk() {
    const now = currentBerlin();
    const device = store.state.kioskDevices?.find(item => item.id === store.session.deviceId) || store.state.kioskDevices?.[0];
    const employees = store.state.employees.filter(item => item.active);
    const out = employees.filter(item => !liveEntry(item.id));
    const live = employees.filter(item => liveEntry(item.id)?.status === "live");
    const paused = employees.filter(item => liveEntry(item.id)?.status === "paused");
    const column = (title, items, tone) => `<section class="kiosk-column"><div class="kiosk-column-head"><h2>${title}</h2><span class="pill ${tone}">${items.length}</span></div>${items.map(kioskPerson).join("") || `<div class="empty">Keine Mitarbeiter</div>`}</section>`;
    const selected = store.selectedEmployeeId ? employeeById(store.selectedEmployeeId) : null;
    const entry = selected ? liveEntry(selected.id) : null;
    app.innerHTML = `<main class="kiosk-shell"><header class="kiosk-header"><div>${brand()}<div class="small muted" style="margin:7px 0 0 55px">${esc(device?.name || "Kiosk")} · ${device?.locked ? "Gesperrt" : "Bereit"}</div></div><div style="text-align:right"><div class="kiosk-clock" data-live-clock>${now.time}</div><div class="small muted">${fmtDate(now.date,{weekday:true,long:true})}</div></div></header>${device?.locked ? `<div class="card black" style="min-height:70vh;display:grid;place-items:center;text-align:center"><div><div class="eyebrow" style="color:#777">Gerät gesperrt</div><h1>Dieser Kiosk wurde<br>vom Arbeitgeber gesperrt.</h1><p style="color:#aaa">Bitte wende dich an die Administration.</p><button class="btn secondary" data-action="refresh">Erneut prüfen</button></div></div>` : `<div class="kiosk-columns">${column("Ausgestempelt",out,"")}${column("Eingestempelt",live,"success")}${column("Pause",paused,"warning")}</div>`}<div class="kiosk-actions ${selected && !device?.locked ? "" : "hide"}">${!entry ? `<button class="btn" data-action="kiosk-transition" data-target="in" data-busy-sensitive>Einstempeln</button>` : entry.status==="live" ? `<button class="btn secondary" data-action="kiosk-transition" data-target="pause" data-busy-sensitive>Pause</button><button class="btn" data-action="kiosk-transition" data-target="out" data-busy-sensitive>Feierabend</button>` : `<button class="btn secondary" data-action="kiosk-transition" data-target="in" data-busy-sensitive>Pause beenden</button><button class="btn" data-action="kiosk-transition" data-target="out" data-busy-sensitive>Feierabend</button>`}<button class="btn ghost" data-action="clear-kiosk-selection">Abbrechen</button></div></main>`;
  }

  function kioskPerson(employee) {
    const entry = liveEntry(employee.id);
    return `<button class="kiosk-person ${store.selectedEmployeeId===employee.id?"selected":""}" data-action="select-kiosk-employee" data-id="${attr(employee.id)}"><span class="avatar">${esc(employee.initials || initials(employee.name))}</span><span class="person-copy"><strong>${esc(employee.name)}</strong><span class="small muted" style="display:block">${entry ? `${entry.status==="paused"?"Pause":"Seit"} ${esc(entry.status==="paused"?(entry.pauseStartedAt||entry.start):entry.start)}` : esc(employee.role)}</span></span></button>`;
  }

  function openModal(content) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true">${content}</section>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => { if (event.target === backdrop || event.target.closest("[data-action='close-modal']")) backdrop.remove(); });
    return backdrop;
  }

  function shiftModal(existing = null) {
    const modal = openModal(`<div class="modal-head"><div><div class="eyebrow">${existing?"Bearbeiten":"Neu"}</div><h2>Schicht ${existing?"bearbeiten":"anlegen"}</h2></div><button class="icon-btn" data-action="close-modal">${ICONS.close}</button></div><form id="shift-form" class="form-grid"><div class="field full"><label>Mitarbeiter</label><select class="select" name="employeeId" required>${store.state.employees.filter(item=>item.active).map(item=>`<option value="${attr(item.id)}" ${existing?.employeeId===item.id?"selected":""}>${esc(item.name)}</option>`).join("")}</select></div><div class="field"><label>Datum</label><input class="input" name="date" type="date" value="${attr(existing?.date || store.weekStart)}" required></div><div class="field"><label>Standort</label><select class="select" name="locationId" required>${store.state.locations.filter(item=>item.active).map(item=>`<option value="${attr(item.id)}" ${existing?.locationId===item.id?"selected":""}>${esc(item.name)}</option>`).join("")}</select></div><div class="field"><label>Beginn</label><input class="input" name="start" type="time" value="${attr(existing?.start||"07:00")}" required></div><div class="field"><label>Ende</label><input class="input" name="end" type="time" value="${attr(existing?.end||"15:00")}" required></div><div class="field full"><label>Pause in Minuten</label><input class="input" name="breakMinutes" type="number" min="0" step="5" value="${attr(existing?.breakMinutes??30)}" required></div><div class="field full"><div class="page-actions" style="justify-content:flex-end">${existing?`<button class="btn danger" type="button" data-action="delete-shift" data-id="${attr(existing.id)}">Löschen</button>`:""}<button class="btn ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn" type="submit" data-busy-sensitive>Speichern</button></div></div></form>`);
    modal.querySelector("#shift-form").addEventListener("submit", async event => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); data.breakMinutes = Number(data.breakMinutes || 0);
      try { if (existing) await applyEvent({ type:"UPDATE_SHIFT", id:existing.id, patch:data }); else await applyEvent({ type:"ADD_SHIFT", shift:data }); modal.remove(); } catch {}
    });
  }

  function employeeModal() {
    const modal = openModal(`<div class="modal-head"><div><div class="eyebrow">Team</div><h2>Mitarbeiter anlegen</h2></div><button class="icon-btn" data-action="close-modal">${ICONS.close}</button></div><form id="employee-form" class="form-grid"><div class="field full"><label>Name</label><input class="input" name="name" required></div><div class="field"><label>Rolle</label><input class="input" name="role" value="Mitarbeiter" required></div><div class="field"><label>E-Mail</label><input class="input" name="email" type="email"></div><div class="field"><label>Standort</label><select class="select" name="locationId">${store.state.locations.map(item=>`<option value="${attr(item.id)}">${esc(item.name)}</option>`).join("")}</select></div><div class="field"><label>Wochenziel</label><input class="input" name="weeklyTarget" type="number" min="0" value="30"></div><div class="field"><label>Urlaubsanspruch</label><input class="input" name="vacationAllowance" type="number" min="0" step=".5" value="27.5"></div><div class="field"><label>Stundenkosten</label><input class="input" name="hourlyCost" type="number" min="0" step=".1" value="18"></div><div class="field full"><div class="page-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn" type="submit">Anlegen</button></div></div></form>`);
    modal.querySelector("#employee-form").addEventListener("submit", async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); ["weeklyTarget","vacationAllowance","hourlyCost"].forEach(key=>data[key]=Number(data[key]||0)); try { await applyEvent({type:"ADD_EMPLOYEE",employee:data}); modal.remove(); } catch {} });
  }

  function announcementModal() {
    const modal = openModal(`<div class="modal-head"><div><div class="eyebrow">Kommunikation</div><h2>Nachricht veröffentlichen</h2></div><button class="icon-btn" data-action="close-modal">${ICONS.close}</button></div><form id="announcement-form" class="form-grid"><div class="field full"><label>Titel</label><input class="input" name="title" required></div><div class="field full"><label>Empfänger</label><select class="select" name="audience"><option value="all">Alle Mitarbeiter</option>${store.state.locations.map(item=>`<option value="${attr(item.id)}">${esc(item.name)}</option>`).join("")}</select></div><div class="field full"><label>Nachricht</label><textarea class="textarea" name="body" required></textarea></div><div class="field full"><div class="page-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn" type="submit">Veröffentlichen</button></div></div></form>`);
    modal.querySelector("#announcement-form").addEventListener("submit", async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await applyEvent({type:"ADD_ANNOUNCEMENT",announcement:data}); modal.remove(); } catch {} });
  }

  function leaveModal() {
    const modal = openModal(`<div class="modal-head"><div><div class="eyebrow">Urlaub</div><h2>Abwesenheit beantragen</h2></div><button class="icon-btn" data-action="close-modal">${ICONS.close}</button></div><form id="leave-form" class="form-grid"><div class="field"><label>Von</label><input class="input" name="start" type="date" min="${currentBerlin().date}" required></div><div class="field"><label>Bis</label><input class="input" name="end" type="date" min="${currentBerlin().date}" required></div><div class="field full"><label>Art</label><select class="select" name="type"><option>Urlaub</option><option>Krankheit</option><option>Unbezahlt</option></select></div><div class="field full"><label>Notiz</label><textarea class="textarea" name="note"></textarea></div><div class="field full"><div class="page-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-action="close-modal">Abbrechen</button><button class="btn" type="submit">Antrag senden</button></div></div></form>`);
    modal.querySelector("#leave-form").addEventListener("submit", async event => { event.preventDefault(); const request = Object.fromEntries(new FormData(event.currentTarget)); try { await applyEvent({type:"REQUEST_LEAVE",request}); modal.remove(); } catch {} });
  }

  app.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "select-role") { store.role = button.dataset.role; history.replaceState({}, "", `/${store.role}`); renderLogin(); }
    else if (action === "logout") await logout();
    else if (action === "retry" || action === "refresh") await loadWorkspace();
    else if (action === "admin-view") { store.view = button.dataset.view; renderAdmin(); document.getElementById("sidebar")?.classList.remove("open"); }
    else if (action === "employee-view") { store.employeeView = button.dataset.view; renderEmployee(); }
    else if (action === "toggle-sidebar") document.getElementById("sidebar")?.classList.toggle("open");
    else if (action === "week-prev") { store.weekStart = addDays(store.weekStart,-7); renderAdmin(); }
    else if (action === "week-next") { store.weekStart = addDays(store.weekStart,7); renderAdmin(); }
    else if (action === "week-today") { store.weekStart = startOfWeek(new Date()); renderAdmin(); }
    else if (action === "open-add-shift") shiftModal();
    else if (action === "edit-shift") shiftModal(store.state.shifts.find(item=>item.id===button.dataset.id));
    else if (action === "delete-shift" && confirm("Schicht wirklich löschen?")) { try { await applyEvent({type:"DELETE_SHIFT",id:button.dataset.id}); document.querySelector(".modal-backdrop")?.remove(); } catch {} }
    else if (action === "publish-week") { try { await applyEvent({type:"PUBLISH_WEEK",start:store.weekStart}); } catch {} }
    else if (action === "open-add-employee") employeeModal();
    else if (action === "decide-leave") { try { await applyEvent({type:"DECIDE_LEAVE",id:button.dataset.id,decision:button.dataset.decision}); } catch {} }
    else if (action === "open-announcement") announcementModal();
    else if (action === "toggle-kiosk") { try { await applyEvent({type:"TOGGLE_KIOSK_LOCK",id:button.dataset.id}); } catch {} }
    else if (action === "renew-kiosk") { try { await applyEvent({type:"RENEW_KIOSK",id:button.dataset.id}); } catch {} }
    else if (action === "open-leave-request") leaveModal();
    else if (action === "mark-notifications-read") { try { await applyEvent({type:"MARK_NOTIFICATIONS_READ"}); } catch {} }
    else if (action === "select-kiosk-employee") { store.selectedEmployeeId = button.dataset.id; renderKiosk(); }
    else if (action === "clear-kiosk-selection") { store.selectedEmployeeId = null; renderKiosk(); }
    else if (action === "kiosk-transition" && store.selectedEmployeeId) { try { await applyEvent({ type:"KIOSK_TRANSITION", employeeId:store.selectedEmployeeId, target:button.dataset.target }); store.selectedEmployeeId = null; renderKiosk(); } catch {} }
  });

  window.addEventListener("online", () => { store.connection = true; renderProduct(); toast("Verbindung wiederhergestellt."); });
  window.addEventListener("offline", () => { store.connection = false; renderProduct(); toast("Keine Internetverbindung.", "error"); });
  setInterval(() => { document.querySelectorAll("[data-live-clock]").forEach(node => { node.textContent = currentBerlin().time; }); }, 1000);

  async function boot() {
    renderLoading();
    try {
      await loadDirectory();
      store.role = routeRole() || store.role;
      store.session = readSession(store.role);
      if (store.session) { await loadWorkspace(); configureRefresh(); }
      else { store.loading = false; renderLogin(); }
    } catch (error) { store.loading = false; renderError(error.message); }
  }

  boot();
})();
