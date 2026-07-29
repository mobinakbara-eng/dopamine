"use strict";

const ruleTypeLabels={
  INACTIVE_EMPLOYEE:"Inaktiver Mitarbeiter",
  SHIFT_OVERLAP:"Schichtüberschneidung",
  MAX_DAILY_WORK:"Maximale tägliche Arbeitszeit",
  MAX_WEEKLY_WORK:"Wöchentliche Arbeitszeit",
  MIN_BREAK_AFTER_6H:"Pause nach mehr als 6 Stunden",
  MIN_BREAK_AFTER_9H:"Pause nach mehr als 9 Stunden",
  MIN_REST_BETWEEN_SHIFTS:"Ruhezeit zwischen Schichten",
  OVERNIGHT_SHIFT:"Nachtschicht",
  DST_TRANSITION:"Zeitumstellung",
  MINOR_EMPLOYEE:"Minderjährige Beschäftigte"
};
const severityLabels={hint:"Nur Hinweis",confirm:"Bestätigung erforderlich",block:"Buchung blockieren"};

function ruleLabel(type){return ruleTypeLabels[type]||type}
function ruleMinutes(value){return Number.isFinite(Number(value))?`${Number(value)} Min.`:"–"}
function ruleViolationMarkup(violation){
  return`<article class="rule-violation severity-${esc(violation.severity)}">
    <div class="rule-violation-head"><strong>${esc(ruleLabel(violation.rule))}</strong><span>${esc(severityLabels[violation.severity]||violation.severity)}</span></div>
    <p>${esc(violation.message||"")}</p>
    ${(violation.requiredMinutes!=null||violation.actualMinutes!=null)?`<div class="rule-values"><span>Erforderlich: <b>${ruleMinutes(violation.requiredMinutes)}</b></span><span>Tatsächlich: <b>${ruleMinutes(violation.actualMinutes)}</b></span></div>`:""}
    ${violation.overridden?'<small class="rule-overridden">Ausnahme mit Begründung dokumentiert</small>':""}
  </article>`;
}
function canOverrideEvaluation(evaluation){
  const violations=evaluation?.violations||[];
  return violations.some(item=>item.allowException===true)&&violations.every(item=>item.severity==="hint"||item.overridden===true||item.allowException===true);
}
function shiftRuleDialog(evaluation){
  return new Promise(resolve=>{
    const overrideAllowed=canOverrideEvaluation(evaluation);
    const dialog=modal(`<div class="modal-head"><div><div class="caps muted">Arbeitszeitregeln · Version ${esc(evaluation.ruleSetVersion)}</div><h2>${evaluation.requiresConfirmation?"Bestätigung erforderlich":"Schicht kann nicht gespeichert werden"}</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div>
      <div class="rule-dialog-copy"><p>Die Prüfung wurde im Backend mit dem für diesen Tag gültigen Regelset durchgeführt.</p></div>
      <div class="rule-violations">${(evaluation.violations||[]).map(ruleViolationMarkup).join("")}</div>
      ${overrideAllowed?`<div class="field rule-reason"><label>Begründung der Ausnahme</label><textarea class="textarea" id="rule-override-reason" minlength="5" placeholder="Mindestens 5 Zeichen · tarifliche oder betriebliche Grundlage dokumentieren"></textarea><small>Die Begründung und die verwendete Regelversion werden im Prüfprotokoll gespeichert.</small></div>`:""}
      <div class="actions rule-dialog-actions"><button type="button" class="btn outline" id="rule-change-shift">Schicht ändern</button>${overrideAllowed?'<button type="button" class="btn" id="rule-confirm-override">Ausnahme mit Begründung</button>':""}</div>`);
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.remove();resolve(value)};
    dialog.addEventListener("click",event=>{if(event.target===dialog||event.target.closest('[data-a="close"]'))finish(null)});
    dialog.querySelector("#rule-change-shift")?.addEventListener("click",()=>finish(null));
    dialog.querySelector("#rule-confirm-override")?.addEventListener("click",()=>{
      const reason=String(dialog.querySelector("#rule-override-reason")?.value||"").trim();
      if(reason.length<5)return toast("Bitte eine nachvollziehbare Begründung mit mindestens 5 Zeichen eingeben.","error");
      finish({confirmed:true,reason});
    });
  });
}

