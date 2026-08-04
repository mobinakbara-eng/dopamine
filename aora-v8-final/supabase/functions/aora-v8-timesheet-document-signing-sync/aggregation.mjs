export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function dateObject(date) {
  return new Date(`${date}T12:00:00Z`);
}

export function enumerateDates(from, to) {
  const dates = [];
  const cursor = dateObject(from);
  const end = dateObject(to);
  let guard = 0;
  while (cursor <= end && guard < 370) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  if (guard >= 370) throw Object.assign(new Error("Der Zeitraum darf höchstens 369 Tage umfassen."), { status: 400 });
  return dates;
}

export function timeMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function durationMinutes(item) {
  if (!item?.start || !item?.end) return 0;
  const start = timeMinutes(item.start);
  let end = timeMinutes(item.end);
  if (end < start) end += 1440;
  return Math.max(0, end - start - Math.max(0, Number(item.breakMinutes) || 0));
}

export function leaveRange(item) {
  const start = [item?.startDate, item?.start, item?.from, item?.startsOn, item?.dateFrom, item?.date].find(Boolean);
  const end = [item?.endDate, item?.end, item?.to, item?.endsOn, item?.dateTo, start].find(Boolean);
  return { start: String(start || ""), end: String(end || start || "") };
}

export function leaveType(item) {
  const kind = String(item?.type || item?.kind || item?.reason || "").toLowerCase();
  if (/urlaub|vacation|holiday/.test(kind)) return "Urlaub";
  if (/krank|sick|ill/.test(kind)) return "Krankheit";
  return "Abwesenheit";
}

function entryDate(item) {
  return String(item?.date || item?.startTime || item?.start_time || "").slice(0, 10);
}

function entryStart(item) {
  const explicit = String(item?.start || "");
  if (explicit) return explicit.slice(0, 5);
  return String(item?.startTime || item?.start_time || "").slice(11, 16);
}

function entryEnd(item) {
  const explicit = String(item?.end || "");
  if (explicit) return explicit.slice(0, 5);
  return String(item?.endTime || item?.end_time || "").slice(11, 16);
}

function entryBreak(item) {
  return Math.max(0, Number(item?.breakMinutes ?? item?.break_minutes ?? 0) || 0);
}

function normalizedEntry(item) {
  return {
    ...item,
    date: entryDate(item),
    start: entryStart(item),
    end: entryEnd(item),
    breakMinutes: entryBreak(item),
  };
}

export function aggregateDayEntries(items = []) {
  const entries = items.map(normalizedEntry).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const open = entries.filter(item => !item.end || ["live", "paused"].includes(String(item.status || "")));
  const closed = entries.filter(item => item.end && !["live", "paused"].includes(String(item.status || "")));
  const notes = entries.map(item => normalizeText(item.note || item.comment || "")).filter(Boolean);
  if (entries.length > 1) notes.unshift(`${entries.length} Buchungen`);
  if (open.length) notes.push("Clock-out fehlt");
  return {
    type: open.length ? "Offen" : "Arbeit",
    start: entries.map(item => item.start || "–").join(" / "),
    end: entries.map(item => item.end || "läuft").join(" / "),
    breakMinutes: closed.reduce((sum, item) => sum + entryBreak(item), 0),
    netMinutes: closed.reduce((sum, item) => sum + durationMinutes(item), 0),
    note: [...new Set(notes)].join(" · "),
    entryCount: entries.length,
    openCount: open.length,
  };
}

function externalEmployerName(value) {
  const name = normalizeText(value);
  return !name || /aora/i.test(name) ? "Arbeitgeber" : name;
}

