"use strict";

(() => {
  const VIEW = "time-control";
  const managerHubState = { loading: false, error: "", loadedAt: 0, summary: null, corrections: [] };
  const icon = (value) => value || "";
  const text = (value) => typeof esc === "function" ? esc(value ?? "") : String(value ?? "");
  const nowDate = () => typeof berlin === "function" ? berlin().date : new Date().toISOString().slice(0, 10);
  const formatDate = (value) => {
    if (!value) return "–";
    try { return typeof fd === "function" ? fd(String(value).slice(0, 10), { weekday: true }) : new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC" }); }
    catch { return text(value); }
  };
  const formatDateTime = (value) => {
    if (!value) return "–";
    try { return new Date(value).toLocaleString("de-DE"); }
    catch { return text(value); }
  };
  const duration = (value) => typeof fm === "function" ? fm(Number(value || 0)) : `${Math.floor(Number(value || 0) / 60)}:${String(Number(value || 0) % 60).padStart(2, "0")} Std.`;
  const employeeId = () => String(S.session?.subjectId || S.session?.employeeId || "");
  const entryId = (item) => String(item?.id || item?.time_entry_id || item?.timeEntryId || "");
  const entryEmployeeId = (item) => String(item?.employeeId || item?.employee_id || "");
  const entryLocationId = (item) => String(item?.locationId || item?.location_id || "");
  const entryDate = (item) => String(item?.date || item?.startTime || item?.start_time || "").slice(0, 10);
  const entryStart = (item) => String(item?.start || item?.startTime || item?.start_time || "").slice(11, 16) || String(item?.start || "").slice(0, 5);
  const entryEnd = (item) => String(item?.end || item?.endTime || item?.end_time || "").slice(11, 16) || String(item?.end || "").slice(0, 5);
  const entryBreak = (item) => Number(item?.breakMinutes ?? item?.break_minutes ?? 0);
  const entryMinutes = (item) => {
    if (Number.isFinite(Number(item?.durationMinutes ?? item?.duration_minutes))) return Number(item?.durationMinutes ?? item?.duration_minutes);
    if (typeof activeEntryMinutes === "function") return activeEntryMinutes(item);
    if (entryStart(item) && entryEnd(item) && typeof mins === "function") return mins(entryStart(item), entryEnd(item), entryBreak(item));
    return 0;
  };
  const correctionEmployeeId = (item) => String(item?.employeeId || item?.employee_id || "");
  const correctionEntryId = (item) => String(item?.timeEntryId || item?.time_entry_id || item?.payload?.timeEntryId || "");
  const correctionStatus = (item) => String(item?.status || "pending");
  const correctionRequestedAt = (item) => item?.requestedAt || item?.requested_at || item?.createdAt || item?.created_at || "";
  const correctionReason = (item) => String(item?.reason || item?.payload?.reason || "");
  const correctionProposed = (item) => item?.proposedValue || item?.proposed_value || item?.payload?.proposedValue || {};
  const statusLabel = (status) => ({ pending: "Offen", approved: "Genehmigt", rejected: "Abgelehnt" })[status] || status || "Offen";
  const statusClass = (status) => status === "approved" ? "black" : status === "rejected" ? "danger" : "";
  const safeKioskUrl = () => `/kiosk/dashboard/?workspace=${encodeURIComponent(String(CFG.slug || ""))}`;

  function ownEntries(employee) {
    const id = String(employee?.id || employeeId());
    return (S.state?.timeEntries || [])
      .filter((item) => entryEmployeeId(item) === id)
      .sort((a, b) => `${entryDate(b)}${entryStart(b)}`.localeCompare(`${entryDate(a)}${entryStart(a)}`));
  }
  function ownCorrections(employee) {
    const id = String(employee?.id || employeeId());
    return (S.state?.correctionRequests || [])
      .filter((item) => correctionEmployeeId(item) === id)
      .sort((a, b) => String(correctionRequestedAt(b)).localeCompare(String(correctionRequestedAt(a))));
  }
  function latestCorrectionForEntry(corrections, id) {
    return corrections.find((item) => correctionEntryId(item) === String(id)) || null;
  }
  function proposedText(correction) {
    const proposed = correctionProposed(correction);
    return [
      proposed.date ? formatDate(proposed.date) : "",
      proposed.start || proposed.end ? `${proposed.start || "–"}–${proposed.end || "–"}` : "",
      proposed.breakMinutes !== undefined ? `Pause ${Number(proposed.breakMinutes)} Min.` : ""
    ].filter(Boolean).join(" · ") || "Änderung laut Begründung";
  }
  function clockState(employee, entries) {
    const liveEntry = entries.find((item) => ["live", "paused"].includes(String(item.status || "")));
    const pendingRequest = (S.state?.clockRequests || [])
      .filter((item) => correctionEmployeeId(item) === String(employee.id) && item.status === "pending")
      .sort((a, b) => String(b.createdAt || b.created_at || "").localeCompare(String(a.createdAt || a.created_at || "")))[0];
    if (pendingRequest) return { label: "Bestätigung offen", detail: `${pendingRequest.time || ""} · ${pendingRequest.target || "Stempelvorgang"}`, className: "pending", pendingRequest };
    if (liveEntry?.status === "paused") return { label: "In Pause", detail: `seit ${liveEntry.pauseStartedAt || liveEntry.pause_started_at || entryStart(liveEntry)}`, className: "paused", liveEntry };
    if (liveEntry) return { label: "Eingestempelt", detail: `seit ${entryStart(liveEntry)}`, className: "active", liveEntry };
    return { label: "Nicht eingestempelt", detail: "Keine laufende Arbeitszeit", className: "idle" };
  }

  function employeeCorrectionRow(correction) {
    const status = correctionStatus(correction);
    return `<div class="time-hub-request-row">
      <div><strong>${text(proposedText(correction))}</strong><small>${formatDateTime(correctionRequestedAt(correction))}</small><p>${text(correctionReason(correction))}</p></div>
      <span class="status-chip ${statusClass(status)}">${text(statusLabel(status))}</span>
    </div>`;
  }
  function employeeEntryRow(item, corrections) {
    const correction = latestCorrectionForEntry(corrections, entryId(item));
    const running = !entryEnd(item) || ["live", "paused"].includes(String(item.status || ""));
    return `<article class="time-hub-entry-row" data-time-hub-entry="${text(entryId(item))}">
      <div class="time-hub-entry-date"><strong>${formatDate(entryDate(item))}</strong><small>${text(item.status || (running ? "live" : "completed"))}</small></div>
      <div class="time-hub-entry-time"><strong>${text(entryStart(item) || "–")}–${text(entryEnd(item) || "läuft")}</strong><small>${entryBreak(item)} Min. Pause · ${duration(entryMinutes(item))}</small></div>
      <div class="time-hub-entry-action">
        ${correction ? `<span class="status-chip ${statusClass(correctionStatus(correction))}">${text(statusLabel(correctionStatus(correction)))}</span>` : ""}
        <button class="btn light" data-time-hub-action="correct-entry" data-entry-id="${text(entryId(item))}" ${running ? "disabled" : ""}>Korrigieren</button>
      </div>
    </article>`;
  }
  function employeeTimeHubPage(employee) {
    const entries = ownEntries(employee);
    const corrections = ownCorrections(employee);
    const currentMonth = nowDate().slice(0, 7);
    const monthEntries = entries.filter((item) => entryDate(item).startsWith(currentMonth));
    const worked = monthEntries.reduce((sum, item) => sum + entryMinutes(item), 0);
    const pendingCorrections = corrections.filter((item) => correctionStatus(item) === "pending").length;
    const clock = clockState(employee, entries);
    return `<div class="employee-page-title"><div><div class="caps muted">Arbeitszeit</div><h1>Deine Zeiten</h1></div></div>
      <div class="employee-metrics time-hub-metrics">
        <div class="employee-metric"><div class="metric-icon">${icon(I.clock)}</div><div><label>Dieser Monat</label><strong>${duration(worked)}</strong><small>${monthEntries.length} Einträge</small></div></div>
        <div class="employee-metric"><div class="metric-icon">${icon(I.chart)}</div><div><label>Offene Korrekturen</label><strong>${pendingCorrections}</strong><small>${corrections.length} insgesamt</small></div></div>
      </div>
      <section class="time-hub-card" aria-labelledby="time-hub-title">
        <div class="time-hub-card-head">
          <div><div class="caps">Zeiterfassung zentral</div><h2 id="time-hub-title">Korrektur & Stempeluhr</h2><p>Hier öffnest du die Standort-Stempeluhr, beantragst eine Korrektur und verfolgst den Status deiner Anfragen.</p></div>
          <span class="time-hub-clock-state ${clock.className}"><i></i><strong>${text(clock.label)}</strong><small>${text(clock.detail)}</small></span>
        </div>
        <div class="time-hub-actions">
          <a class="btn" data-time-hub-kiosk-link href="${text(safeKioskUrl())}" target="_blank" rel="noopener noreferrer">Stempeluhr in neuem Tab öffnen</a>
          <button class="btn outline" data-time-hub-action="request-correction">Korrektur beantragen</button>
        </div>
        <p class="time-hub-note">Dein Mitarbeiterkonto bleibt geöffnet. Stempelvorgänge vom Standort-Kiosk bestätigst du anschließend persönlich und mit Standortprüfung in Aora.</p>
        ${clock.pendingRequest ? `<div class="time-hub-alert"><strong>Stempelbestätigung wartet</strong><span>Scrolle nach oben und bestätige oder lehne die sichere Kiosk-Anfrage ab.</span></div>` : ""}
      </section>
      <section class="time-hub-section">
        <div class="time-hub-section-head"><div><div class="caps muted">Nachverfolgung</div><h2>Deine Korrekturanfragen</h2></div><span>${corrections.length}</span></div>
        <div class="time-hub-request-list">${corrections.map(employeeCorrectionRow).join("") || '<div class="empty">Noch keine Korrekturanfrage.</div>'}</div>
      </section>
      <section class="time-hub-section">
        <div class="time-hub-section-head"><div><div class="caps muted">Buchungen</div><h2>Erfasste Arbeitszeiten</h2></div><span>${entries.length}</span></div>
        <div class="time-hub-entry-list">${entries.map((item) => employeeEntryRow(item, corrections)).join("") || '<div class="empty">Noch keine Arbeitszeit erfasst.</div>'}</div>
      </section>`;
  }

  function addNavigation() {
    if (typeof managerNav !== "undefined" && !managerNav.some(([id]) => id === VIEW)) {
      const index = managerNav.findIndex(([id]) => id === "time");
      managerNav.splice(index >= 0 ? index + 1 : 3, 0, [VIEW, "Korrektur & Stempeluhr", I.clock]);
    }
    if (typeof ownerNav !== "undefined" && !ownerNav.some(([id]) => id === VIEW)) {
      const index = ownerNav.findIndex(([id]) => id === "operations");
      ownerNav.splice(index >= 0 ? index + 1 : 5, 0, [VIEW, "Korrektur & Stempeluhr", I.clock]);
    }
  }
  addNavigation();

  async function ensureManagerHub(force = false) {
    if (managerHubState.loading) return;
    if (!force && managerHubState.loadedAt && Date.now() - managerHubState.loadedAt < 15000) return;
    managerHubState.loading = true;
    managerHubState.error = "";
    try {
      const [summary, result] = await Promise.all([
        compliance({ action: "summary" }),
        compliance({ action: "listCorrections" })
      ]);
      managerHubState.summary = summary || {};
      managerHubState.corrections = result?.corrections || [];
      managerHubState.loadedAt = Date.now();
    } catch (error) {
      managerHubState.error = error?.message || "Zeitdaten konnten nicht geladen werden.";
    } finally {
      managerHubState.loading = false;
      if (S.adminView === VIEW && S.session) renderAdmin();
    }
  }
  function managerCorrectionRows() {
    const locationId = String(S.locationId || "");
    return managerHubState.corrections.filter((correction) => {
      const employee = typeof emp === "function" ? emp(correctionEmployeeId(correction)) : null;
      return !locationId || !employee || String(employee.locationId || employee.location_id || "") === locationId;
    });
  }
  function managerCorrectionRow(correction) {
    const employee = typeof emp === "function" ? emp(correctionEmployeeId(correction)) : null;
    const status = correctionStatus(correction);
    return `<div class="time-hub-manager-request">
      <div><strong>${text(employee?.name || correctionEmployeeId(correction) || "Mitarbeiter/in")}</strong><small>${text(proposedText(correction))} · ${formatDateTime(correctionRequestedAt(correction))}</small><p>${text(correctionReason(correction))}</p></div>
      <span class="status-chip ${statusClass(status)}">${text(statusLabel(status))}</span>
      ${status === "pending" ? `<div class="time-hub-manager-decisions"><button class="btn light" data-time-hub-action="decide-correction" data-id="${text(correction.id)}" data-decision="rejected">Ablehnen</button><button class="btn" data-time-hub-action="decide-correction" data-id="${text(correction.id)}" data-decision="approved">Genehmigen</button></div>` : ""}
    </div>`;
  }
  function managerControlPage() {
    queueMicrotask(() => ensureManagerHub());
    const corrections = managerCorrectionRows();
    const entries = (S.state?.timeEntries || []).filter((item) => !S.locationId || entryLocationId(item) === String(S.locationId));
    const clockRequests = (S.state?.clockRequests || []).filter((item) => !S.locationId || String(item.locationId || item.location_id || "") === String(S.locationId));
    const active = entries.filter((item) => ["live", "paused"].includes(String(item.status || "")));
    const pendingClock = clockRequests.filter((item) => item.status === "pending");
    const pendingCorrections = corrections.filter((item) => correctionStatus(item) === "pending");
    const today = nowDate();
    const todayComplete = entries.filter((item) => entryDate(item) === today && entryEnd(item)).length;
    return `<div class="time-hub-admin-hero">
      <div><div class="caps">Zeiterfassung an einem Ort</div><h2>Korrektur & Stempeluhr</h2><p>Stempelstatus kontrollieren, Korrekturen entscheiden und anschließend den aktuellen Arbeitszeitnachweis neu erzeugen.</p></div>
      <button class="btn light" data-time-hub-action="refresh-manager">Aktualisieren</button>
    </div>
    ${managerHubState.error ? `<div class="compliance-alert">${text(managerHubState.error)}</div>` : ""}
    <div class="admin-kpis time-hub-admin-kpis">
      ${adminKpi(I.clock, "Aktiv gestempelt", active.length, "Live oder Pause")}
      ${adminKpi(I.chart, "Offene Korrekturen", pendingCorrections.length, "Benötigen Entscheidung")}
      ${adminKpi(I.news, "Stempelbestätigungen", pendingClock.length, "Warten auf Mitarbeiter")}
      ${adminKpi(I.cal, "Heute vollständig", todayComplete, "Abgeschlossene Buchungen")}
    </div>
    <div class="time-hub-admin-actions">
      <a class="btn" data-time-hub-kiosk-link href="${text(safeKioskUrl())}" target="_blank" rel="noopener noreferrer">Standort-Stempeluhr öffnen</a>
      <button class="btn outline" data-a="admin-view" data-view="approvals">Arbeitszeitnachweise</button>
      <button class="btn light" data-a="admin-view" data-view="compliance">Audit & Exporte</button>
    </div>
    <div class="time-hub-admin-grid">
      <article class="dashboard-card time-hub-admin-wide">
        <div class="dashboard-card-head"><h2>Zeitkorrekturen <small>${corrections.length}</small></h2></div>
        <div class="time-hub-manager-list">${managerHubState.loading && !managerHubState.loadedAt ? '<div class="empty">Korrekturen werden geladen …</div>' : corrections.map(managerCorrectionRow).join("") || '<div class="empty">Keine Korrekturanfragen vorhanden.</div>'}</div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Aktueller Stempelstatus <small>${active.length}</small></h2></div>
        <div class="time-hub-live-list">${active.map((item) => {
          const employee = typeof emp === "function" ? emp(entryEmployeeId(item)) : null;
          return `<div class="time-hub-live-row"><span class="avatar">${text(employee?.initials || (typeof initials === "function" ? initials(employee?.name) : ""))}</span><div><strong>${text(employee?.name || entryEmployeeId(item))}</strong><small>${text(item.status === "paused" ? "Pause" : "Im Dienst")} · seit ${text(entryStart(item))}</small></div><b>${duration(entryMinutes(item))}</b></div>`;
        }).join("") || '<div class="empty">Aktuell niemand eingestempelt.</div>'}</div>
      </article>
      <article class="dashboard-card">
        <div class="dashboard-card-head"><h2>Offene Stempelbestätigungen <small>${pendingClock.length}</small></h2></div>
        <div class="time-hub-live-list">${pendingClock.map((item) => {
          const employee = typeof emp === "function" ? emp(correctionEmployeeId(item)) : null;
          return `<div class="time-hub-clock-request"><div><strong>${text(employee?.name || correctionEmployeeId(item))}</strong><small>${text(item.target || "Stempelvorgang")} · ${text(item.time || "")} · ${formatDateTime(item.createdAt || item.created_at)}</small></div><span class="status-chip">Offen</span></div>`;
        }).join("") || '<div class="empty">Keine offene Stempelbestätigung.</div>'}</div>
      </article>
      <article class="dashboard-card time-hub-admin-wide">
        <div class="dashboard-card-head"><h2>Letzte Zeitbuchungen <small>${entries.length}</small></h2></div>
        <div class="time-hub-entry-list">${entries.slice().sort((a, b) => `${entryDate(b)}${entryStart(b)}`.localeCompare(`${entryDate(a)}${entryStart(a)}`)).slice(0, 20).map((item) => {
          const employee = typeof emp === "function" ? emp(entryEmployeeId(item)) : null;
          return `<div class="time-hub-admin-entry"><div><strong>${text(employee?.name || entryEmployeeId(item))}</strong><small>${formatDate(entryDate(item))} · ${text(entryStart(item))}–${text(entryEnd(item) || "läuft")} · Pause ${entryBreak(item)} Min.</small></div><span class="status-chip ${["live", "paused"].includes(String(item.status || "")) ? "black" : ""}">${text(item.status || "completed")}</span><b>${duration(entryMinutes(item))}</b></div>`;
        }).join("") || '<div class="empty">Keine Zeitbuchungen vorhanden.</div>'}</div>
      </article>
    </div>`;
  }

  const baseEmployeeView = employeeView;
  employeeView = function(employee, view) {
    if (view === "time") return employeeTimeHubPage(employee);
    return baseEmployeeView(employee, view);
  };
  const baseRenderEmployee = renderEmployee;
  renderEmployee = function(...args) {
    const result = baseRenderEmployee(...args);
    document.querySelectorAll(".employee-correction-fab").forEach((node) => node.remove());
    return result;
  };
  const baseAdminTitle = adminTitle;
  adminTitle = function() { return S.adminView === VIEW ? "Korrektur & Stempeluhr" : baseAdminTitle(); };
  const baseAdminView = adminView;
  adminView = function() { return S.adminView === VIEW ? managerControlPage() : baseAdminView(); };

  function prefillCorrection(entry) {
    openCorrectionDialog();
    const dialog = document.getElementById("aora-compliance-dialog");
    if (!dialog?.open) return;
    const select = dialog.querySelector('select[name="timeEntryId"]');
    if (select) select.value = entryId(entry);
    const values = { date: entryDate(entry), start: entryStart(entry), end: entryEnd(entry), breakMinutes: entryBreak(entry) };
    for (const [name, value] of Object.entries(values)) {
      const field = dialog.querySelector(`[name="${name}"]`);
      if (field && value !== undefined && value !== null) field.value = String(value);
    }
  }
  async function decideCorrection(button) {
    const decision = button.dataset.decision;
    const decisionReason = decision === "rejected"
      ? prompt("Begründung für die Ablehnung (mindestens 5 Zeichen):", "")
      : prompt("Optionale Entscheidungsnotiz:", "");
    if (decision === "rejected" && String(decisionReason || "").trim().length < 5) {
      toast("Bei Ablehnung ist eine Begründung erforderlich.", "error");
      return;
    }
    button.disabled = true;
    try {
      await compliance({ action: "decideCorrection", correctionId: button.dataset.id, decision, decisionReason: String(decisionReason || "").trim() });
      toast(decision === "approved" ? "Korrektur wurde genehmigt." : "Korrektur wurde abgelehnt.");
      await loadState(true);
      await ensureManagerHub(true);
    } catch (error) {
      toast(error?.message || "Korrektur konnte nicht entschieden werden.", "error");
      if (button.isConnected) button.disabled = false;
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-time-hub-action]");
    if (!button) return;
    const action = button.dataset.timeHubAction;
    if (action === "request-correction") return openCorrectionDialog();
    if (action === "correct-entry") {
      const entry = (S.state?.timeEntries || []).find((item) => entryId(item) === String(button.dataset.entryId || ""));
      if (entry) prefillCorrection(entry);
      return;
    }
    if (action === "refresh-manager") return ensureManagerHub(true);
    if (action === "decide-correction") return decideCorrection(button);
  });

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "aora-correction-form") return;
    const dialog = event.target.closest("dialog");
    if (!dialog) return;
    const observer = new MutationObserver(async () => {
      if (dialog.open) return;
      observer.disconnect();
      try { await loadState(true); }
      catch (error) { console.warn("Correction state refresh failed", error); }
      if (S.accessRole === "employee" && S.employeeView === "time") renderEmployee();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    setTimeout(() => observer.disconnect(), 30000);
  });
})();
