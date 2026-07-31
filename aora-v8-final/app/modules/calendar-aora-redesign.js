"use strict";

(() => {
  if (typeof globalThis.uCalendarPage !== "function" || typeof globalThis.uCalendarEvents !== "function") return;

  const originalCalendarPage = globalThis.uCalendarPage;
  const state = S.u.calendar;
  state.filters = state.filters || { shifts: true, entries: true, tasks: true, leave: true };
  state.monthMenuOpen = false;
  state.filterMenuOpen = false;

  const icon = (name) => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
  const shortDate = (date) => new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  }).format(uDateObj(date));
  const timeOf = (value) => {
    const text = String(value || "");
    if (/^\d{2}:\d{2}/.test(text)) return text.slice(0, 5);
    const match = text.match(/T(\d{2}:\d{2})/);
    return match ? match[1] : "–";
  };
  const duration = (minutes) => {
    const value = Math.max(0, Number(minutes || 0));
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return `${String(hours).padStart(2, "0")}h ${String(rest).padStart(2, "0")}m`;
  };
  const shiftDuration = (shift) => {
    try { return Math.max(0, mins(shift.start, shift.end, shift.breakMinutes || 0)); }
    catch { return 0; }
  };
  const filteredEvents = (date) => {
    const events = uCalendarEvents(date);
    return {
      shifts: state.filters.shifts ? events.shifts : [],
      entries: state.filters.entries ? events.entries : [],
      tasks: state.filters.tasks ? events.tasks : [],
      leave: state.filters.leave ? events.leave : [],
      notes: events.notes || []
    };
  };
  const sameLeave = (request, date) => {
    if (!request) return false;
    const id = String(request.id || request.request_id || "");
    return uCalendarEvents(date).leave.some((item) => {
      const itemId = String(item.id || item.request_id || "");
      return id && itemId ? itemId === id : item === request;
    });
  };
  const markerHtml = (events) => {
    const markers = [];
    if (events.entries.length) markers.push("time");
    if (events.shifts.length) markers.push(events.shifts.some((item) => item.status === "open") ? "open" : "shift");
    if (events.tasks.length) markers.push("task");
    if (events.leave.length) markers.push("leave");
    return markers.slice(0, 3).map((kind) => `<i class="aora-cal-dot is-${kind}"></i>`).join("");
  };

  function dayCell(date, outside = false) {
    const events = filteredEvents(date);
    const selected = state.selected === date;
    const today = berlin().date === date;
    const leave = events.leave[0];
    const previous = leave && sameLeave(leave, uAdd(date, -1));
    const next = leave && sameLeave(leave, uAdd(date, 1));
    const rangeClass = leave ? ` has-range ${previous ? "range-middle" : "range-start"} ${next ? "range-continues" : "range-end"}` : "";
    const label = `${shortDate(date)}${events.shifts.length ? `, ${events.shifts.length} Schicht` : ""}${events.tasks.length ? `, ${events.tasks.length} Aufgabe` : ""}`;
    return `<button class="aora-cal-day${outside ? " is-outside" : ""}${selected ? " is-selected" : ""}${today ? " is-today" : ""}${rangeClass}" data-u="calendar-day" data-date="${date}" aria-label="${uHtml(label)}" aria-pressed="${selected ? "true" : "false"}">
      <span class="aora-cal-day-number">${Number(date.slice(8, 10))}</span>
      <span class="aora-cal-dots">${markerHtml(events)}</span>
    </button>`;
  }

  function timeCard(entries) {
    const minutes = entries.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
    const first = entries[0];
    const range = first ? `${timeOf(first.startTime || first.start)} – ${timeOf(first.endTime || first.end)}` : "Noch keine Zeit erfasst";
    return `<article class="aora-cal-entry aora-cal-entry-time">
      <div class="aora-cal-entry-icon">${icon("schedule")}</div>
      <div class="aora-cal-entry-copy"><strong>Arbeitszeit</strong><span>${uHtml(range)}</span></div>
      <div class="aora-cal-entry-value">${duration(minutes)}</div>
    </article>`;
  }

  function shiftCard(shift) {
    const statusLabel = ({
      published: "Veröffentlicht",
      pending_confirmation: "Bestätigung offen",
      confirmed: "Bestätigt",
      open: "Offene Schicht",
      completed: "Abgeschlossen",
      cancelled: "Abgesagt"
    })[shift.status] || shift.status || "Geplant";
    return `<article class="aora-cal-entry aora-cal-entry-shift">
      <div class="aora-cal-entry-icon">${icon("calendar_today")}</div>
      <div class="aora-cal-entry-copy"><strong>Schicht</strong><span>${uHtml(shift.start)} – ${uHtml(shift.end)} · ${uHtml(uLocationName(shift.locationId))}</span><small>${uHtml(statusLabel)} · ${Number(shift.breakMinutes || 0)} Min. Pause</small></div>
      <div class="aora-cal-entry-value">${duration(shiftDuration(shift))}</div>
      ${uShiftActions(shift)}
    </article>`;
  }

  function taskCard(task) {
    return `<article class="aora-cal-entry aora-cal-entry-task">
      <div class="aora-cal-entry-icon">${icon("checklist")}</div>
      <div class="aora-cal-entry-copy"><strong>${uHtml(task.task_templates?.title || "Aufgabe")}</strong><span>${uHtml(task.status || "open")} · fällig ${uHtml(timeOf(task.due_at))}</span></div>
      ${uButton("Öffnen", "task-open", `data-id="${task.id}"`, "secondary")}
    </article>`;
  }

  function leaveCard(request) {
    return `<article class="aora-cal-entry aora-cal-entry-leave">
      <div class="aora-cal-entry-icon">${icon("beach_access")}</div>
      <div class="aora-cal-entry-copy"><strong>Abwesenheit</strong><span>${uHtml(request.type || request.payload?.type || "Urlaub")} · ${uHtml(request.status || "beantragt")}</span></div>
    </article>`;
  }

  function daySheet(date) {
    const events = filteredEvents(date);
    const totalMinutes = events.entries.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
    const plannedMinutes = events.shifts.reduce((sum, item) => sum + shiftDuration(item), 0);
    const itemCount = events.entries.length + events.shifts.length + events.tasks.length + events.leave.length;
    return `<section class="aora-cal-sheet" aria-label="Details für ${uHtml(shortDate(date))}">
      <div class="aora-cal-handle" aria-hidden="true"></div>
      <header class="aora-cal-sheet-head">
        <div><h2>${uHtml(shortDate(date))}</h2><p>${itemCount} ${itemCount === 1 ? "Eintrag" : "Einträge"}</p></div>
        <button class="aora-cal-add" data-u="availability" data-date="${date}" aria-label="Verfügbarkeit für diesen Tag setzen">${icon("add")}</button>
      </header>
      <div class="aora-cal-summary" aria-label="Tagesübersicht">
        <div><span>${icon("schedule")}</span><strong>${duration(totalMinutes)}</strong><small>Erfasste Zeit</small></div>
        <div><span>${icon("work")}</span><strong>${events.shifts.length}</strong><small>${events.shifts.length === 1 ? "Schicht" : "Schichten"}</small></div>
        <div><span>${icon("check_circle")}</span><strong>${events.tasks.length}</strong><small>Aufgaben</small></div>
      </div>
      <div class="aora-cal-entry-list">
        ${timeCard(events.entries)}
        ${events.shifts.map(shiftCard).join("")}
        ${events.tasks.map(taskCard).join("")}
        ${events.leave.map(leaveCard).join("")}
        ${!events.shifts.length && !events.tasks.length && !events.leave.length && !events.entries.length ? `<div class="aora-cal-empty">${icon("event_available")}<strong>Keine Einträge</strong><span>Für diesen Tag ist noch nichts geplant.</span></div>` : ""}
      </div>
      <footer class="aora-cal-day-total"><span>Tagesübersicht</span><strong>${duration(totalMinutes || plannedMinutes)}</strong><small>${totalMinutes ? "erfasst" : plannedMinutes ? "geplant" : "frei"}</small></footer>
    </section>`;
  }

  function monthGrid() {
    const cursor = state.cursor || uMonthStart(berlin().date);
    const first = uMonthStart(cursor);
    const gridStart = uStartWeek(first);
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      const date = uAdd(gridStart, index);
      days.push(dayCell(date, date.slice(0, 7) !== first.slice(0, 7)));
    }
    return `<div class="aora-calendar-grid" role="grid" aria-label="${uHtml(uMonthLabel(first))}">
      ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => `<div class="aora-cal-weekday" role="columnheader">${day}</div>`).join("")}
      ${days.join("")}
    </div>${daySheet(state.selected || berlin().date)}`;
  }

  function modeButton(mode, label, symbol) {
    return `<button class="aora-cal-icon-button${state.mode === mode ? " is-active" : ""}" data-u="calendar-mode" data-mode="${mode}" aria-label="${label}" title="${label}">${icon(symbol)}</button>`;
  }

  function filterPopover() {
    if (!state.filterMenuOpen) return "";
    const options = [
      ["shifts", "Schichten", "calendar_today"],
      ["entries", "Arbeitszeit", "schedule"],
      ["tasks", "Aufgaben", "checklist"],
      ["leave", "Abwesenheit", "beach_access"]
    ];
    return `<div class="aora-cal-popover aora-cal-filter-popover" role="dialog" aria-label="Kalender filtern">
      <strong>Im Kalender anzeigen</strong>
      ${options.map(([key, label, symbol]) => `<button data-aora-calendar="filter-toggle" data-filter="${key}" aria-pressed="${state.filters[key] ? "true" : "false"}"><span>${icon(symbol)}${label}</span><i class="${state.filters[key] ? "is-on" : ""}"></i></button>`).join("")}
    </div>`;
  }

  function monthPopover() {
    if (!state.monthMenuOpen) return "";
    return `<div class="aora-cal-popover aora-cal-month-popover" role="dialog" aria-label="Monat wechseln">
      <button data-aora-calendar="month-prev">${icon("chevron_left")}Vorheriger Monat</button>
      <button data-aora-calendar="month-today">${icon("today")}Heute</button>
      <button data-aora-calendar="month-next">Nächster Monat${icon("chevron_right")}</button>
    </div>`;
  }

  function calendarHeader(cursor) {
    return `<header class="aora-cal-header">
      <div class="aora-cal-month-wrap">
        <button class="aora-cal-month" data-aora-calendar="month-menu" aria-expanded="${state.monthMenuOpen ? "true" : "false"}">${uHtml(uMonthLabel(cursor).replace(/\s+\d{4}$/, ""))}${icon("keyboard_arrow_down")}</button>
        ${monthPopover()}
      </div>
      <div class="aora-cal-header-actions">
        ${modeButton("month", "Monatsansicht", "calendar_month")}
        ${modeButton("list", "Listenansicht", "view_list")}
        <div class="aora-cal-filter-wrap"><button class="aora-cal-icon-button${state.filterMenuOpen ? " is-active" : ""}" data-aora-calendar="filter-menu" aria-label="Kalender filtern" aria-expanded="${state.filterMenuOpen ? "true" : "false"}">${icon("filter_alt")}</button>${filterPopover()}</div>
      </div>
    </header>`;
  }

  globalThis.uCalendarPage = function aoraCalendarPage() {
    queueMicrotask(() => uEnsureCalendar());
    if (state.loading && !state.data) return uBusy();
    if (state.error) return `<div class="u-warning-panel">${uHtml(state.error)} ${uButton("Erneut laden", "calendar-reload")}</div>`;
    const cursor = state.cursor || uMonthStart(berlin().date);
    const body = state.mode === "month" ? monthGrid() : state.mode === "week" ? uRenderWeek() : uRenderList();
    return `<section class="aora-calendar-page" data-calendar-mode="${state.mode}">${calendarHeader(cursor)}<div class="aora-cal-body">${body}</div></section>`;
  };

  function moveMonth(offset) {
    const date = uDateObj(uMonthStart(state.cursor || berlin().date));
    date.setUTCMonth(date.getUTCMonth() + offset);
    state.cursor = uMonthStart(uDate(date));
    state.selected = state.cursor;
    state.monthMenuOpen = false;
    render();
    queueMicrotask(() => uEnsureCalendar(true));
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-aora-calendar]");
    if (!control) {
      if ((state.monthMenuOpen || state.filterMenuOpen) && !event.target.closest(".aora-cal-popover")) {
        state.monthMenuOpen = false;
        state.filterMenuOpen = false;
        render();
      }
      return;
    }
    const action = control.dataset.aoraCalendar;
    if (action === "month-menu") {
      state.monthMenuOpen = !state.monthMenuOpen;
      state.filterMenuOpen = false;
      render();
    } else if (action === "filter-menu") {
      state.filterMenuOpen = !state.filterMenuOpen;
      state.monthMenuOpen = false;
      render();
    } else if (action === "filter-toggle") {
      const key = control.dataset.filter;
      if (Object.prototype.hasOwnProperty.call(state.filters, key)) state.filters[key] = !state.filters[key];
      render();
    } else if (action === "month-prev") moveMonth(-1);
    else if (action === "month-next") moveMonth(1);
    else if (action === "month-today") {
      state.cursor = uMonthStart(berlin().date);
      state.selected = berlin().date;
      state.monthMenuOpen = false;
      render();
      queueMicrotask(() => uEnsureCalendar(true));
    }
  });

  globalThis.AoraCalendarRedesign = {
    version: "826",
    originalCalendarPage,
    duration,
    filteredEvents
  };
})();