export function buildCanonicalSnapshot({ state, organization, employee, location, locationId, from, to, generatedAt = new Date().toISOString() }) {
  const employeeId = String(employee.id);
  const entries = (state.timeEntries || []).filter(item => String(item.employeeId ?? item.employee_id) === employeeId && entryDate(item) >= from && entryDate(item) <= to);
  const shifts = (state.shifts || []).filter(item => String(item.employeeId ?? item.employee_id) === employeeId && String(item.date) >= from && String(item.date) <= to);
  const leaves = (state.leaveRequests || []).filter(item => {
    if (String(item.employeeId ?? item.employee_id) !== employeeId || String(item.status || "").toLowerCase() === "rejected") return false;
    const range = leaveRange(item);
    return range.start <= to && range.end >= from;
  });
  const dailyTarget = Math.round((Number(employee.weeklyHours || employee.contractHours || employee.weeklyTargetHours || 40) * 60) / 5);
  const rows = enumerateDates(from, to).map(date => {
    const dateEntries = entries.filter(item => entryDate(item) === date);
    const dateShifts = shifts.filter(item => String(item.date) === date);
    const leave = leaves.find(item => {
      const range = leaveRange(item);
      return range.start <= date && range.end >= date;
    });
    if (leave) {
      return {
        date,
        type: leaveType(leave),
        start: "",
        end: "",
        breakMinutes: 0,
        netMinutes: dailyTarget,
        note: normalizeText(leave.note || leave.reason || "Genehmigte Abwesenheit"),
        entryCount: 0,
      };
    }
    if (dateEntries.length) return { date, ...aggregateDayEntries(dateEntries) };
    if (dateShifts.length) {
      const sorted = dateShifts.slice().sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
      return {
        date,
        type: "Fehlzeit",
        start: sorted.map(item => normalizeText(item.start) || "–").join(" / "),
        end: sorted.map(item => normalizeText(item.end) || "–").join(" / "),
        breakMinutes: sorted.reduce((sum, item) => sum + Math.max(0, Number(item.breakMinutes) || 0), 0),
        netMinutes: 0,
        note: sorted.length > 1 ? `Keine Zeitbuchung · ${sorted.length} geplante Schichten` : "Keine Zeitbuchung",
        entryCount: 0,
      };
    }
    return null;
  }).filter(Boolean);
  const workedMinutes = rows.reduce((sum, row) => sum + (["Arbeit", "Offen"].includes(row.type) ? Number(row.netMinutes || 0) : 0), 0);
  const creditedMinutes = rows.reduce((sum, row) => sum + (["Urlaub", "Krankheit", "Abwesenheit"].includes(row.type) ? Number(row.netMinutes || 0) : 0), 0);
  const plannedMinutes = shifts.reduce((sum, item) => sum + durationMinutes(item), 0);
  return {
    schemaVersion: 3,
    generatedAt,
    organization: { id: organization.id, name: externalEmployerName(state.company?.name || organization.name) },
    location: {
      id: locationId,
      name: normalizeText(location?.name || "Standort"),
      address: normalizeText(location?.address || location?.street || ""),
      city: normalizeText(location?.city || ""),
      postalCode: normalizeText(location?.postalCode || location?.zip || ""),
      country: normalizeText(location?.country || "DE"),
    },
    employee: {
      id: employeeId,
      name: normalizeText(employee.name || "Mitarbeiter/in"),
      personnelNumber: normalizeText(employee.personnelNumber || employee.employeeNumber || employee.staffNumber || `A-${employeeId.slice(-5).toUpperCase()}`),
      position: normalizeText(employee.position || employee.jobTitle || employee.role || "Mitarbeiter/in"),
      contract: normalizeText(employee.employmentType || employee.contractType || "Beschäftigt"),
      weeklyHours: Number(employee.weeklyHours || employee.contractHours || 40),
    },
    period: { from, to },
    rows,
    totals: {
      plannedMinutes,
      workedMinutes,
      creditedMinutes,
      totalMinutes: workedMinutes + creditedMinutes,
      differenceMinutes: workedMinutes + creditedMinutes - plannedMinutes,
      workDays: rows.filter(row => ["Arbeit", "Offen"].includes(row.type) && Number(row.netMinutes || 0) > 0).length,
      openDays: rows.filter(row => ["Offen", "Fehlzeit"].includes(row.type)).length,
      entryCount: entries.length,
    },
  };
}

export function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalJsonValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalJsonValue(value));
}
