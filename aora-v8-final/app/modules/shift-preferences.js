"use strict";

(() => {
  const FUNCTION_NAME = "aora-v8-shift-preferences";
  const store = S.u.shiftPreferences ||= {
    items: [],
    loading: false,
    loaded: false,
    error: null,
    modal: null,
    managerWeek: null
  };

  const employeeCalendar = typeof globalThis.uCalendarPage === "function" ? globalThis.uCalendarPage : null;
  const managerSchedule = typeof globalThis.schedulePage === "function" ? globalThis.schedulePage : null;
  const html = (value) => typeof esc === "function"
    ? esc(value == null ? "" : String(value))
    : String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const icon = (name) => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
  const currentDate = () => typeof berlin === "function" ? berlin().date : new Date().toISOString().slice(0, 10);
  const add = (date, days) => typeof addDays === "function"
    ? addDays(date, days)
    : (() => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); })();
  const weekStart = (date = currentDate()) => {
    if (typeof startWeek === "function" && date === currentDate()) return startWeek();
    const value = new Date(`${date}T12:00:00Z`);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
    return value.toISOString().slice(0, 10);
  };
  const dateLabel = (date, options = {}) => {
    if (typeof fd === "function") return fd(date, options);
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", ...(options.weekday ? { weekday: "short" } : {}), timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  };
  const employeeById = (id) => typeof emp === "function" ? emp(id) : (S.state?.employees || []).find((item) => item.id === id);
  const locationById = (id) => typeof loc === "function" ? loc(id) : (S.state?.locations || []).find((item) => item.id === id);
  const minutes = (start, end, breakMinutes = 0) => {
    if (typeof mins === "function") return mins(start, end, breakMinutes);
    const [sh, sm] = String(start).split(":").map(Number);
    const [eh, em] = String(end).split(":").map(Number);
    return Math.max(0, eh * 60 + em - sh * 60 - sm - Number(breakMinutes || 0));
  };
  const duration = (value) => typeof fm === "function" ? fm(value) : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")} Std.`;

  function canUseFeature() {
    return Boolean(S.session?.token && ["employee", "manager", "owner"].includes(S.accessRole));
  }

  async function preferenceRequest(action, payload = {}) {
    return request(FUNCTION_NAME, {
      action,
      token: S.session?.token,
      expectedRevision: S.revision,
      ...payload
    });
  }

  async function ensurePreferences(force = false) {
    if (!canUseFeature() || store.loading || (store.loaded && !force)) return;
    store.loading = true;
    store.error = null;
    try {
      const data = await preferenceRequest("load");
      store.items = Array.isArray(data.preferences) ? data.preferences : [];
      store.loaded = true;
    } catch (error) {
      store.error = error?.message || "Schichtwünsche konnten nicht geladen werden.";
    } finally {
      store.loading = false;
      if (typeof render === "function" && (S.employeeView === "calendar" || S.adminView === "schedule")) render();
    }
  }

  function preferenceStatus(item) {
    return ({ pending: "Offen", accepted: "Übernommen", rejected: "Abgelehnt", cancelled: "Zurückgezogen" })[item.status] || item.status || "Offen";
  }

  function preferenceForEmployee(date) {
    const employeeId = S.session?.subjectId || S.session?.employeeId;
    return store.items
      .filter((item) => item.employeeId === employeeId && item.date === date)
      .sort((a, b) => `${a.start}${a.createdAt || ""}`.localeCompare(`${b.start}${b.createdAt || ""}`));
  }

  function employeePreferenceCard(item) {
    const pending = item.status === "pending";
    return `<article class="sp-employee-card is-${html(item.status || "pending")}">
      <div class="sp-card-icon">${icon("event_upcoming")}</div>
      <div class="sp-card-copy">
        <strong>Schichtwunsch</strong>
        <span>${html(item.start)} – ${html(item.end)} · ${html(locationById(item.locationId)?.name || "Standort")}</span>
        <small>${html(preferenceStatus(item))}${item.note ? ` · ${html(item.note)}` : ""}</small>
      </div>
      <div class="sp-card-side"><b>${duration(minutes(item.start, item.end, item.breakMinutes))}</b>${pending ? `<button data-sp-action="cancel" data-id="${html(item.id)}">Zurückziehen</button>` : ""}</div>
    </article>`;
  }

  function createButton(date) {
    return `<button class="sp-request-button" data-sp-action="open-create" data-date="${html(date)}">${icon("add_circle")}<span>Schicht wünschen</span></button>`;
  }

  function augmentEmployeeCalendar(markup) {
    const date = S.u.calendar?.selected || currentDate();
    const cards = preferenceForEmployee(date).map(employeePreferenceCard).join("");
    const actionPattern = /<button class="aora-cal-add" data-u="availability" data-date="[^"]+"[^>]*>[\s\S]*?<\/button>/;
    let output = markup.replace(actionPattern, (availabilityButton) => `<div class="sp-calendar-actions">${availabilityButton}${createButton(date)}</div>`);
    output = output.replace('<div class="aora-cal-entry-list">', `<div class="aora-cal-entry-list">${cards}`);
    if (store.loading) output = output.replace('<div class="aora-cal-entry-list">', '<div class="aora-cal-entry-list"><div class="sp-inline-state">Schichtwünsche werden geladen …</div>');
    if (store.error) output = output.replace('<div class="aora-cal-entry-list">', `<div class="aora-cal-entry-list"><button class="sp-inline-error" data-sp-action="reload">${html(store.error)} · erneut versuchen</button>`);
    return output + modalMarkup();
  }

  function weekDays(start) {
    return Array.from({ length: 7 }, (_, index) => add(start, index));
  }

  function managerPreferences() {
    return store.items.filter((item) => item.status === "pending" && item.locationId === S.locationId);
  }

  function shiftCard(shift) {
    return `<button class="sp-shift-card" data-a="shift-modal" data-id="${html(shift.id)}" title="Schicht bearbeiten">
      <strong>${html(shift.start)}–${html(shift.end)}</strong><span>${duration(minutes(shift.start, shift.end, shift.breakMinutes))}</span>
    </button>`;
  }

  function ghostCard(item) {
    return `<button class="sp-ghost-card" data-sp-action="open-decision" data-id="${html(item.id)}" aria-label="Schichtwunsch von ${html(employeeById(item.employeeId)?.name || "Mitarbeiter")} prüfen">
      <span class="sp-ghost-label">Wunsch</span><strong>${html(item.start)}–${html(item.end)}</strong>${item.note ? `<small>${html(item.note)}</small>` : ""}
    </button>`;
  }

  function managerSchedulePage() {
    queueMicrotask(() => ensurePreferences());
    const start = store.managerWeek || (store.managerWeek = weekStart());
    const days = weekDays(start);
    const employees = (S.state?.employees || []).filter((item) => item.active !== false && item.locationId === S.locationId);
    const shifts = (S.state?.shifts || []).filter((item) => item.locationId === S.locationId && item.date >= days[0] && item.date <= days[6]);
    const preferences = managerPreferences().filter((item) => item.date >= days[0] && item.date <= days[6]);
    const weekEnd = days[6];
    const cells = employees.map((employee) => `<div class="sp-planner-row">
      <div class="sp-person-cell"><span class="sp-avatar">${html(employee.initials || String(employee.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2))}</span><div><strong>${html(employee.name)}</strong><small>${html(employee.role || "Mitarbeiter")}</small></div></div>
      ${days.map((date) => `<div class="sp-day-cell" data-date="${date}" data-employee="${html(employee.id)}">
        ${shifts.filter((item) => item.employeeId === employee.id && item.date === date).map(shiftCard).join("")}
        ${preferences.filter((item) => item.employeeId === employee.id && item.date === date).map(ghostCard).join("")}
        ${!shifts.some((item) => item.employeeId === employee.id && item.date === date) && !preferences.some((item) => item.employeeId === employee.id && item.date === date) ? '<span class="sp-empty-cell">–</span>' : ""}
      </div>`).join("")}
    </div>`).join("");
    const allRows = (S.state?.shifts || []).filter((item) => item.locationId === S.locationId).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    const tableRows = allRows.map((item) => `<tr><td>${html(dateLabel(item.date, { weekday: true }))}</td><td>${html(employeeById(item.employeeId)?.name || "–")}</td><td>${html(item.start)}–${html(item.end)}</td><td>${Number(item.breakMinutes || 0)} Min.</td><td>${html(item.status || "draft")}</td></tr>`).join("");
    return `<section class="sp-schedule-page">
      <header class="sp-planner-head"><div><span class="caps">Aora Dienstplanung</span><h1>Dienstplan</h1><p>Feste Schichten und Vorschläge des Teams in einer Ansicht.</p></div><div class="sp-planner-actions"><button class="btn outline" data-sp-action="week-prev" aria-label="Vorherige Woche">${icon("chevron_left")}</button><button class="btn outline" data-sp-action="week-today">Heute</button><button class="btn outline" data-sp-action="week-next" aria-label="Nächste Woche">${icon("chevron_right")}</button><button class="btn" data-a="shift-modal">Neue Schicht</button></div></header>
      <div class="sp-planner-summary"><div><strong>${html(dateLabel(start))} – ${html(dateLabel(weekEnd))}</strong><span>${preferences.length} offene Schichtwünsche</span></div><div class="sp-legend"><span><i class="is-shift"></i>Geplante Schicht</span><span><i class="is-preference"></i>Schichtwunsch</span></div></div>
      ${store.error ? `<button class="sp-inline-error" data-sp-action="reload">${html(store.error)} · erneut versuchen</button>` : ""}
      <div class="sp-planner-scroll"><div class="sp-planner-grid">
        <div class="sp-planner-header"><div>Mitarbeiter</div>${days.map((date) => `<div class="${date === currentDate() ? "is-today" : ""}"><span>${html(dateLabel(date, { weekday: true }).split(",")[0])}</span><strong>${html(date.slice(8, 10))}</strong></div>`).join("")}</div>
        ${cells || '<div class="sp-empty-planner">Für diesen Standort sind keine aktiven Mitarbeiter vorhanden.</div>'}
      </div></div>
      <details class="sp-schedule-list"><summary>Listenansicht aller Schichten</summary><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Zeit</th><th>Pause</th><th>Status</th></tr></thead><tbody>${tableRows || '<tr><td colspan="5">Keine Schichten vorhanden.</td></tr>'}</tbody></table></div></details>
      ${modalMarkup()}
    </section>`;
  }

  function modalMarkup() {
    if (!store.modal) return "";
    if (store.modal.type === "create") {
      const date = store.modal.date || currentDate();
      return `<div class="sp-modal-backdrop"><section class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-create-title"><button class="sp-modal-close" data-sp-action="close" aria-label="Schließen">${icon("close")}</button><div class="sp-modal-icon">${icon("event_upcoming")}</div><h2 id="sp-create-title">Schichtwunsch abgeben</h2><p>Der Wunsch ist noch keine feste Schicht. Dein Manager kann ihn übernehmen oder ablehnen.</p><form data-sp-form="create"><label>Datum<input name="date" type="date" min="${currentDate()}" value="${html(date)}" required></label><div class="sp-form-row"><label>Beginn<input name="start" type="time" value="09:00" required></label><label>Ende<input name="end" type="time" value="17:00" required></label><label>Pause<input name="breakMinutes" type="number" min="0" max="180" step="5" value="30" required></label></div><label>Notiz (optional)<textarea name="note" maxlength="240" placeholder="z. B. Frühschicht bevorzugt"></textarea></label><div class="sp-modal-actions"><button type="button" class="btn outline" data-sp-action="close">Abbrechen</button><button type="submit" class="btn">Wunsch senden</button></div></form></section></div>`;
    }
    const item = store.items.find((candidate) => candidate.id === store.modal.id);
    if (!item) return "";
    const employee = employeeById(item.employeeId);
    return `<div class="sp-modal-backdrop"><section class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-decision-title"><button class="sp-modal-close" data-sp-action="close" aria-label="Schließen">${icon("close")}</button><div class="sp-modal-icon is-ghost">${icon("event_upcoming")}</div><span class="caps">Schichtwunsch</span><h2 id="sp-decision-title">${html(employee?.name || "Mitarbeiter")}</h2><p>${html(dateLabel(item.date, { weekday: true }))} · ${html(locationById(item.locationId)?.name || "Standort")}</p><form data-sp-form="decision" data-id="${html(item.id)}"><div class="sp-form-row"><label>Beginn<input name="start" type="time" value="${html(item.start)}" required></label><label>Ende<input name="end" type="time" value="${html(item.end)}" required></label><label>Pause<input name="breakMinutes" type="number" min="0" max="180" step="5" value="${Number(item.breakMinutes || 0)}" required></label></div>${item.note ? `<div class="sp-note"><strong>Notiz</strong><span>${html(item.note)}</span></div>` : ""}<label>Entscheidungsnotiz (optional)<textarea name="reason" maxlength="240" placeholder="Wird dem Mitarbeiter angezeigt"></textarea></label><div class="sp-modal-actions sp-decision-actions"><button type="button" class="btn outline danger" data-sp-action="reject" data-id="${html(item.id)}">Ablehnen</button><button type="submit" class="btn">In Dienstplan übernehmen</button></div></form></section></div>`;
  }

  async function refreshAfterMutation(data, message) {
    if (Array.isArray(data?.preferences)) store.items = data.preferences;
    store.loaded = true;
    store.modal = null;
    if (data?.revision !== undefined && typeof loadState === "function") await loadState(true);
    await ensurePreferences(true);
    if (typeof toast === "function") toast(message, "success");
    if (typeof render === "function") render();
  }

  async function createPreference(form) {
    const values = new FormData(form);
    const payload = {
      date: String(values.get("date") || ""),
      start: String(values.get("start") || ""),
      end: String(values.get("end") || ""),
      breakMinutes: Number(values.get("breakMinutes") || 0),
      note: String(values.get("note") || "").trim()
    };
    const data = await preferenceRequest("create", { preference: payload });
    await refreshAfterMutation(data, "Schichtwunsch wurde gesendet.");
  }

  async function decidePreference(form) {
    const item = store.items.find((candidate) => candidate.id === form.dataset.id);
    if (!item) throw new Error("Schichtwunsch wurde nicht gefunden.");
    const values = new FormData(form);
    const shift = {
      employeeId: item.employeeId,
      locationId: item.locationId,
      date: item.date,
      start: String(values.get("start") || item.start),
      end: String(values.get("end") || item.end),
      breakMinutes: Number(values.get("breakMinutes") || item.breakMinutes || 0),
      status: "draft"
    };
    const data = await preferenceRequest("decide", { id: item.id, decision: "accepted", reason: String(values.get("reason") || "").trim(), shift });
    await refreshAfterMutation(data, "Schichtwunsch wurde in den Dienstplan übernommen.");
  }

  async function rejectPreference(id, reason = "") {
    const data = await preferenceRequest("decide", { id, decision: "rejected", reason });
    await refreshAfterMutation(data, "Schichtwunsch wurde abgelehnt.");
  }

  if (employeeCalendar) {
    globalThis.uCalendarPage = function shiftPreferenceEmployeeCalendar() {
      queueMicrotask(() => ensurePreferences());
      const markup = employeeCalendar();
      return S.accessRole === "employee" ? augmentEmployeeCalendar(markup) : markup;
    };
  }
  if (managerSchedule) globalThis.schedulePage = managerSchedulePage;

  document.addEventListener("click", async (event) => {
    if (event.target.classList?.contains("sp-modal-backdrop")) {
      store.modal = null;
      render();
      return;
    }
    const control = event.target.closest?.("[data-sp-action]");
    if (!control) return;
    const action = control.dataset.spAction;
    try {
      if (action === "open-create") store.modal = { type: "create", date: control.dataset.date || currentDate() };
      else if (action === "open-decision") store.modal = { type: "decision", id: control.dataset.id };
      else if (action === "close") store.modal = null;
      else if (action === "reload") await ensurePreferences(true);
      else if (action === "cancel") {
        const data = await preferenceRequest("cancel", { id: control.dataset.id });
        await refreshAfterMutation(data, "Schichtwunsch wurde zurückgezogen.");
        return;
      } else if (action === "reject") {
        const form = control.closest("form");
        await rejectPreference(control.dataset.id, String(new FormData(form).get("reason") || "").trim());
        return;
      } else if (action === "week-prev") store.managerWeek = add(store.managerWeek || weekStart(), -7);
      else if (action === "week-next") store.managerWeek = add(store.managerWeek || weekStart(), 7);
      else if (action === "week-today") store.managerWeek = weekStart();
      else return;
      render();
    } catch (error) {
      if (typeof toast === "function") toast(error?.message || "Aktion fehlgeschlagen.", "error");
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest?.("[data-sp-form]");
    if (!form) return;
    event.preventDefault();
    if (S.busy) return;
    S.busy = true;
    try {
      if (form.dataset.spForm === "create") await createPreference(form);
      else if (form.dataset.spForm === "decision") await decidePreference(form);
    } catch (error) {
      if (error?.status === 409 && typeof loadState === "function") await loadState(true);
      if (typeof toast === "function") toast(error?.message || "Aktion fehlgeschlagen.", "error");
    } finally {
      S.busy = false;
    }
  });

  globalThis.AoraShiftPreferences = Object.freeze({
    version: "1.0.0",
    ensure: ensurePreferences,
    items: () => store.items.slice()
  });
})();
