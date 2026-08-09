"use strict";

(()=>{
  if(typeof globalThis.uCall!=="function"||typeof globalThis.uHtml!=="function")return;

  const TIMEZONE="Europe/Berlin";
  const weekdays=[["mon","Mo"],["tue","Di"],["wed","Mi"],["thu","Do"],["fri","Fr"],["sat","Sa"],["sun","So"]];

  function localDate(){
    if(typeof globalThis.berlin==="function")return berlin().date;
    return new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  }

  function localIso(dateText,timeText,timeZone=TIMEZONE){
    const[year,month,day]=String(dateText).split("-").map(Number);
    const[hour,minute]=String(timeText).split(":").map(Number);
    if(!year||!month||!day||!Number.isFinite(hour)||!Number.isFinite(minute))throw new Error("Datum oder Uhrzeit ist ungültig.");
    const target=Date.UTC(year,month-1,day,hour,minute,0);
    let utc=target;
    const formatter=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    for(let pass=0;pass<3;pass++){
      const parts=formatter.formatToParts(new Date(utc));
      const value=type=>Number(parts.find(part=>part.type===type)?.value||0);
      const represented=Date.UTC(value("year"),value("month")-1,value("day"),value("hour"),value("minute"),value("second"));
      utc+=target-represented;
    }
    return new Date(utc).toISOString();
  }

  function activeEmployees(){
    const source=S.u?.schedule?.data?.employees?.length?S.u.schedule.data.employees:(S.state?.employees||[]);
    const seen=new Set();
    return source.filter(employee=>{
      const employeeId=String(employee.id||"");
      if(!employeeId||seen.has(employeeId)||employee.active===false||employee.deleted_at||employee.deletedAt)return false;
      const locations=[employee.locationId,employee.location_id,employee.primaryLocationId,employee.primary_location_id].filter(Boolean).map(String);
      if(S.locationId&&locations.length&&!locations.includes(String(S.locationId)))return false;
      seen.add(employeeId);
      return true;
    }).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"de"));
  }

  async function refreshOnShift(dialog,date){
    const button=dialog.querySelector('[data-composer-action="select-on-shift"]');
    if(button){button.disabled=true;button.dataset.ids=""}
    dialog.querySelectorAll(".aora-composer-person").forEach(row=>row.classList.remove("is-on-shift"));
    try{
      const board=await uCall("scheduleBoard",{locationId:S.locationId,from:date,to:date});
      const ids=new Set((board?.shifts||[])
        .filter(shift=>String(shift.date||shift.shift_date||"").slice(0,10)===date)
        .map(shift=>String(shift.employeeId||shift.employee_id||""))
        .filter(Boolean));
      dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>input.closest(".aora-composer-person")?.classList.toggle("is-on-shift",ids.has(String(input.value))));
      if(button){button.disabled=!ids.size;button.dataset.ids=[...ids].join(",")}
    }catch(error){
      console.warn("Aora manager task composer: shift context unavailable",error);
    }
  }

  function selectedCount(dialog){return dialog.querySelectorAll('[name="employeeIds"]:checked').length}
  function requiredValue(dialog){return Boolean(dialog.querySelector('[name="required"]')?.checked)}

  function updateManualSummary(dialog){
    const output=dialog.querySelector("[data-composer-summary]");
    if(!output)return;
    const count=selectedCount(dialog);
    const date=String(dialog.querySelector('[name="date"]')?.value||"");
    const time=String(dialog.querySelector('[name="dueTime"]')?.value||"");
    const required=requiredValue(dialog);
    output.innerHTML=`<strong>${count||0} Mitarbeiter${count===1?"":""}</strong><span>${required?"Pflichtaufgabe · Ausstempeln erst nach Abschluss":"Nicht verpflichtend"}${date&&time?` · ${uHtml(date)} ${uHtml(time)}`:""}</span>`;
  }

  function updateAutomationFields(dialog){
    const trigger=String(dialog.querySelector('[name="triggerType"]')?.value||"fixed_time");
    dialog.querySelector("[data-fixed-time]")?.toggleAttribute("hidden",trigger!=="fixed_time");
    dialog.querySelector("[data-before-end]")?.toggleAttribute("hidden",trigger!=="before_shift_end");
    updateAutomationSummary(dialog);
  }

  function updateAutomationSummary(dialog){
    const output=dialog.querySelector("[data-composer-summary]");
    if(!output)return;
    const trigger=String(dialog.querySelector('[name="triggerType"]')?.value||"fixed_time");
    const strategy=String(dialog.querySelector('[name="strategy"]')?.value||"shared_on_shift");
    const required=requiredValue(dialog);
    const time=String(dialog.querySelector('[name="time"]')?.value||"22:00");
    const days=[...dialog.querySelectorAll('[name="weekdays"]:checked')].map(input=>input.closest("label")?.textContent?.trim()).filter(Boolean);
    const timing=trigger==="fixed_time"?`${days.length===7?"Täglich":days.join(", ")} · ${time}`:trigger==="shift_end"?"Bei Schichtende":`${String(dialog.querySelector('[name="triggerMinutes"]')?.value||30)} Min. vor Schichtende`;
    const assignment=strategy==="shared_on_shift"?"Alle sehen sie · 1 Person reicht":strategy==="all_on_shift"?"Jeder im Dienst erledigt sie":"1 Person im Dienst · faire Rotation";
    output.innerHTML=`<strong>${uHtml(timing)}</strong><span>${uHtml(assignment)} · ${required?"Pflichtaufgabe":"nicht verpflichtend"}</span>`;
  }

  function closeExisting(){document.querySelector(".u-dialog-backdrop")?.remove()}

  globalThis.uManualTaskDialog=async function(){
    const templates=(S.u?.tasks?.managerData?.templates||[]).filter(item=>item.active!==false);
    if(!templates.length){toast("Bitte zuerst eine Aufgaben-Vorlage erstellen.","warning");return}
    const employees=activeEmployees();
    if(!employees.length){toast("Für diesen Standort wurden keine aktiven Mitarbeiter gefunden.","warning");return}

    closeExisting();
    const today=localDate();
    const backdrop=document.createElement("div");
    backdrop.className="u-dialog-backdrop aora-composer-backdrop";
    backdrop.dataset.idempotencyKey=crypto.randomUUID();
    backdrop.innerHTML=`<form class="u-dialog aora-composer-dialog" data-composer="manual">
      <header class="aora-composer-head"><div><div class="caps muted">Manager · Aufgaben</div><h2>Aufgabe erstellen</h2><p>Nur das Nötige: Aufgabe, Mitarbeiter, Deadline und ob sie verpflichtend ist.</p></div><button type="button" class="aora-composer-close" data-composer-action="close" aria-label="Schließen">×</button></header>
      <div class="aora-composer-body">
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>1</span><div><strong>Aufgabe</strong><small>Vorlage auswählen und kurz beschreiben.</small></div></div>
          <div class="u-field"><label>Vorlage</label><select name="templateId" required>${templates.map(item=>`<option value="${item.id}">${uHtml(item.title)}</option>`).join("")}</select></div>
          <div class="u-field"><label>Titel</label><input name="title" maxlength="120" value="${uHtml(templates[0]?.title||"")}" required></div>
          <div class="u-field"><label>Hinweis <span>optional</span></label><textarea name="instructions" rows="3" maxlength="2000" placeholder="Was soll genau gemacht werden?"></textarea></div>
        </section>
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>2</span><div><strong>Wer?</strong><small>Eine oder mehrere Personen auswählen.</small></div></div>
          <div class="aora-composer-tools"><input type="search" placeholder="Mitarbeiter suchen" data-employee-search><button type="button" class="u-btn secondary" data-composer-action="select-on-shift">Im Dienst auswählen</button></div>
          <div class="aora-composer-people">${employees.map(employee=>`<label class="aora-composer-person" data-name="${uHtml(String(employee.name||"").toLowerCase())}"><input type="checkbox" name="employeeIds" value="${uHtml(employee.id)}"><span class="aora-composer-avatar">${uHtml((String(employee.name||"?").trim().split(/\s+/).map(part=>part[0]).join("").slice(0,2)||"?"))}</span><span><strong>${uHtml(employee.name||employee.id)}</strong><small>${uHtml(employee.role_title||employee.role||"Mitarbeiter")}</small></span><em>Im Dienst</em></label>`).join("")}</div>
          <small class="aora-composer-note">Bei mehreren ausgewählten Mitarbeitern erhält aktuell jede Person ihre eigene Aufgabe.</small>
        </section>
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>3</span><div><strong>Wann?</strong><small>Datum und Deadline.</small></div></div>
          <div class="aora-composer-two"><label class="u-field"><span>Datum</span><span class="aora-native-time"><input name="date" type="date" min="${today}" value="${today}" required></span></label><label class="u-field"><span>Deadline</span><span class="aora-native-time"><input name="dueTime" type="time" value="18:00" required></span></label></div>
        </section>
        <section class="aora-composer-section aora-composer-required"><div class="aora-composer-section-head"><span>4</span><div><strong>Pflichtaufgabe?</strong><small>Diese Einstellung steuert direkt das Ausstempeln.</small></div></div>
          <label class="form-check form-switch"><input class="form-check-input" type="checkbox" name="required" id="aora-manual-required"><span class="form-check-label"><strong>Als Pflichtaufgabe markieren</strong><small>Wenn aktiv, kann der Mitarbeiter erst ausstempeln, nachdem die Aufgabe abgeschlossen wurde. Ein Manager kann im Ausnahmefall weiterhin freigeben.</small></span></label>
        </section>
        <div class="aora-composer-summary" data-composer-summary aria-live="polite"></div>
      </div>
      <footer class="aora-composer-footer"><div><span>${uHtml(typeof uLocationName==="function"?uLocationName(S.locationId):S.locationId||"")}</span></div><div><button type="button" class="u-btn secondary" data-composer-action="close">Abbrechen</button><button type="submit" class="u-btn">Aufgabe erstellen</button></div></footer>
    </form>`;
    document.body.appendChild(backdrop);
    const dialog=backdrop.querySelector("form");
    refreshOnShift(dialog,today);
    updateManualSummary(dialog);

    dialog.addEventListener("input",event=>{
      const target=event.target;
      if(target.matches("[data-employee-search]")){
        const query=String(target.value||"").trim().toLowerCase();
        dialog.querySelectorAll(".aora-composer-person").forEach(row=>row.hidden=Boolean(query&&!String(row.dataset.name||"").includes(query)));
      }
      updateManualSummary(dialog);
    });
    dialog.addEventListener("change",event=>{
      const target=event.target;
      if(target.matches('[name="templateId"]')){
        const template=templates.find(item=>String(item.id)===String(target.value));
        const title=dialog.querySelector('[name="title"]');
        if(template&&title)title.value=template.title||"";
      }
      if(target.matches('[name="date"]'))refreshOnShift(dialog,String(target.value));
      updateManualSummary(dialog);
    });
    dialog.addEventListener("click",event=>{
      const button=event.target.closest("[data-composer-action]");
      if(!button)return;
      if(button.dataset.composerAction==="close"){backdrop.remove();return}
      if(button.dataset.composerAction==="select-on-shift"){
        const ids=new Set(String(button.dataset.ids||"").split(",").filter(Boolean));
        dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>input.checked=ids.has(String(input.value)));
        updateManualSummary(dialog);
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
        const dueAt=localIso(date,String(form.get("dueTime")||""));
        if(new Date(dueAt).getTime()<Date.now()-60000)throw new Error("Die Deadline darf nicht in der Vergangenheit liegen.");
        const title=String(form.get("title")||"").trim();
        if(title.length<2)throw new Error("Bitte einen Aufgabentitel eingeben.");
        const required=form.get("required")==="on";
        const result=await uCall("createManualTask",{
          locationId:S.locationId,
          templateId:String(form.get("templateId")||""),
          employeeIds,
          date,
          dueAt,
          shiftId:null,
          title,
          instructions:String(form.get("instructions")||"").trim(),
          priority:"normal",
          required,
          timezone:TIMEZONE,
          idempotencyKey:backdrop.dataset.idempotencyKey
        },true);
        await uEnsureManagerTasks(true);
        backdrop.remove();
        toast(`${result?.taskIds?.length||employeeIds.length} Aufgabe${employeeIds.length===1?"":"n"} erstellt${required?" · Pflicht":""}.`,"success");
      }catch(error){toast(uErrorMessage(error),"error")}finally{submit.disabled=false}
    });
  };

  globalThis.uRuleDialog=function(){
    const templates=(S.u?.tasks?.managerData?.templates||[]).filter(item=>item.active!==false);
    if(!templates.length){toast("Bitte zuerst eine Aufgaben-Vorlage erstellen.","warning");return}
    closeExisting();
    const backdrop=document.createElement("div");
    backdrop.className="u-dialog-backdrop aora-composer-backdrop";
    backdrop.innerHTML=`<form class="u-dialog aora-composer-dialog" data-composer="automation">
      <header class="aora-composer-head"><div><div class="caps muted">Manager · Aufgaben</div><h2>Automatische Aufgabe</h2><p>Zum Beispiel täglich um 22:00 an alle, die wirklich im Dienst sind.</p></div><button type="button" class="aora-composer-close" data-composer-action="close" aria-label="Schließen">×</button></header>
      <div class="aora-composer-body">
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>1</span><div><strong>Aufgabe</strong><small>Welche Checkliste soll automatisch erscheinen?</small></div></div><div class="u-field"><label>Vorlage</label><select name="templateId" required>${templates.map(item=>`<option value="${item.id}">${uHtml(item.title)}</option>`).join("")}</select></div></section>
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>2</span><div><strong>Wann?</strong><small>Zeitpunkt festlegen.</small></div></div>
          <div class="u-field"><label>Auslöser</label><select name="triggerType"><option value="fixed_time" selected>Feste Uhrzeit</option><option value="shift_end">Bei Schichtende</option><option value="before_shift_end">Vor Schichtende</option></select></div>
          <div data-fixed-time><div class="aora-composer-two"><label class="u-field"><span>Uhrzeit</span><span class="aora-native-time"><input name="time" type="time" value="22:00"></span></label><div class="u-field"><label>Tage</label><div class="aora-composer-weekdays">${weekdays.map(([value,label])=>`<label><input type="checkbox" name="weekdays" value="${value}" checked><span>${label}</span></label>`).join("")}</div></div></div></div>
          <div class="u-field" data-before-end hidden><label>Wie viele Minuten vorher?</label><input name="triggerMinutes" type="number" min="0" max="720" value="30"></div>
        </section>
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>3</span><div><strong>Wer?</strong><small>Aora prüft beim Auslösen die echte laufende Schicht.</small></div></div>
          <div class="u-field"><label>Zuweisung</label><select name="strategy"><option value="shared_on_shift" selected>Alle im Dienst sehen sie · 1 Person erledigt für alle</option><option value="all_on_shift">Jede Person im Dienst muss sie erledigen</option><option value="one_on_shift">Nur 1 Person im Dienst · faire Rotation</option></select></div>
        </section>
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>4</span><div><strong>Abschluss</strong><small>Deadline und Pflichtstatus.</small></div></div>
          <div class="u-field"><label>Deadline nach Auslösung</label><div class="aora-composer-inline"><input name="dueOffset" type="number" min="0" max="1440" value="30"><span>Min.</span></div></div>
          <label class="form-check form-switch"><input class="form-check-input" type="checkbox" name="required" id="aora-auto-required"><span class="form-check-label"><strong>Pflichtaufgabe</strong><small>Wenn aktiv, kann niemand mit einer noch offenen Pflichtaufgabe ausstempeln. Bei einer gemeinsamen Aufgabe reicht der Abschluss durch eine Person für die ganze Schicht.</small></span></label>
        </section>
        <div class="aora-composer-summary" data-composer-summary aria-live="polite"></div>
      </div>
      <footer class="aora-composer-footer"><div><span>${uHtml(typeof uLocationName==="function"?uLocationName(S.locationId):S.locationId||"")}</span></div><div><button type="button" class="u-btn secondary" data-composer-action="close">Abbrechen</button><button type="submit" class="u-btn">Automatisierung aktivieren</button></div></footer>
    </form>`;
    document.body.appendChild(backdrop);
    const dialog=backdrop.querySelector("form");
    updateAutomationFields(dialog);
    dialog.addEventListener("input",()=>updateAutomationFields(dialog));
    dialog.addEventListener("change",()=>updateAutomationFields(dialog));
    dialog.addEventListener("click",event=>{if(event.target.closest('[data-composer-action="close"]'))backdrop.remove()});
    backdrop.addEventListener("click",event=>{if(event.target===backdrop)backdrop.remove()});
    dialog.addEventListener("submit",async event=>{
      event.preventDefault();
      const submit=dialog.querySelector('[type="submit"]');
      submit.disabled=true;
      try{
        const form=new FormData(dialog);
        const triggerType=String(form.get("triggerType")||"fixed_time");
        const strategy=String(form.get("strategy")||"shared_on_shift");
        const selectedDays=form.getAll("weekdays").map(String);
        if(triggerType==="fixed_time"&&!selectedDays.length)throw new Error("Bitte mindestens einen Wochentag auswählen.");
        const required=form.get("required")==="on";
        const triggerConfig={time:String(form.get("time")||"22:00"),weekdays:selectedDays,minutes:Number(form.get("triggerMinutes")||0)};
        const assignmentConfig=strategy==="one_on_shift"?{selection:"least_recent",required}:{selection:"on_shift",required};
        await uCall("saveTaskRule",{rule:{
          locationId:S.locationId,
          templateId:String(form.get("templateId")||""),
          triggerType,
          triggerConfig,
          assignmentStrategy:strategy,
          assignmentConfig,
          dueOffsetMinutes:Number(form.get("dueOffset")||0),
          clockoutPolicy:required?"MANAGER_OVERRIDE":"WARN_ONLY",
          active:true,
          version:1
        }});
        await uEnsureManagerTasks(true);
        backdrop.remove();
        toast(`Automatisierung aktiviert${required?" · Pflichtaufgabe":""}.`,"success");
      }catch(error){toast(uErrorMessage(error),"error")}finally{submit.disabled=false}
    });
  };

  const previousTaskDetail=globalThis.uTaskDetail;
  if(typeof previousTaskDetail==="function"){
    globalThis.uTaskDetail=function(task){
      const html=previousTaskDetail(task);
      if(!task||typeof html!=="string")return html;
      const badges=[];
      if(task.blocking_clockout)badges.push('<span class="aora-composer-task-badge is-required">Pflichtaufgabe</span>');
      if(task.payload?.completionMode==="ANY_ASSIGNEE")badges.push('<span class="aora-composer-task-badge">Gemeinsam · 1 Person reicht</span>');
      if(!badges.length)return html;
      const marker='<div class="aora-task-meta">';
      return html.includes(marker)?html.replace(marker,`${marker}${badges.join("")}`):html;
    };
  }
})();