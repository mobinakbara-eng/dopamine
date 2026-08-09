"use strict";

(()=>{
  if(typeof globalThis.uCall!=="function"||typeof globalThis.uHtml!=="function")return;

  const TASK_TIMEZONE="Europe/Berlin";
  const priorityLabels={low:"Niedrig",normal:"Normal",high:"Hoch",urgent:"Dringend"};

  function taskEmployees(){
    const source=S.u?.schedule?.data?.employees?.length?S.u.schedule.data.employees:(S.state?.employees||[]);
    const seen=new Set();
    return source.filter(employee=>{
      const id=String(employee.id||"");
      if(!id||seen.has(id))return false;
      const locations=[employee.locationId,employee.location_id,employee.primaryLocationId,employee.primary_location_id].filter(Boolean).map(String);
      if(S.locationId&&locations.length&&!locations.includes(String(S.locationId)))return false;
      if(employee.active===false||employee.deleted_at||employee.deletedAt)return false;
      seen.add(id);
      return true;
    }).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"de"));
  }

  function taskLocalIso(dateText,timeText,timeZone=TASK_TIMEZONE){
    const [year,month,day]=String(dateText).split("-").map(Number);
    const [hour,minute]=String(timeText).split(":").map(Number);
    if(!year||!month||!day||!Number.isFinite(hour)||!Number.isFinite(minute))throw new Error("Datum oder Uhrzeit ist ungültig.");
    const target=Date.UTC(year,month-1,day,hour,minute,0);
    let utc=target;
    const formatter=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    for(let pass=0;pass<2;pass++){
      const parts=formatter.formatToParts(new Date(utc));
      const value=type=>Number(parts.find(part=>part.type===type)?.value||0);
      const represented=Date.UTC(value("year"),value("month")-1,value("day"),value("hour"),value("minute"),value("second"));
      utc+=target-represented;
    }
    return new Date(utc).toISOString();
  }

  function taskTitle(task){
    return String(task?.payload?.title||task?.task_templates?.title||"Aufgabe");
  }
  globalThis.uTaskTitle=taskTitle;

  const originalTaskDetail=globalThis.uTaskDetail;
  globalThis.uTaskDetail=function(task){
    if(!task)return typeof originalTaskDetail==="function"?originalTaskDetail(task):uEmpty("Aufgabe auswählen.");
    const items=task.task_templates?.task_template_items||[];
    const priority=String(task.payload?.priority||"normal");
    const instructions=String(task.payload?.instructions||task.task_templates?.description||"").trim();
    return`<section class="aora-task-detail-v2"><div class="u-toolbar"><div><div class="caps muted">${uHtml(task.task_templates?.category||"Aufgabe")}</div><h2>${uHtml(taskTitle(task))}</h2><div class="aora-task-meta"><span class="aora-priority ${uHtml(priority)}">${uHtml(priorityLabels[priority]||priority)}</span><span>${uHtml(task.status)}</span><span>Fällig ${uHtml(String(task.due_at||"").replace("T"," ").slice(0,16))}</span></div></div></div>${instructions?`<div class="aora-task-instructions"><strong>Hinweis vom Manager</strong><p>${uHtml(instructions)}</p></div>`:""}${items.map(item=>`<div class="u-task-item"><label class="${item.required?"u-required":""}">${uHtml(item.label)}</label>${uTaskField(task,item)}</div>`).join("")||uEmpty("Keine Elemente.")}<div class="u-actions">${!task.task_assignments?.length?uButton("Aufgabe übernehmen","task-claim",`data-id="${task.id}"`,""):""}${uButton("Aufgabe abschließen","task-submit",`data-id="${task.id}"`,"")}</div></section>`;
  };

  async function loadDayContext(date,dialog){
    const shiftSelect=dialog.querySelector('[name="shiftId"]');
    const onShiftButton=dialog.querySelector('[data-task-action="select-on-shift"]');
    if(!shiftSelect)return;
    shiftSelect.innerHTML='<option value="">Ohne Schichtbezug</option>';
    try{
      const board=await uCall("scheduleBoard",{locationId:S.locationId,from:date,to:date});
      const shifts=(board?.shifts||[]).filter(shift=>String(shift.date||shift.shift_date||"").slice(0,10)===date);
      const onShiftIds=new Set();
      for(const shift of shifts){
        const employeeId=String(shift.employeeId||shift.employee_id||"");
        if(employeeId)onShiftIds.add(employeeId);
        const start=String(shift.start||shift.starts_at||"").slice(0,5);
        const end=String(shift.end||shift.ends_at||"").slice(0,5);
        const option=document.createElement("option");
        option.value=String(shift.id||"");
        option.dataset.employeeId=employeeId;
        option.dataset.end=end;
        option.textContent=`${start}–${end} · ${employeeId?uEmployeeName(employeeId):"Offene Schicht"}`;
        shiftSelect.appendChild(option);
      }
      dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>{
        input.closest("label")?.classList.toggle("is-on-shift",onShiftIds.has(String(input.value)));
      });
      if(onShiftButton){onShiftButton.disabled=!onShiftIds.size;onShiftButton.dataset.ids=[...onShiftIds].join(",")}
    }catch(error){
      if(onShiftButton)onShiftButton.disabled=true;
      console.warn("Aora task day context unavailable",error);
    }
  }

  function updateTemplatePreview(dialog,templates){
    const template=templates.find(item=>String(item.id)===String(dialog.querySelector('[name="templateId"]')?.value));
    const preview=dialog.querySelector("[data-task-template-preview]");
    if(!template||!preview)return;
    const count=template.task_template_items?.length||0;
    preview.innerHTML=`<strong>${uHtml(template.title)}</strong><span>${count} Checklist-Punkt${count===1?"":"e"}</span><span>${template.review_required?"Manager-Prüfung":"Direkter Abschluss"}</span><span>${uHtml(template.clockout_policy||"WARN_ONLY")}</span>`;
    const titleInput=dialog.querySelector('[name="title"]');
    if(titleInput&&!titleInput.dataset.touched)titleInput.value=template.title||"";
  }

  globalThis.uManualTaskDialog=async function(){
    const data=S.u?.tasks?.managerData||{templates:[]};
    const templates=(data.templates||[]).filter(item=>item.active!==false);
    if(!templates.length){toast("Bitte zuerst eine Aufgaben-Vorlage erstellen.","warning");return}
    const employees=taskEmployees();
    if(!employees.length){toast("Für diesen Standort wurden keine aktiven Mitarbeiter gefunden.","warning");return}

    document.querySelector(".u-dialog-backdrop")?.remove();
    const today=berlin().date;
    const backdrop=document.createElement("div");
    backdrop.className="u-dialog-backdrop aora-task-create-backdrop";
    backdrop.dataset.idempotencyKey=crypto.randomUUID();
    backdrop.innerHTML=`<form class="u-dialog aora-task-create-dialog"><div class="aora-task-create-head"><div><div class="caps muted">Manager · Aufgaben</div><h2>Aufgabe erstellen</h2><p>Aus einer bestehenden Vorlage eine konkrete Aufgabe zuweisen.</p></div><button type="button" class="aora-task-close" data-task-action="close" aria-label="Schließen">×</button></div><div class="aora-task-create-grid"><div class="aora-task-create-main"><section class="aora-task-section"><div class="aora-task-section-title"><span>1</span><div><strong>Aufgabe</strong><small>Vorlage wählen und bei Bedarf konkretisieren.</small></div></div><div class="u-form-grid"><div class="u-field full"><label>Vorlage</label><select name="templateId" required>${templates.map(item=>`<option value="${item.id}">${uHtml(item.title)}</option>`).join("")}</select></div><div class="u-field full"><label>Titel für diese Aufgabe</label><input name="title" maxlength="120" value="${uHtml(templates[0]?.title||"")}" required></div><div class="u-field full"><label>Hinweis / Arbeitsanweisung <span>optional</span></label><textarea name="instructions" rows="4" maxlength="2000" placeholder="z. B. Terrasse vor 18:00 komplett vorbereiten und Besonderheiten dokumentieren."></textarea></div></div></section><section class="aora-task-section"><div class="aora-task-section-title"><span>2</span><div><strong>Zuständigkeit</strong><small>Eine oder mehrere Personen auswählen.</small></div></div><div class="aora-employee-toolbar"><input type="search" placeholder="Mitarbeiter suchen" data-task-employee-search><div><button type="button" class="u-btn secondary" data-task-action="select-on-shift">Im Dienst auswählen</button><button type="button" class="u-btn secondary" data-task-action="clear-employees">Leeren</button></div></div><div class="aora-employee-list">${employees.map(employee=>`<label class="aora-employee-option" data-employee-name="${uHtml(String(employee.name||"").toLowerCase())}"><input type="checkbox" name="employeeIds" value="${employee.id}"><span class="aora-employee-avatar">${uHtml((String(employee.name||"?").trim().split(/\s+/).map(part=>part[0]).join("").slice(0,2)||"?"))}</span><span><strong>${uHtml(employee.name||employee.id)}</strong><small>${uHtml(employee.role_title||employee.role||"Mitarbeiter")}</small></span><em>Im Dienst</em></label>`).join("")}</div><p class="aora-task-help">Für manuell erstellte Aufgaben ist mindestens eine konkrete Person erforderlich. Dadurch bleibt die Aufgabe im aktuellen Aora-Assignment- und Notification-Flow eindeutig.</p></section></div><aside class="aora-task-create-side"><section class="aora-task-section compact"><div class="aora-task-section-title"><span>3</span><div><strong>Zeit & Priorität</strong><small>Wann und wie wichtig?</small></div></div><div class="u-field"><label>Datum</label><input name="date" type="date" min="${today}" value="${today}" required></div><div class="u-field"><label>Deadline</label><input name="dueTime" type="time" value="18:00" required></div><div class="u-field"><label>Priorität</label><select name="priority"><option value="low">Niedrig</option><option value="normal" selected>Normal</option><option value="high">Hoch</option><option value="urgent">Dringend</option></select></div><div class="u-field"><label>Schichtbezug <span>optional</span></label><select name="shiftId"><option value="">Ohne Schichtbezug</option></select></div></section><section class="aora-task-section compact"><div class="aora-task-section-title"><span>4</span><div><strong>Was passiert danach?</strong><small>Aora übernimmt den bestehenden Workflow.</small></div></div><div class="aora-task-flow"><div><i>1</i><span>Task Instance wird erstellt</span></div><div><i>2</i><span>Ausgewählte Mitarbeiter erhalten die Aufgabe</span></div><div><i>3</i><span>In-App- und Push-Benachrichtigung wird erzeugt</span></div><div><i>4</i><span>Checklist, Review und Clock-out-Regel kommen aus der Vorlage</span></div></div></section><div class="aora-template-preview" data-task-template-preview></div></aside></div><div class="aora-task-create-footer"><div><strong data-task-selected-count>0 Mitarbeiter ausgewählt</strong><span>${uHtml(uLocationName(S.locationId))}</span></div><div><button type="button" class="u-btn secondary" data-task-action="close">Abbrechen</button><button class="u-btn" type="submit">Aufgabe zuweisen</button></div></div></form>`;
    document.body.appendChild(backdrop);
    const dialog=backdrop.querySelector("form");
    const countLabel=dialog.querySelector("[data-task-selected-count]");
    const refreshCount=()=>{const count=dialog.querySelectorAll('[name="employeeIds"]:checked').length;countLabel.textContent=`${count} Mitarbeiter${count===1?"":""} ausgewählt`};

    updateTemplatePreview(dialog,templates);
    loadDayContext(today,dialog);

    dialog.addEventListener("input",event=>{
      const target=event.target;
      if(target.matches('[name="title"]'))target.dataset.touched="true";
      if(target.matches('[name="employeeIds"]'))refreshCount();
      if(target.matches("[data-task-employee-search]")){
        const query=String(target.value||"").trim().toLowerCase();
        dialog.querySelectorAll(".aora-employee-option").forEach(row=>row.hidden=Boolean(query&&!String(row.dataset.employeeName||"").includes(query)));
      }
    });
    dialog.addEventListener("change",event=>{
      const target=event.target;
      if(target.matches('[name="templateId"]'))updateTemplatePreview(dialog,templates);
      if(target.matches('[name="date"]'))loadDayContext(String(target.value),dialog);
      if(target.matches('[name="shiftId"]')){
        const option=target.selectedOptions?.[0];
        const employeeId=String(option?.dataset.employeeId||"");
        const end=String(option?.dataset.end||"");
        if(employeeId){const input=dialog.querySelector(`[name="employeeIds"][value="${CSS.escape(employeeId)}"]`);if(input)input.checked=true}
        if(end)dialog.querySelector('[name="dueTime"]').value=end;
        refreshCount();
      }
    });
    dialog.addEventListener("click",event=>{
      const button=event.target.closest("[data-task-action]");
      if(!button)return;
      const action=button.dataset.taskAction;
      if(action==="close"){backdrop.remove();return}
      if(action==="clear-employees"){dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>input.checked=false);refreshCount();return}
      if(action==="select-on-shift"){
        const ids=new Set(String(button.dataset.ids||"").split(",").filter(Boolean));
        dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>{if(ids.has(String(input.value)))input.checked=true});refreshCount();
      }
    });
    backdrop.addEventListener("click",event=>{if(event.target===backdrop)backdrop.remove()});

    dialog.addEventListener("submit",async event=>{
      event.preventDefault();
      const submit=dialog.querySelector('[type="submit"]');
      submit.disabled=true;
      try{
        const form=new FormData(dialog);
        const employeeIds=form.getAll("employeeIds").map(String).filter(Boolean);
        if(!employeeIds.length)throw new Error("Bitte mindestens einen Mitarbeiter auswählen.");
        const date=String(form.get("date")||"");
        const dueAt=taskLocalIso(date,String(form.get("dueTime")||""));
        if(new Date(dueAt).getTime()<Date.now()-60000)throw new Error("Die Deadline darf nicht in der Vergangenheit liegen.");
        const title=String(form.get("title")||"").trim();
        if(title.length<2)throw new Error("Bitte einen Aufgabentitel eingeben.");
        const result=await uCall("createManualTask",{
          locationId:S.locationId,
          templateId:String(form.get("templateId")||""),
          employeeIds,
          date,
          dueAt,
          shiftId:String(form.get("shiftId")||"")||null,
          title,
          instructions:String(form.get("instructions")||"").trim(),
          priority:String(form.get("priority")||"normal"),
          timezone:TASK_TIMEZONE,
          idempotencyKey:backdrop.dataset.idempotencyKey
        },true);
        await uEnsureManagerTasks(true);
        backdrop.remove();
        toast(`${result?.taskIds?.length||employeeIds.length} Aufgabe${employeeIds.length===1?"":"n"} zugewiesen.`,"success");
      }catch(error){toast(uErrorMessage(error),"error")}finally{submit.disabled=false}
    });
  };
})();
