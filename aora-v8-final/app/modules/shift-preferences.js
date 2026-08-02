"use strict";

(() => {
  const FUNCTION_NAME = "aora-v8-shift-preferences";
  const originalEmployeeCalendar = typeof globalThis.uCalendarPage === "function" ? globalThis.uCalendarPage : null;
  const originalAdminView = typeof globalThis.adminView === "function" ? globalThis.adminView : null;
  const currentDate = () => typeof berlin === "function" ? berlin().date : new Date().toISOString().slice(0, 10);
  const employeeId = () => String(S.session?.subjectId || S.session?.employeeId || "");
  const icon = (name) => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
  const statusLabel = (status) => ({ pending: "Offen", accepted: "Übernommen", rejected: "Abgelehnt", cancelled: "Zurückgezogen" })[status] || status || "Offen";
  const minutes = (start, end, breakMinutes = 0) => {
    try { return mins(start, end, breakMinutes); }
    catch {
      const [sh, sm] = String(start || "00:00").split(":").map(Number);
      const [eh, em] = String(end || "00:00").split(":").map(Number);
      return Math.max(0, eh * 60 + em - sh * 60 - sm - Number(breakMinutes || 0));
    }
  };
  const duration = (value) => typeof fm === "function"
    ? fm(value)
    : `${Math.floor(Number(value || 0) / 60)}:${String(Number(value || 0) % 60).padStart(2, "0")} Std.`;

  function normalizePreference(item) {
    const payload = item?.payload && typeof item.payload === "object" ? item.payload : item || {};
    return {
      id: String(item?.id || payload.id || ""),
      shiftId: item?.shiftId ?? item?.shift_id ?? payload.shiftId ?? null,
      employeeId: String(item?.employeeId ?? item?.employee_id ?? payload.employeeId ?? ""),
      locationId: String(item?.locationId ?? item?.location_id ?? payload.locationId ?? ""),
      requestType: String(item?.requestType ?? item?.request_type ?? payload.requestType ?? ""),
      date: String(item?.date ?? payload.date ?? ""),
      start: String(item?.start ?? payload.start ?? "").slice(0, 5),
      end: String(item?.end ?? payload.end ?? "").slice(0, 5),
      breakMinutes: Number(item?.breakMinutes ?? payload.breakMinutes ?? 0),
      note: String(item?.note ?? payload.note ?? ""),
      status: String(item?.status ?? payload.status ?? "pending"),
      reason: String(item?.reason ?? payload.reason ?? ""),
      createdAt: item?.createdAt ?? item?.created_at ?? payload.createdAt ?? null
    };
  }

  function sourceRows() {
    if (["manager", "owner"].includes(S.accessRole) && Array.isArray(S.u?.schedule?.data?.shiftRequests)) {
      return S.u.schedule.data.shiftRequests;
    }
    return Array.isArray(S.state?.shiftRequests) ? S.state.shiftRequests : [];
  }

  function preferences() {
    return sourceRows().map(normalizePreference).filter((item) => item.id && item.requestType === "shift_preference");
  }

  function ownPreferences(date) {
    const id = employeeId();
    return preferences()
      .filter((item) => item.employeeId === id && item.date === date)
      .sort((a, b) => `${a.start}${a.createdAt || ""}`.localeCompare(`${b.start}${b.createdAt || ""}`));
  }

  function managerPreferences() {
    return preferences()
      .filter((item) => item.status === "pending" && item.locationId === String(S.locationId || ""))
      .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  }

  async function preferenceRequest(action, payload = {}) {
    return request(FUNCTION_NAME, {
      action,
      token: S.session?.token,
      idempotencyKey: crypto.randomUUID(),
      ...payload
    });
  }

  function employeeCard(item) {
    const pending = item.status === "pending";
    return `<article class="aora-cal-entry aora-cal-entry-shift" data-sp-preference-card="${esc(item.id)}">
      <div class="aora-cal-entry-icon">${icon("event_upcoming")}</div>
      <div class="aora-cal-entry-copy"><strong>Schichtwunsch</strong><span>${esc(item.start)} – ${esc(item.end)} · ${esc(loc(item.locationId)?.name || "Standort")}</span><small>${esc(statusLabel(item.status))}${item.note ? ` · ${esc(item.note)}` : ""}</small></div>
      <div class="aora-cal-entry-value">${duration(minutes(item.start, item.end, item.breakMinutes))}</div>
      ${pending ? `<div class="u-actions"><button class="u-btn secondary" data-sp-action="cancel" data-id="${esc(item.id)}">Zurückziehen</button></div>` : ""}
    </article>`;
  }

  function decorateEmployeeCalendar() {
    if (S.accessRole !== "employee" || S.employeeView !== "calendar") return;
    const selected = S.u.calendar?.selected || currentDate();
    const sheetHead = document.querySelector(".aora-cal-sheet-head");
    const nativeAvailability = sheetHead?.querySelector('[data-u="availability"]');
    if (nativeAvailability && !sheetHead.querySelector('[data-sp-action="create"]')) {
      let actions = nativeAvailability.parentElement?.classList.contains("aora-cal-header-actions") ? nativeAvailability.parentElement : null;
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "aora-cal-header-actions";
        nativeAvailability.before(actions);
        actions.append(nativeAvailability);
      }
      nativeAvailability.title = "Verfügbarkeit festlegen";
      const trigger = document.createElement("button");
      trigger.className = "aora-cal-add";
      trigger.type = "button";
      trigger.dataset.spAction = "create";
      trigger.dataset.date = selected;
      trigger.setAttribute("aria-label", "Schichtwunsch für diesen Tag abgeben");
      trigger.title = "Schicht wünschen";
      trigger.innerHTML = icon("event_upcoming");
      actions.append(trigger);
    }

    const list = document.querySelector(".aora-cal-entry-list");
    if (!list) return;
    list.querySelectorAll("[data-sp-preference-card]").forEach((node) => node.remove());
    const cards = ownPreferences(selected).map(employeeCard).join("");
    if (cards) list.insertAdjacentHTML("afterbegin", cards);
  }

  function managerItem(item) {
    const employee = emp(item.employeeId);
    return `<article class="u-item-card" data-sp-preference-manager="${esc(item.id)}">
      <h3>${esc(employee?.name || "Mitarbeiter")}</h3>
      <p>${esc(fd(item.date, { weekday: true }))} · ${esc(item.start)}–${esc(item.end)} · ${Number(item.breakMinutes || 0)} Min. Pause${item.note ? ` · ${esc(item.note)}` : ""}</p>
      <div class="u-actions"><button class="u-btn secondary" data-sp-action="review" data-id="${esc(item.id)}">Prüfen</button></div>
    </article>`;
  }

  function managerBoardPanel() {
    const rows = managerPreferences();
    return `<section class="u-day-detail" data-sp-preferences-panel><h2>Schichtwünsche</h2>${rows.map(managerItem).join("") || (typeof uEmpty === "function" ? uEmpty("Keine offenen Schichtwünsche für diesen Standort.") : '<div class="empty">Keine offenen Schichtwünsche für diesen Standort.</div>')}</section>`;
  }

  function legacyManagerPanel() {
    const rows = managerPreferences();
    return `<article class="dashboard-card" data-sp-preferences-panel>
      <div class="dashboard-card-head"><h2>Schichtwünsche <small>${rows.length}</small></h2><span class="status-chip${rows.length ? " black" : ""}">${rows.length ? "Prüfung offen" : "Aktuell"}</span></div>
      <div class="dashboard-body">${rows.map((item) => {
        const employee = emp(item.employeeId);
        return `<div class="duty-row"><div class="initial-bar">${esc(employee?.initials || initials(employee?.name || "Mitarbeiter"))}</div><div class="row-copy"><strong>${esc(employee?.name || "Mitarbeiter")}</strong><small>${esc(fd(item.date, { weekday: true }))} · ${esc(item.start)}–${esc(item.end)} · ${Number(item.breakMinutes || 0)} Min. Pause${item.note ? ` · ${esc(item.note)}` : ""}</small></div><span class="status-chip">Wunsch</span><div class="leave-actions"><button class="btn outline" data-sp-action="review" data-id="${esc(item.id)}">Prüfen</button></div></div>`;
      }).join("") || '<div class="empty">Keine offenen Schichtwünsche für diesen Standort.</div>'}</div>
    </article>`;
  }

  function decorateManagerSchedule() {
    if (!["manager", "owner"].includes(S.accessRole) || S.adminView !== "schedule") return;
    const ids = new Set(managerPreferences().map((item) => item.id));
    document.querySelectorAll('[data-u="request-decision"][data-id]').forEach((button) => {
      if (ids.has(String(button.dataset.id || ""))) button.closest(".u-item-card")?.remove();
    });
    const shell = document.querySelector(".u-schedule-shell");
    if (!shell) return;
    shell.querySelector("[data-sp-preferences-panel]")?.remove();
    shell.insertAdjacentHTML("beforeend", managerBoardPanel());
  }

  function openCreateModal(date) {
    const currentEmployee = S.state?.employees?.find((item) => String(item.id) === employeeId());
    const locationId = currentEmployee?.primaryLocationId || currentEmployee?.locationId || S.session?.locationId;
    const dialog = modal(`${modalHeader("Kalender", "Schichtwunsch abgeben")}<form class="form-grid">
      <div class="field"><label>Datum</label><input class="input" name="date" type="date" min="${currentDate()}" value="${esc(date || currentDate())}" required></div>
      <div class="field"><label>Standort</label><input class="input" value="${esc(loc(locationId)?.name || "Hauptstandort")}" disabled></div>
      <div class="field"><label>Beginn</label><input class="input" name="start" type="time" value="09:00" required></div>
      <div class="field"><label>Ende</label><input class="input" name="end" type="time" value="17:00" required></div>
      <div class="field full"><label>Pause</label><input class="input" name="breakMinutes" type="number" min="0" max="180" step="5" value="30" required></div>
      <div class="field full"><label>Notiz (optional)</label><textarea class="textarea" name="note" maxlength="240" placeholder="z. B. Frühschicht bevorzugt"></textarea></div>
      <div class="field full exception-summary"><strong>Noch keine feste Schicht</strong><p>Der Wunsch wird erst nach Bestätigung durch deinen Manager in den Dienstplan übernommen.</p></div>
      <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Wunsch senden</button></div>
    </form>`);
    dialog.querySelector("form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (S.busy) return;
      S.busy = true;
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const values = new FormData(event.currentTarget);
        const data = await preferenceRequest("create", { preference: {
          date: String(values.get("date") || ""),
          start: String(values.get("start") || ""),
          end: String(values.get("end") || ""),
          breakMinutes: Number(values.get("breakMinutes") || 0),
          note: String(values.get("note") || "").trim()
        } });
        dialog.remove();
        await refresh(data, "Schichtwunsch wurde gesendet.");
      } catch (error) {
        if (submit) submit.disabled = false;
        toast(error?.message || "Schichtwunsch konnte nicht gesendet werden.", "error");
      } finally { S.busy = false; }
    });
  }

  function openReviewModal(id) {
    const item = preferences().find((candidate) => candidate.id === id);
    if (!item) return toast("Schichtwunsch wurde nicht gefunden.", "error");
    const employee = emp(item.employeeId);
    const dialog = modal(`${modalHeader("Dienstplan", "Schichtwunsch prüfen")}<form class="form-grid">
      <div class="field full exception-summary"><strong>${esc(employee?.name || "Mitarbeiter")}</strong><p>${esc(fd(item.date, { weekday: true }))} · ${esc(loc(item.locationId)?.name || "Standort")}${item.note ? ` · ${esc(item.note)}` : ""}</p></div>
      <div class="field"><label>Beginn</label><input class="input" name="start" type="time" value="${esc(item.start)}" required></div>
      <div class="field"><label>Ende</label><input class="input" name="end" type="time" value="${esc(item.end)}" required></div>
      <div class="field full"><label>Pause</label><input class="input" name="breakMinutes" type="number" min="0" max="180" step="5" value="${Number(item.breakMinutes || 0)}" required></div>
      <div class="field full"><label>Notiz an Mitarbeiter (optional)</label><textarea class="textarea" name="reason" maxlength="240"></textarea></div>
      <div class="field full actions"><button type="button" class="btn light" data-sp-action="reject" data-id="${esc(item.id)}">Ablehnen</button><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">In Dienstplan übernehmen</button></div>
    </form>`);
    const form = dialog.querySelector("form");
    form?.addEventListener("submit", async (event) => { event.preventDefault(); await decide(dialog, item, event.currentTarget, "accepted"); });
    dialog.querySelector('[data-sp-action="reject"]')?.addEventListener("click", async () => { await decide(dialog, item, form, "rejected"); });
  }

  async function decide(dialog, item, form, decision) {
    if (S.busy || !form) return;
    S.busy = true;
    form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const values = new FormData(form);
      const data = await preferenceRequest("decide", {
        id: item.id,
        decision,
        reason: String(values.get("reason") || "").trim(),
        shift: decision === "accepted" ? {
          start: String(values.get("start") || item.start),
          end: String(values.get("end") || item.end),
          breakMinutes: Number(values.get("breakMinutes") || item.breakMinutes || 0)
        } : null
      });
      dialog.remove();
      await refresh(data, decision === "accepted" ? "Schicht wurde in den Dienstplan übernommen." : "Schichtwunsch wurde abgelehnt.");
    } catch (error) {
      form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      toast(error?.message || "Entscheidung konnte nicht gespeichert werden.", "error");
    } finally { S.busy = false; }
  }

  async function cancelPreference(id) {
    if (S.busy) return;
    S.busy = true;
    try { await refresh(await preferenceRequest("cancel", { id }), "Schichtwunsch wurde zurückgezogen."); }
    catch (error) { toast(error?.message || "Schichtwunsch konnte nicht zurückgezogen werden.", "error"); }
    finally { S.busy = false; }
  }

  async function refresh(data, message) {
    if (typeof loadState === "function") await loadState(true);
    if (["manager", "owner"].includes(S.accessRole) && typeof uEnsureSchedule === "function") await uEnsureSchedule(true);
    toast(message);
    if (typeof render === "function") render();
    queueMicrotask(decorateEmployeeCalendar);
    queueMicrotask(decorateManagerSchedule);
    return data;
  }

  if (originalEmployeeCalendar) {
    globalThis.uCalendarPage = function shiftPreferenceCalendarPage() {
      const markup = originalEmployeeCalendar();
      queueMicrotask(decorateEmployeeCalendar);
      return markup;
    };
  }

  if (originalAdminView) {
    globalThis.adminView = function shiftPreferenceAdminView() {
      const markup = originalAdminView();
      if (!["manager", "owner"].includes(S.accessRole) || S.adminView !== "schedule") return markup;
      const scheduleBoard = typeof uFlag === "function" && uFlag("schedule_board_v2");
      if (scheduleBoard) {
        queueMicrotask(decorateManagerSchedule);
        return markup;
      }
      return `${markup}${legacyManagerPanel()}`;
    };
  }

  document.addEventListener("click", async (event) => {
    const control = event.target.closest?.("[data-sp-action]");
    if (!control) return;
    const action = control.dataset.spAction;
    if (action === "create") openCreateModal(control.dataset.date || currentDate());
    else if (action === "review") openReviewModal(String(control.dataset.id || ""));
    else if (action === "cancel") await cancelPreference(String(control.dataset.id || ""));
  });

  globalThis.AoraShiftPreferences = Object.freeze({ version: "3.0.0", preferences, decorateEmployeeCalendar, decorateManagerSchedule });
})();
