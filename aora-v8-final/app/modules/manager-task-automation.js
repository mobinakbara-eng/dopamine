"use strict";

(()=>{
  if(typeof globalThis.uCall!=="function"||typeof globalThis.uHtml!=="function")return;

  const weekdays=[
    ["mon","Mo"],["tue","Di"],["wed","Mi"],["thu","Do"],["fri","Fr"],["sat","Sa"],["sun","So"]
  ];

  const previousTaskDetail=globalThis.uTaskDetail;
  if(typeof previousTaskDetail==="function"){
    globalThis.uTaskDetail=function(task){
      const html=previousTaskDetail(task);
      if(!task||String(task.payload?.completionMode||"")!=="ANY_ASSIGNEE")return html;
      const finished=["completed","submitted","waived"].includes(String(task.status));
      const completedBy=String(task.payload?.completedBy||"");
      const teamText=finished
        ?completedBy
          ?`Diese gemeinsame Aufgabe wurde bereits von ${uHtml(uEmployeeName(completedBy))} für die Schicht erledigt.`
          :"Diese gemeinsame Aufgabe ist für die Schicht bereits erledigt."
        :"Alle Mitarbeiter, die bei der Auslösung im Dienst waren, sehen dieselbe Aufgabe. Sobald eine Person sie vollständig abschließt, gilt sie für die gesamte Schicht als erledigt.";
      const banner=`<div class="aora-task-instructions"><strong>Gemeinsame Schichtaufgabe</strong><p>${teamText}</p></div>`;
      return html.replace('<section class="aora-task-detail-v2">',`<section class="aora-task-detail-v2">${banner}`);
    };
  }

  function toggleAutomationFields(dialog){
    const trigger=String(dialog.querySelector('[name="triggerType"]')?.value||"fixed_time");
    const assignment=String(dialog.querySelector('[name="strategy"]')?.value||"all_on_shift");
    dialog.querySelector('[data-fixed-time]')?.toggleAttribute("hidden",trigger!=="fixed_time");
    dialog.querySelector('[data-offset-minutes]')?.toggleAttribute("hidden",!["before_shift_end","after_shift_start"].includes(trigger));
    dialog.querySelector('[data-one-person]')?.toggleAttribute("hidden",assignment!=="one_on_shift");
    dialog.querySelector('[data-shared-task]')?.toggleAttribute("hidden",assignment!=="shared_on_shift");
    const summary=dialog.querySelector('[data-automation-summary]');
    if(!summary)return;
    const time=String(dialog.querySelector('[name="time"]')?.value||"22:00");
    const selectedDays=[...dialog.querySelectorAll('[name="weekdays"]:checked')]
      .map(input=>input.closest("label")?.textContent?.trim())
      .filter(Boolean);
    const assignmentText=assignment==="one_on_shift"
      ?"genau 1 Person im Dienst (faire Rotation)"
      :assignment==="shift_leader"
        ?"Schichtleitung im Dienst"
        :assignment==="shared_on_shift"
          ?"alle Personen im Dienst – gemeinsame Aufgabe, 1 Abschluss reicht"
          :"alle Personen im Dienst – jede Person hat ihre eigene Aufgabe";
    const triggerText=trigger==="fixed_time"
      ?`${selectedDays.length===7?"täglich":selectedDays.join(", ")} um ${time}`
      :trigger==="shift_start"
        ?"bei Schichtbeginn"
        :trigger==="shift_end"
          ?"bei Schichtende"
          :trigger==="before_shift_end"
            ?"vor Schichtende"
            :"nach Schichtbeginn";
    summary.innerHTML=`<strong>${uHtml(triggerText)}</strong><span>Aufgabe geht an ${uHtml(assignmentText)}.</span>`;
  }

  globalThis.uRuleDialog=function(){
    const templates=(S.u?.tasks?.managerData?.templates||[]).filter(item=>item.active!==false);
    if(!templates.length){toast("Bitte zuerst eine Aufgaben-Vorlage erstellen.","warning");return}
    document.querySelector(".u-dialog-backdrop")?.remove();
    const backdrop=document.createElement("div");
    backdrop.className="u-dialog-backdrop aora-automation-backdrop";
    backdrop.innerHTML=`<form class="u-dialog aora-automation-dialog">
      <div class="aora-task-create-head"><div><div class="caps muted">Manager · Aufgaben</div><h2>Automatisierung erstellen</h2><p>Aufgaben automatisch nach Zeit und laufender Schicht verteilen.</p></div><button type="button" class="aora-task-close" data-auto-action="close" aria-label="Schließen">×</button></div>
      <div class="aora-automation-body">
        <section class="aora-task-section"><div class="aora-task-section-title"><span>1</span><div><strong>Aufgabe</strong><small>Welche Checkliste soll automatisch erstellt werden?</small></div></div><div class="u-field"><label>Vorlage</label><select name="templateId" required>${templates.map(item=>`<option value="${item.id}">${uHtml(item.title)}</option>`).join("")}</select></div></section>
        <section class="aora-task-section"><div class="aora-task-section-title"><span>2</span><div><strong>Wann?</strong><small>Zum Beispiel jeden Abend um 22:00.</small></div></div><div class="u-form-grid"><div class="u-field"><label>Auslöser</label><select name="triggerType"><option value="fixed_time" selected>Feste Uhrzeit</option><option value="shift_start">Schichtbeginn</option><option value="shift_end">Schichtende</option><option value="before_shift_end">Vor Schichtende</option><option value="after_shift_start">Nach Schichtbeginn</option></select></div><div class="u-field" data-fixed-time><label>Uhrzeit</label><input name="time" type="time" value="22:00" required></div><div class="u-field full" data-fixed-time><label>Tage</label><div class="aora-weekday-picker">${weekdays.map(([value,label])=>`<label><input type="checkbox" name="weekdays" value="${value}" checked><span>${label}</span></label>`).join("")}</div></div><div class="u-field" data-offset-minutes hidden><label>Abstand (Minuten)</label><input name="triggerMinutes" type="number" min="0" max="720" value="30"></div></div></section>
        <section class="aora-task-section"><div class="aora-task-section-title"><span>3</span><div><strong>Wer bekommt sie?</strong><small>Aora prüft die echte Schicht zum Ausführungszeitpunkt.</small></div></div><div class="u-form-grid"><div class="u-field full"><label>Zuweisung</label><select name="strategy"><option value="all_on_shift">Alle im Dienst – jede Person erledigt ihre eigene Aufgabe</option><option value="shared_on_shift">Gemeinsam – alle im Dienst sehen dieselbe Aufgabe, 1 Person erledigt für alle</option><option value="one_on_shift">Genau 1 Person aus der laufenden Schicht</option><option value="shift_leader">Schichtleitung, wenn im Dienst</option></select></div><div class="u-field full" data-shared-task hidden><small class="aora-field-note"><strong>Gemeinsame Schichtaufgabe:</strong> Sind um 22:00 z. B. zwei Personen im Dienst, bekommen beide dieselbe Aufgabe. Sobald eine Person sie vollständig abschließt, wird sie für das gesamte Team als erledigt markiert; die andere Person muss sie nicht mehr durchführen.</small></div><div class="u-field full" data-one-person hidden><label>Auswahl bei mehreren Personen</label><select name="selection"><option value="least_recent" selected>Faire Rotation – wer diese Aufgabe am längsten nicht hatte</option></select><small class="aora-field-note">Sind z. B. um 22:00 zwei Personen im Dienst, erhält nur eine die Aufgabe. Beim nächsten Mal wird bevorzugt die andere Person gewählt.</small></div></div></section>
        <section class="aora-task-section"><div class="aora-task-section-title"><span>4</span><div><strong>Deadline & Abschluss</strong><small>Die bestehende Aora Review- und Clock-out-Logik bleibt erhalten.</small></div></div><div class="u-form-grid"><div class="u-field"><label>Deadline nach Auslösung</label><div class="aora-inline-input"><input name="dueOffset" type="number" min="0" max="1440" value="30"><span>Min.</span></div></div><div class="u-field"><label>Clock-out Policy</label><select name="policy"><option value="WARN_ONLY">Nur warnen</option><option value="MANAGER_OVERRIDE" selected>Manager-Freigabe möglich</option><option value="STRICT_BLOCK">Ausstempeln blockieren</option></select></div></div></section>
        <div class="aora-automation-summary" data-automation-summary></div>
      </div>
      <div class="aora-task-create-footer"><div><strong>Automatische Aufgabe</strong><span>${uHtml(uLocationName(S.locationId))}</span></div><div><button type="button" class="u-btn secondary" data-auto-action="close">Abbrechen</button><button class="u-btn" type="submit">Automatisierung aktivieren</button></div></div>
    </form>`;
    document.body.appendChild(backdrop);
    const dialog=backdrop.querySelector("form");
    toggleAutomationFields(dialog);
    dialog.addEventListener("change",()=>toggleAutomationFields(dialog));
    dialog.addEventListener("input",()=>toggleAutomationFields(dialog));
    dialog.addEventListener("click",event=>{if(event.target.closest('[data-auto-action="close"]'))backdrop.remove()});
    backdrop.addEventListener("click",event=>{if(event.target===backdrop)backdrop.remove()});
    dialog.addEventListener("submit",async event=>{
      event.preventDefault();
      const submit=dialog.querySelector('[type="submit"]');
      submit.disabled=true;
      try{
        const form=new FormData(dialog);
        const triggerType=String(form.get("triggerType")||"fixed_time");
        const strategy=String(form.get("strategy")||"all_on_shift");
        const selectedDays=form.getAll("weekdays").map(String);
        if(triggerType==="fixed_time"&&!selectedDays.length)throw new Error("Bitte mindestens einen Wochentag auswählen.");
        const triggerConfig={
          time:String(form.get("time")||"22:00"),
          weekdays:selectedDays,
          minutes:Number(form.get("triggerMinutes")||0)
        };
        const assignmentConfig=strategy==="one_on_shift"
          ?{selection:String(form.get("selection")||"least_recent")}
          :strategy==="shared_on_shift"
            ?{selection:"on_shift",completionMode:"ANY_ASSIGNEE"}
            :{selection:"on_shift"};
        await uCall("saveTaskRule",{rule:{
          locationId:S.locationId,
          templateId:String(form.get("templateId")||""),
          triggerType,
          triggerConfig,
          assignmentStrategy:strategy,
          assignmentConfig,
          dueOffsetMinutes:Number(form.get("dueOffset")||0),
          clockoutPolicy:String(form.get("policy")||"MANAGER_OVERRIDE"),
          active:true,
          version:1
        }});
        await uEnsureManagerTasks(true);
        backdrop.remove();
        toast("Automatisierung aktiviert.","success");
      }catch(error){toast(uErrorMessage(error),"error")}finally{submit.disabled=false}
    });
  };
})();