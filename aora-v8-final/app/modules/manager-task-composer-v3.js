"use strict";

(()=>{
  if(typeof globalThis.uCall!=="function"||typeof globalThis.request!=="function"||typeof globalThis.uHtml!=="function")return;

  const TIMEZONE="Europe/Berlin";
  const MEDIA_FUNCTION=window.__AORA_RUNTIME_CONFIG__?.functions?.taskMedia||CFG.taskMediaFunction||"aora-v8-task-media";

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
  function updateSummary(dialog){
    const output=dialog.querySelector("[data-composer-summary]");
    if(!output)return;
    const count=selectedCount(dialog);
    const date=String(dialog.querySelector('[name="date"]')?.value||"");
    const time=String(dialog.querySelector('[name="dueTime"]')?.value||"");
    const required=Boolean(dialog.querySelector('[name="required"]')?.checked);
    const photoRequired=Boolean(dialog.querySelector('[name="photoEvidenceRequired"]')?.checked);
    const photo=dialog.querySelector('[name="managerReference"]')?.files?.[0];
    const media=[photo?"Referenzfoto":"kein Referenzfoto",photoRequired?"Foto-Nachweis erforderlich":"Foto-Nachweis optional"].join(" · ");
    output.innerHTML=`<strong>${count} Mitarbeiter ausgewählt</strong><span>${required?"Pflichtaufgabe · blockiert Ausstempeln":"Nicht verpflichtend"}${date&&time?` · ${uHtml(date)} ${uHtml(time)}`:""}</span><span>${uHtml(media)}</span>`;
  }

  function closeExisting(){document.querySelector(".u-dialog-backdrop")?.remove()}
  function errorMessage(error){return typeof globalThis.uErrorMessage==="function"?uErrorMessage(error):(error?.message||"Unbekannter Fehler")}

  function photoMime(file){
    const type=String(file?.type||"").toLowerCase();
    if(["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(type))return type;
    const extension=String(file?.name||"").split(".").pop()?.toLowerCase();
    return({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"})[extension]||type;
  }
  function photoExtension(file,mime){
    const extension=String(file?.name||"").split(".").pop()?.replace(/[^a-z0-9]/gi,"").toLowerCase();
    return extension||({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif"})[mime]||"jpg";
  }
  async function sha256(file){
    const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
    return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  async function mediaCall(action,payload={}){
    if(!S.session?.token)throw new Error("Sitzung fehlt.");
    const envelope=await request(MEDIA_FUNCTION,{action,token:S.session.token,...payload});
    if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Foto-Aktion fehlgeschlagen."),{data:envelope});
    return envelope?.data;
  }
  async function uploadReference(taskId,file){
    const mimeType=photoMime(file);
    if(!mimeType.startsWith("image/"))throw new Error("Bitte ein gültiges Foto auswählen.");
    if(file.size<=0||file.size>15*1024*1024)throw new Error("Das Foto darf maximal 15 MB groß sein.");
    const signed=await mediaCall("prepareUpload",{taskId,kind:"manager_reference",mimeType,fileSize:file.size,extension:photoExtension(file,mimeType)});
    const upload=await fetch(signed.signedUrl,{method:"PUT",headers:{"Content-Type":mimeType},body:file});
    if(!upload.ok)throw new Error(`Foto-Upload fehlgeschlagen (HTTP ${upload.status}).`);
    return mediaCall("confirmUpload",{taskId,kind:"manager_reference",path:signed.path,mimeType,fileSize:file.size,sha256:await sha256(file),capturedAt:new Date(file.lastModified||Date.now()).toISOString()});
  }

  globalThis.uManualTaskDialog=async function(){
    const templates=(S.u?.tasks?.managerData?.templates||[]).filter(item=>item.active!==false&&!item.deleted_at);
    if(!templates.length){toast("Bitte zuerst eine aktive Aufgaben-Vorlage erstellen.","warning");return}
    const employees=activeEmployees();
    if(!employees.length){toast("Für diesen Standort wurden keine aktiven Mitarbeiter gefunden.","warning");return}

    closeExisting();
    const today=localDate();
    const backdrop=document.createElement("div");
    backdrop.className="u-dialog-backdrop aora-composer-backdrop";
    backdrop.dataset.idempotencyKey=crypto.randomUUID();
    backdrop.innerHTML=`<form class="u-dialog aora-composer-dialog" data-composer="manual-v3">
      <header class="aora-composer-head"><div><div class="caps muted">Manager · Aufgaben</div><h2>Aufgabe erstellen</h2><p>Aufgabe, Foto, Mitarbeiter, Deadline und Pflichtstatus.</p></div><button type="button" class="aora-composer-close" data-composer-action="close" aria-label="Schließen">×</button></header>
      <div class="aora-composer-body">
        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>1</span><div><strong>Aufgabe</strong><small>Vorlage wählen und bei Bedarf konkretisieren.</small></div></div>
          <div class="u-field"><label>Vorlage</label><select name="templateId" required>${templates.map(item=>`<option value="${uHtml(item.id)}">${uHtml(item.title)}</option>`).join("")}</select></div>
          <div class="u-field"><label>Titel</label><input name="title" maxlength="120" value="${uHtml(templates[0]?.title||"")}" required></div>
          <div class="u-field"><label>Hinweis <span>optional</span></label><textarea name="instructions" rows="3" maxlength="2000" placeholder="Was soll genau gemacht werden?"></textarea></div>
          <div class="aora-composer-media" data-aora-task-media-compose>
            <div class="aora-composer-media-row"><label class="aora-composer-file"><strong>Foto zur Aufgabe</strong><small>Optional · Beispiel oder Referenz für den Mitarbeiter</small><span class="u-btn secondary">Foto auswählen</span><input type="file" name="managerReference" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-aora-manager-reference></label><span class="aora-composer-file-name" data-aora-file-name>Kein Foto ausgewählt</span></div>
            <label class="form-check form-switch"><input class="form-check-input" type="checkbox" name="photoEvidenceRequired" data-aora-photo-required><span class="form-check-label"><strong>Foto-Nachweis vom Mitarbeiter erforderlich</strong><small>Wenn aktiv, kann die Aufgabe erst abgeschlossen werden, nachdem der Mitarbeiter ein Foto des Ergebnisses hochgeladen hat.</small></span></label>
          </div>
        </section>

        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>2</span><div><strong>Mitarbeiter</strong><small>Eine oder mehrere Personen auswählen.</small></div></div>
          <div class="aora-composer-tools"><input type="search" placeholder="Mitarbeiter suchen" data-employee-search><button type="button" class="u-btn secondary" data-composer-action="select-on-shift">Im Dienst auswählen</button></div>
          <div class="aora-composer-people">${employees.map(employee=>`<label class="aora-composer-person" data-name="${uHtml(String(employee.name||"").toLowerCase())}"><input type="checkbox" name="employeeIds" value="${uHtml(employee.id)}"><span class="aora-composer-avatar">${uHtml((String(employee.name||"?").trim().split(/\s+/).map(part=>part[0]).join("").slice(0,2)||"?"))}</span><span><strong>${uHtml(employee.name||employee.id)}</strong><small>${uHtml(employee.role_title||employee.role||"Mitarbeiter")}</small></span><em>Im Dienst</em></label>`).join("")}</div>
          <small class="aora-composer-note">Bei mehreren Personen erhält jede Person ihre eigene Aufgabe. Für gemeinsame Schichtaufgaben nutzt du „Automatische Aufgabe“.</small>
        </section>

        <section class="aora-composer-section"><div class="aora-composer-section-head"><span>3</span><div><strong>Zeit</strong><small>Datum und Deadline.</small></div></div>
          <div class="aora-composer-two"><label class="u-field"><span>Datum</span><span class="aora-native-time"><input name="date" type="date" min="${today}" value="${today}" required></span></label><label class="u-field"><span>Deadline</span><span class="aora-native-time"><input name="dueTime" type="time" value="18:00" required></span></label></div>
        </section>

        <section class="aora-composer-section aora-composer-required"><div class="aora-composer-section-head"><span>4</span><div><strong>Pflichtaufgabe</strong><small>Steuert direkt das Ausstempeln.</small></div></div>
          <label class="form-check form-switch"><input class="form-check-input" type="checkbox" name="required"><span class="form-check-label"><strong>Ausstempeln bis Abschluss sperren</strong><small>Wenn aktiv, kann der Mitarbeiter erst nach Abschluss ausstempeln. Manager-Override bleibt für Ausnahmefälle möglich.</small></span></label>
        </section>

        <div class="aora-composer-summary" data-composer-summary aria-live="polite"></div>
      </div>
      <footer class="aora-composer-footer"><div><span>${uHtml(typeof uLocationName==="function"?uLocationName(S.locationId):S.locationId||"")}</span></div><div><button type="button" class="u-btn secondary" data-composer-action="close">Abbrechen</button><button type="submit" class="u-btn">Aufgabe erstellen</button></div></footer>
    </form>`;
    document.body.appendChild(backdrop);
    const dialog=backdrop.querySelector("form");
    refreshOnShift(dialog,today);
    updateSummary(dialog);

    dialog.addEventListener("input",event=>{
      const target=event.target;
      if(target.matches("[data-employee-search]")){
        const query=String(target.value||"").trim().toLowerCase();
        dialog.querySelectorAll(".aora-composer-person").forEach(row=>row.hidden=Boolean(query&&!String(row.dataset.name||"").includes(query)));
      }
      updateSummary(dialog);
    });
    dialog.addEventListener("change",event=>{
      const target=event.target;
      if(target.matches('[name="templateId"]')){
        const template=templates.find(item=>String(item.id)===String(target.value));
        const title=dialog.querySelector('[name="title"]');
        if(template&&title)title.value=template.title||"";
      }
      if(target.matches('[name="date"]'))refreshOnShift(dialog,String(target.value));
      if(target.matches('[name="managerReference"]')){
        const file=target.files?.[0]||null;
        const output=dialog.querySelector("[data-aora-file-name]");
        if(output)output.textContent=file?file.name:"Kein Foto ausgewählt";
      }
      updateSummary(dialog);
    });
    dialog.addEventListener("click",event=>{
      const button=event.target.closest("[data-composer-action]");
      if(!button)return;
      if(button.dataset.composerAction==="close"){backdrop.remove();return}
      if(button.dataset.composerAction==="select-on-shift"){
        const ids=new Set(String(button.dataset.ids||"").split(",").filter(Boolean));
        dialog.querySelectorAll('[name="employeeIds"]').forEach(input=>input.checked=ids.has(String(input.value)));
        updateSummary(dialog);
      }
    });
    backdrop.addEventListener("click",event=>{if(event.target===backdrop)backdrop.remove()});

    dialog.addEventListener("submit",async event=>{
      event.preventDefault();
      const submit=dialog.querySelector('[type="submit"]');
      submit.disabled=true;
      let created=false;
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
        const photoEvidenceRequired=form.get("photoEvidenceRequired")==="on";
        const referenceFile=form.get("managerReference") instanceof File&&form.get("managerReference").size?form.get("managerReference"):null;
        if(referenceFile){
          const mime=photoMime(referenceFile);
          if(!["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(mime))throw new Error("Bitte JPG, PNG, WebP oder HEIC als Referenzfoto verwenden.");
          if(referenceFile.size>15*1024*1024)throw new Error("Das Referenzfoto darf maximal 15 MB groß sein.");
        }

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
        created=true;
        const taskIds=(result?.taskIds||[]).map(String).filter(Boolean);
        if(taskIds.length){
          await mediaCall("configure",{taskIds,photoEvidenceRequired});
          if(referenceFile){
            for(const taskId of taskIds)await uploadReference(taskId,referenceFile);
          }
        }
        await globalThis.uEnsureManagerTasks?.(true);
        backdrop.remove();
        const mediaText=referenceFile?" · Foto angehängt":"";
        const proofText=photoEvidenceRequired?" · Foto-Nachweis Pflicht":"";
        toast(`${taskIds.length||employeeIds.length} Aufgabe${employeeIds.length===1?"":"n"} erstellt${required?" · Pflicht":""}${mediaText}${proofText}.`,"success");
      }catch(error){
        const prefix=created?"Aufgabe wurde erstellt, aber die Foto-Einstellung konnte nicht vollständig gespeichert werden: ":"";
        toast(prefix+errorMessage(error),"error");
      }finally{submit.disabled=false}
    });
  };
})();
