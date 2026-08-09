"use strict";

(()=>{
  if(typeof globalThis.request!=="function"||typeof globalThis.uHtml!=="function")return;
  const FUNCTION=window.__AORA_RUNTIME_CONFIG__?.functions?.taskLifecycle||"aora-v8-task-lifecycle";

  function errorMessage(error){return typeof globalThis.uErrorMessage==="function"?uErrorMessage(error):(error?.message||"Unbekannter Fehler")}
  async function lifecycleCall(action,payload={}){
    if(!S.session?.token)throw new Error("Sitzung fehlt.");
    const envelope=await request(FUNCTION,{action,token:S.session.token,...payload});
    if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Aktion fehlgeschlagen."),{data:envelope});
    return envelope?.data;
  }
  function assigneeText(task){
    const ids=[...new Set((task.task_assignments||[]).map(item=>String(item.employee_id||"")).filter(Boolean))];
    if(!ids.length)return"Nicht zugewiesen";
    if(ids.length===1)return typeof globalThis.uEmployeeName==="function"?uEmployeeName(ids[0]):ids[0];
    return`${ids.length} Mitarbeiter`;
  }
  function statusLabel(status){
    return({open:"Offen",in_progress:"In Arbeit",submitted:"Zur Prüfung",completed:"Erledigt",rejected:"Zurückgewiesen",cancelled:"Abgebrochen",waived:"Freigegeben"})[String(status)]||String(status||"");
  }
  function templateCard(template){
    const active=template.active!==false;
    const itemCount=template.task_template_items?.length||0;
    return`<article class="u-item-card aora-lifecycle-card ${active?"":"is-inactive"}">
      <div class="aora-lifecycle-card-head"><div><h3>${uHtml(template.title)}</h3><p>${uHtml(template.category||"custom")} · ${itemCount} Element${itemCount===1?"":"e"}</p></div><span class="pill ${active?"":"muted"}">${active?"Aktiv":"Deaktiviert"}</span></div>
      <div class="u-actions aora-lifecycle-actions">
        <button type="button" class="u-btn secondary" data-u="template-edit" data-id="${uHtml(template.id)}">Bearbeiten</button>
        <button type="button" class="u-btn secondary" data-aora-template-state data-id="${uHtml(template.id)}" data-active="${active?"false":"true"}">${active?"Deaktivieren":"Aktivieren"}</button>
        <button type="button" class="u-btn danger" data-aora-template-delete data-id="${uHtml(template.id)}" data-title="${uHtml(template.title)}">Löschen</button>
      </div>
    </article>`;
  }
  function taskCard(task){
    const status=String(task.status||"");
    const finished=["completed","waived","cancelled"].includes(status);
    const title=typeof globalThis.uTaskTitle==="function"?uTaskTitle(task):(task.payload?.title||task.task_templates?.title||"Aufgabe");
    const due=task.due_at?new Date(task.due_at).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"ohne Deadline";
    return`<article class="u-item-card aora-lifecycle-card"><div class="aora-lifecycle-card-head"><div><h3>${uHtml(title)}</h3><p>${uHtml(statusLabel(status))} · ${uHtml(assigneeText(task))} · ${uHtml(due)}</p></div>${task.blocking_clockout?'<span class="pill">Pflicht</span>':""}</div>
      ${status==="submitted"?`<div class="u-actions">${uButton("Freigeben","task-review",`data-id="${uHtml(task.id)}" data-decision="completed"`,"")}${uButton("Zurückweisen","task-review",`data-id="${uHtml(task.id)}" data-decision="rejected"`,"danger")}</div>`:""}
      <div class="u-actions aora-lifecycle-actions">${!finished?`<button type="button" class="u-btn secondary" data-aora-task-cancel data-id="${uHtml(task.id)}">Abbrechen</button>`:""}<button type="button" class="u-btn danger" data-aora-task-delete data-id="${uHtml(task.id)}" data-title="${uHtml(title)}">Löschen</button></div>
    </article>`;
  }

  globalThis.uManagerTasksPage=function(){
    queueMicrotask(()=>globalThis.uEnsureManagerTasks?.());
    const current=S.u?.tasks?.managerData?.locationId===S.locationId?S.u.tasks.managerData:null;
    if(S.u?.tasks?.managerLoading&&!current)return typeof globalThis.uBusy==="function"?uBusy():"<p>Lädt …</p>";
    const error=S.u?.tasks?.managerError||S.u?.tasks?.error||"";
    if(error&&!current)return`<div class="u-warning-panel aora-task-load-error"><strong>Aufgaben konnten nicht geladen werden.</strong><span>${uHtml(error)}</span><button type="button" class="u-btn" data-aora-task-retry="manager">Erneut laden</button></div>`;
    const data=current||{templates:[],rules:[],tasks:[]};
    const activeTemplates=(data.templates||[]).filter(item=>item.active!==false).length;
    const activeRules=(data.rules||[]).filter(item=>item.active).length;
    const openTasks=(data.tasks||[]).filter(item=>!["completed","waived","cancelled"].includes(String(item.status))).length;
    const reviewTasks=(data.tasks||[]).filter(item=>item.status==="submitted").length;
    return`<section class="u-task-shell aora-task-management-v4">
      ${error?`<div class="u-warning-panel aora-task-load-error"><span>${uHtml(error)}</span><button type="button" class="u-btn secondary" data-aora-task-retry="manager">Erneut laden</button></div>`:""}
      <div class="u-toolbar"><div><div class="caps muted">Aufgaben & Checklisten</div><h1>Aufgaben</h1></div><div class="u-toolbar-group">${uButton("Template erstellen","template-new",``,"secondary")}${uButton("Automatische Aufgabe","rule-new",``,"secondary")}${uButton("Aufgabe erstellen","manual-task-new",``,"")}</div></div>
      <div class="u-board-summary"><div class="u-summary-card"><strong>${activeTemplates}</strong><small>Aktive Templates</small></div><div class="u-summary-card"><strong>${activeRules}</strong><small>Automatisierungen</small></div><div class="u-summary-card"><strong>${openTasks}</strong><small>Offene Aufgaben</small></div><div class="u-summary-card"><strong>${reviewTasks}</strong><small>Zur Prüfung</small></div></div>

      <div class="aora-section-heading"><div><h2>Templates</h2><p>Deaktivieren pausiert abhängige Automatisierungen. Löschen entfernt nur die Vorlage aus der aktiven Verwaltung; historische Aufgaben bleiben erhalten.</p></div></div>
      <div class="u-template-grid">${(data.templates||[]).map(templateCard).join("")||uEmpty("Noch keine Vorlage.")}</div>

      <div class="aora-section-heading"><div><h2>Automatisierungen</h2><p>Eine deaktivierte Vorlage pausiert ihre abhängigen Regeln automatisch.</p></div></div>
      <div class="u-template-grid">${(data.rules||[]).map(rule=>`<article class="u-item-card aora-lifecycle-card ${rule.active?"":"is-inactive"}"><div class="aora-lifecycle-card-head"><div><h3>${uHtml(rule.task_templates?.title||rule.id)}</h3><p>${uHtml(rule.trigger_type)} · ${uHtml(rule.assignment_strategy)}</p></div><span class="pill ${rule.active?"":"muted"}">${rule.active?"Aktiv":"Pausiert"}</span></div></article>`).join("")||uEmpty("Keine Automatisierung.")}</div>

      <div class="aora-section-heading"><div><h2>Aktuelle Aufgaben</h2><p>Offene Aufgaben können abgebrochen werden. Löschen ist ein Soft-Delete und entfernt die Aufgabe aus den normalen Listen, ohne Audit-/Historiedaten hart zu vernichten.</p></div></div>
      <div class="u-template-grid">${(data.tasks||[]).map(taskCard).join("")||uEmpty("Keine Aufgaben.")}</div>
    </section>`;
  };

  document.addEventListener("click",async event=>{
    const stateButton=event.target.closest?.("[data-aora-template-state]");
    const templateDelete=event.target.closest?.("[data-aora-template-delete]");
    const taskCancel=event.target.closest?.("[data-aora-task-cancel]");
    const taskDelete=event.target.closest?.("[data-aora-task-delete]");
    if(!stateButton&&!templateDelete&&!taskCancel&&!taskDelete)return;
    const button=stateButton||templateDelete||taskCancel||taskDelete;
    if(button.disabled)return;
    button.disabled=true;
    try{
      if(stateButton){
        const active=stateButton.dataset.active==="true";
        if(!active&&!confirm("Template deaktivieren? Abhängige Automatisierungen werden pausiert, bestehende Aufgaben bleiben erhalten."))return;
        const result=await lifecycleCall("setTemplateActive",{templateId:String(stateButton.dataset.id||""),active});
        toast(active?`Template aktiviert${result?.resumedRules?` · ${result.resumedRules} Automatisierung(en) fortgesetzt`:""}.`:`Template deaktiviert${result?.pausedRules?` · ${result.pausedRules} Automatisierung(en) pausiert`:""}.`,"success");
      }else if(templateDelete){
        const title=String(templateDelete.dataset.title||"Template");
        if(!confirm(`„${title}“ löschen? Abhängige Automatisierungen werden beendet. Bereits erstellte/abgeschlossene Aufgaben bleiben als Historie erhalten.`))return;
        const result=await lifecycleCall("deleteTemplate",{templateId:String(templateDelete.dataset.id||""),reason:"Vom Manager in der Aufgabenverwaltung gelöscht"});
        toast(`Template gelöscht${result?.deletedRules?` · ${result.deletedRules} Automatisierung(en) beendet`:""}.`,"success");
      }else if(taskCancel){
        if(!confirm("Aufgabe abbrechen? Sie blockiert danach auch das Ausstempeln nicht mehr."))return;
        await lifecycleCall("cancelTask",{taskId:String(taskCancel.dataset.id||""),reason:"Vom Manager in der Aufgabenverwaltung abgebrochen"});
        toast("Aufgabe abgebrochen.","success");
      }else if(taskDelete){
        const title=String(taskDelete.dataset.title||"Aufgabe");
        if(!confirm(`„${title}“ aus den Aufgabenlisten löschen? Die technischen Historiedaten bleiben als Soft-Delete erhalten.`))return;
        await lifecycleCall("deleteTask",{taskId:String(taskDelete.dataset.id||""),reason:"Vom Manager in der Aufgabenverwaltung gelöscht"});
        toast("Aufgabe gelöscht.","success");
      }
      await globalThis.uEnsureManagerTasks?.(true);
    }catch(error){toast(errorMessage(error),"error")}
    finally{button.disabled=false}
  });
})();