function shiftModal(){
  const employees=filteredEmployees();
  if(!employees.length)return toast("Für diesen Standort ist kein aktiver Mitarbeiter verfügbar.","error");
  const dialog=modal(`<div class="modal-head"><div><div class="caps muted">Dienstplan · Backend-Prüfung aktiv</div><h2>Neue Schicht</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div>
    <form class="form-grid" id="rule-shift-form">
      <div class="field full"><label>Mitarbeiter</label><select class="select" name="employeeId">${employees.map(employee=>`<option value="${employee.id}">${esc(employee.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Datum</label><input class="input" type="date" name="date" required value="${berlin().date}"></div>
      <div class="field"><label>Standort</label><select class="select" name="locationId"><option value="${S.locationId}">${esc(loc(S.locationId)?.name)}</option></select></div>
      <div class="field"><label>Beginn</label><input class="input" type="time" name="start" value="08:00" required></div>
      <div class="field"><label>Ende</label><input class="input" type="time" name="end" value="16:00" required></div>
      <div class="field full"><label>Pause</label><input class="input" type="number" name="breakMinutes" value="30" min="0" required></div>
      <div class="field full rule-inline-status" id="rule-inline-status" role="status"><span>Overlap, Pause, Ruhezeit, Overnight und DST werden vor dem Speichern im Backend geprüft.</span></div>
      <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Prüfen und speichern</button></div>
    </form>`);
  const form=dialog.querySelector("form");
  const submit=form.querySelector('[type="submit"]');
  const status=form.querySelector("#rule-inline-status");
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const shift=Object.fromEntries(new FormData(form));
    shift.breakMinutes=Number(shift.breakMinutes);
    submit.disabled=true;
    submit.textContent="Regeln werden geprüft …";
    status.innerHTML="<strong>Backend-Prüfung läuft …</strong>";
    try{
      const preview=await workspace({action:"evaluateShift",shift});
      const evaluation=preview.ruleEvaluation;
      let ruleOverride=null;
      if(!evaluation?.valid){
        status.innerHTML=`<strong>${evaluation.requiresConfirmation?"Begründung erforderlich":"Blockierende Regel erkannt"}</strong>`;
        ruleOverride=await shiftRuleDialog(evaluation);
        if(!ruleOverride)return;
        const confirmed=await workspace({action:"evaluateShift",shift,ruleOverride});
        if(!confirmed.ruleEvaluation?.valid)throw Object.assign(new Error("Die Ausnahme konnte nicht bestätigt werden."),{status:422,data:confirmed});
      }else if((evaluation?.violations||[]).length){
        status.innerHTML=`<strong>${esc(evaluation.violations.map(item=>ruleLabel(item.rule)).join(", "))}</strong><span>Hinweis wurde protokolliert.</span>`;
      }
      const result=await apply({type:"ADD_SHIFT",shift,ruleOverride});
      toast(`Schicht gespeichert · Regelset Version ${result.ruleEvaluation?.ruleSetVersion||evaluation?.ruleSetVersion||"–"}`,"success");
      dialog.remove();
    }catch(error){
      const evaluation=error?.data?.ruleEvaluation;
      if(evaluation){
        const ruleOverride=await shiftRuleDialog(evaluation);
        if(ruleOverride){
          try{
            const result=await apply({type:"ADD_SHIFT",shift,ruleOverride});
            toast(`Schicht gespeichert · Regelset Version ${result.ruleEvaluation?.ruleSetVersion||"–"}`,"success");
            dialog.remove();
          }catch(secondError){toast(secondError.message,"error")}
        }
      }else toast(error.message,"error");
    }finally{
      submit.disabled=false;
      submit.textContent="Prüfen und speichern";
    }
  });
}

const baseSettingsPage=settingsPage;
settingsPage=function(){
  return baseSettingsPage()+`<section class="panel rule-settings-card"><div class="rule-settings-head"><div><div class="caps muted">Versionierte Backend-Regeln</div><h2>Arbeitszeitregeln</h2><p>Änderungen erzeugen künftig eine neue Version. Bereits ausgewertete Schichten behalten ihre ursprüngliche Regelversion.</p></div><button class="btn outline" data-a="work-rule-details">Aktives Regelset anzeigen</button></div><div class="rule-settings-grid"><span><b>10 Std.</b> Tagesmaximum</span><span><b>30 / 45 Min.</b> Pflichtpause</span><span><b>11 Std.</b> Ruhezeit</span><span><b>Aktiv</b> Overlap & DST</span></div><small class="muted">Pilot-Basisregeln sind konfigurierbar und ersetzen keine tarifliche oder rechtliche Einzelfallprüfung.</small></section>`;
};
async function workRuleDetailsModal(){
  const loading=modal(`<div class="modal-head"><div><div class="caps muted">Arbeitszeitregeln</div><h2>Regelset wird geladen …</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><div class="rule-loading">Backend-Version und Regeln werden geprüft.</div>`);
  try{
    const data=await workspace({action:"load"});
    const engine=data.ruleEngine;
    if(!engine)throw new Error("Kein aktives Regelset gefunden.");
    const rows=(engine.rules||[]).map(rule=>`<tr><td>${esc(ruleLabel(rule.rule_type))}</td><td>${rule.threshold_minutes==null?"–":`${rule.threshold_minutes} Min.`}</td><td>${esc(severityLabels[rule.severity]||rule.severity)}</td></tr>`).join("");
    loading.querySelector(".modal").innerHTML=`<div class="modal-head"><div><div class="caps muted">${esc(engine.name)}</div><h2>Regelset Version ${esc(engine.version)}</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><div class="rule-meta"><span>Gültig ab <b>${esc(engine.effective_from)}</b></span><span>Zeitzone <b>${esc(engine.timezone)}</b></span></div><div class="rule-table-wrap"><table class="data-table"><thead><tr><th>Regel</th><th>Grenzwert</th><th>Verhalten</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted">MAX_WEEKLY_WORK und MINOR_EMPLOYEE sind im Pilot nur als Hinweis vorbereitet und werden erst nach vollständiger Durchschnitts- bzw. Alterslogik aktiviert.</p>`;
  }catch(error){
    loading.querySelector(".modal").innerHTML=`<div class="modal-head"><div><div class="caps muted">Arbeitszeitregeln</div><h2>Regelset konnte nicht geladen werden</h2></div><button class="circle-btn" data-a="close">${I.x}</button></div><div class="empty">${esc(error.message)}</div>`;
  }
}
document.addEventListener("click",event=>{
  if(event.target.closest('[data-a="work-rule-details"]'))workRuleDetailsModal();
});