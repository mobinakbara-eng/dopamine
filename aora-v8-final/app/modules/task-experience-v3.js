"use strict";

(()=>{
  if(typeof globalThis.uCall!=="function"||typeof globalThis.request!=="function")return;

  const EMPLOYEE_PHOTO_ITEM="__aora_employee_photo__";
  const MEDIA_FUNCTION="aora-v8-task-media";
  const pendingManual=new Map();
  const mediaCache=new Map();
  const mediaInFlight=new Map();
  const previousCall=globalThis.uCall;
  const previousTaskDetail=globalThis.uTaskDetail;
  const previousManualTaskDialog=globalThis.uManualTaskDialog;
  const previousManagerPage=globalThis.uManagerTasksPage;

  CFG.taskMediaFunction=window.__AORA_RUNTIME_CONFIG__?.functions?.taskMedia||MEDIA_FUNCTION;

  function errorMessage(error){return typeof globalThis.uErrorMessage==="function"?uErrorMessage(error):(error?.message||"Unbekannter Fehler")}
  function currentTaskRange(){return{from:uAdd(berlin().date,-14),to:uAdd(berlin().date,45)}}
  function photoMime(file){
    const type=String(file?.type||"").toLowerCase();
    if(["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(type))return type;
    const extension=String(file?.name||"").split(".").pop()?.toLowerCase();
    return({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"})[extension]||type
  }
  function photoExtension(file,mime){
    const extension=String(file?.name||"").split(".").pop()?.replace(/[^a-z0-9]/gi,"").toLowerCase();
    return extension||({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif"})[mime]||"jpg"
  }
  async function sha256(file){
    const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
    return[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("")
  }
  async function mediaCall(action,payload={}){
    if(!S.session?.token)throw new Error("Sitzung fehlt.");
    const envelope=await request(CFG.taskMediaFunction,{action,token:S.session.token,...payload});
    if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Foto-Aktion fehlgeschlagen."),{data:envelope});
    return envelope?.data
  }
  async function uploadPhoto(taskId,file,kind){
    if(!file)return null;
    const mimeType=photoMime(file);
    if(!mimeType.startsWith("image/"))throw new Error("Bitte ein Foto auswählen.");
    if(file.size<=0||file.size>15*1024*1024)throw new Error("Das Foto darf maximal 15 MB groß sein.");
    const signed=await mediaCall("prepareUpload",{taskId,kind,mimeType,fileSize:file.size,extension:photoExtension(file,mimeType)});
    const upload=await fetch(signed.signedUrl,{method:"PUT",headers:{"Content-Type":mimeType},body:file});
    if(!upload.ok)throw new Error(`Foto-Upload fehlgeschlagen (HTTP ${upload.status}).`);
    const confirmed=await mediaCall("confirmUpload",{taskId,kind,path:signed.path,mimeType,fileSize:file.size,sha256:await sha256(file),capturedAt:new Date(file.lastModified||Date.now()).toISOString()});
    mediaCache.delete(String(taskId));
    return confirmed
  }

  // Empty task lists and failed reads are terminal states until the user explicitly retries.
  // This prevents render -> request -> error -> render retry storms that previously left iOS on "Lädt …" forever.
  globalThis.uEnsureEmployeeTasks=async function(force=false){
    if(!uFlag("task_automation"))return;
    const range=currentTaskRange();
    const sessionToken=String(S.session?.token||"");
    const organizationId=String(S.session?.organizationId||"");
    const subjectId=String(S.session?.subjectId||"");
    const key=`${organizationId}:${subjectId}:${range.from}:${range.to}`;
    const loadKey=`${sessionToken}:${key}`;
    if(S.u.tasks.loading&&S.u.tasks.employeeLoadingKey===loadKey)return;
    if(!force&&S.u.tasks.employeeAttemptKey===loadKey)return;
    if(force)globalThis.uInvalidateDomainCache?.();
    S.u.tasks.employeeAttemptKey=loadKey;
    S.u.tasks.employeeLoadingKey=loadKey;
    S.u.tasks.loading=true;
    S.u.tasks.error="";
    render();
    try{
      const data=await previousCall("tasks",range);
      if(String(S.session?.token||"")!==sessionToken||String(S.session?.organizationId||"")!==organizationId||String(S.session?.subjectId||"")!==subjectId)return;
      S.u.tasks.data=Array.isArray(data)?data:[];
      S.u.tasks.employeeKey=loadKey;
      if(S.u.tasks.selected&&!S.u.tasks.data.some(item=>item.id===S.u.tasks.selected))S.u.tasks.selected=null;
      if(!S.u.tasks.selected&&S.u.tasks.data.length)S.u.tasks.selected=S.u.tasks.data[0].id;
    }catch(error){
      if(String(S.session?.token||"")!==sessionToken||String(S.session?.organizationId||"")!==organizationId||String(S.session?.subjectId||"")!==subjectId)return;
      S.u.tasks.error=errorMessage(error);
    }finally{
      if(S.u.tasks.employeeLoadingKey===loadKey){
        S.u.tasks.loading=false;
        S.u.tasks.employeeLoadingKey="";
        render();
      }
    }
  };

  if(typeof globalThis.uEnsureManagerTasks==="function"){
    globalThis.uEnsureManagerTasks=async function(force=false){
      if(!uFlag("task_automation")||!S.locationId)return;
      const range=currentTaskRange();
      const sessionToken=String(S.session?.token||"");
      const organizationId=String(S.session?.organizationId||"");
      const subjectId=String(S.session?.subjectId||"");
      const locationId=String(S.locationId||"");
      const key=`${organizationId}:${subjectId}:${locationId}:${range.from}:${range.to}`;
      const loadKey=`${sessionToken}:${key}`;
      if(S.u.tasks.managerLoading&&S.u.tasks.managerLoadingKey===loadKey)return;
      if(!force&&S.u.tasks.managerAttemptKey===loadKey)return;
      if(force)globalThis.uInvalidateDomainCache?.();
      S.u.tasks.managerAttemptKey=loadKey;
      S.u.tasks.managerLoadingKey=loadKey;
      S.u.tasks.managerLoading=true;
      S.u.tasks.managerError="";
      render();
      try{
        const[templates,rules,tasks]=await Promise.all([
          previousCall("taskTemplates",{locationId}),
          previousCall("taskRules",{locationId}),
          previousCall("tasks",{locationId,...range})
        ]);
        if(String(S.session?.token||"")!==sessionToken||String(S.session?.organizationId||"")!==organizationId||String(S.session?.subjectId||"")!==subjectId||String(S.locationId||"")!==locationId)return;
        S.u.tasks.managerData={locationId,templates:templates||[],rules:rules||[],tasks:tasks||[]};
      }catch(error){
        if(String(S.session?.token||"")!==sessionToken||String(S.session?.organizationId||"")!==organizationId||String(S.session?.subjectId||"")!==subjectId||String(S.locationId||"")!==locationId)return;
        S.u.tasks.managerError=errorMessage(error);
      }finally{
        if(S.u.tasks.managerLoadingKey===loadKey){
          S.u.tasks.managerLoading=false;
          S.u.tasks.managerLoadingKey="";
          render();
        }
      }
    };
  }

  if(typeof previousManagerPage==="function"){
    globalThis.uManagerTasksPage=function(){
      queueMicrotask(()=>globalThis.uEnsureManagerTasks?.());
      const currentData=S.u.tasks.managerData?.locationId===S.locationId?S.u.tasks.managerData:null;
      if(S.u.tasks.managerLoading&&!currentData)return uBusy();
      if(S.u.tasks.managerError&&!currentData){
        return`<div class="u-warning-panel aora-task-load-error"><strong>Aufgaben konnten nicht geladen werden.</strong><span>${uHtml(S.u.tasks.managerError)}</span><button type="button" class="u-btn" data-aora-task-retry="manager">Erneut laden</button></div>`;
      }
      const html=previousManagerPage();
      if(S.u.tasks.managerError&&currentData){
        return html.replace('<section class="u-task-shell">',`<section class="u-task-shell"><div class="u-warning-panel aora-task-load-error"><span>${uHtml(S.u.tasks.managerError)}</span><button type="button" class="u-btn secondary" data-aora-task-retry="manager">Erneut laden</button></div>`);
      }
      return html
    };
  }

  // Route completion through the media guard, while all other task actions keep the existing API path.
  globalThis.uCall=async function(action,payload={},feature=false){
    if(action==="submitTask"&&!feature)return mediaCall("submitTask",payload);
    const result=await previousCall(action,payload,feature);
    if(action!=="createManualTask"||!result?.taskIds?.length)return result;
    const key=String(payload.idempotencyKey||"");
    const pending=pendingManual.get(key);
    if(!pending)return result;
    await mediaCall("configure",{taskIds:result.taskIds,photoEvidenceRequired:Boolean(pending.photoEvidenceRequired)});
    if(pending.referenceFile){
      for(const taskId of result.taskIds){
        const id=String(taskId);
        if(pending.uploaded.has(id))continue;
        await uploadPhoto(id,pending.referenceFile,"manager_reference");
        pending.uploaded.add(id);
      }
    }
    pendingManual.delete(key);
    return result
  };

  function renderMediaButtons(taskId,items){
    const manager=items.filter(item=>item.kind==="manager_reference");
    if(!manager.length)return"";
    return`<div class="aora-task-reference"><strong>Foto vom Manager</strong><p>Zu dieser Aufgabe wurde ${manager.length===1?"ein Referenzfoto":"mehr als ein Referenzfoto"} angehängt.</p><div class="u-actions">${manager.map((item,index)=>`<button type="button" class="u-btn secondary" data-aora-media-view data-task="${uHtml(taskId)}" data-evidence="${uHtml(item.id)}">Foto ${index+1} ansehen</button>`).join("")}</div></div>`
  }
  async function hydrateMedia(taskId){
    const id=String(taskId||"");
    if(!id)return;
    const targets=[...document.querySelectorAll(`[data-aora-media-list][data-task="${CSS.escape(id)}"]`)];
    if(!targets.length)return;
    if(mediaCache.has(id)){
      const html=renderMediaButtons(id,mediaCache.get(id));
      targets.forEach(target=>target.innerHTML=html);
      return
    }
    if(mediaInFlight.has(id))return;
    const job=mediaCall("listMedia",{taskId:id}).then(items=>{
      const value=Array.isArray(items)?items:[];
      mediaCache.set(id,value);
      document.querySelectorAll(`[data-aora-media-list][data-task="${CSS.escape(id)}"]`).forEach(target=>target.innerHTML=renderMediaButtons(id,value));
    }).catch(error=>console.warn("Aora task media list unavailable",error)).finally(()=>mediaInFlight.delete(id));
    mediaInFlight.set(id,job);
    await job
  }

  if(typeof previousTaskDetail==="function"){
    globalThis.uTaskDetail=function(task){
      let html=previousTaskDetail(task);
      if(!task)return html;
      const proofRequired=task.payload?.photoEvidenceRequired===true;
      const proofDone=(task.task_evidence||[]).some(file=>String(file.template_item_id)===EMPLOYEE_PHOTO_ITEM&&!file.deleted_at);
      const proof=proofRequired?`<div class="aora-task-photo-proof ${proofDone?"done":""}"><div><strong>Foto-Nachweis erforderlich</strong><p>${proofDone?"Foto wurde hochgeladen. Du kannst die Aufgabe abschließen.":"Bitte fotografiere das Ergebnis, bevor du die Aufgabe abschließt."}</p></div>${proofDone?'<span class="aora-photo-ok">✓ Hochgeladen</span>':`<label class="aora-photo-upload"><span>Foto aufnehmen / auswählen</span><input type="file" accept="image/*" capture="environment" data-aora-photo-proof data-task="${uHtml(task.id)}"></label>`}</div>`:"";
      const reference=`<div data-aora-media-list data-task="${uHtml(task.id)}"></div>`;
      if(html.includes('<div class="u-actions">'))html=html.replace('<div class="u-actions">',`${reference}${proof}<div class="u-actions">`);
      else html=html.replace("</section>",`${reference}${proof}</section>`);
      queueMicrotask(()=>hydrateMedia(task.id));
      return html
    };
  }

  if(typeof previousManualTaskDialog==="function"){
    globalThis.uManualTaskDialog=async function(...args){
      await previousManualTaskDialog(...args);
      const backdrop=document.querySelector(".aora-composer-backdrop");
      const dialog=backdrop?.querySelector('form[data-composer="manual"]');
      if(!dialog||dialog.querySelector("[data-aora-task-media-compose]"))return;
      const key=String(backdrop.dataset.idempotencyKey||crypto.randomUUID());
      backdrop.dataset.idempotencyKey=key;
      const state={photoEvidenceRequired:false,referenceFile:null,uploaded:new Set()};
      pendingManual.set(key,state);
      const firstSection=dialog.querySelector(".aora-composer-section");
      const media=document.createElement("div");
      media.className="aora-composer-media";
      media.dataset.aoraTaskMediaCompose="";
      media.innerHTML=`<div class="aora-composer-media-row"><label class="aora-composer-file"><strong>Foto zur Aufgabe</strong><small>Optional · z. B. wie das Ergebnis aussehen soll</small><span class="u-btn secondary">Foto auswählen</span><input type="file" accept="image/*" data-aora-manager-reference></label><span class="aora-composer-file-name" data-aora-file-name>Kein Foto ausgewählt</span></div><label class="form-check form-switch"><input class="form-check-input" type="checkbox" data-aora-photo-required><span class="form-check-label"><strong>Foto-Nachweis vom Mitarbeiter erforderlich</strong><small>Die Aufgabe kann erst abgeschlossen werden, nachdem ein Foto hochgeladen wurde.</small></span></label>`;
      firstSection?.appendChild(media);
      const fileInput=media.querySelector("[data-aora-manager-reference]");
      const requiredInput=media.querySelector("[data-aora-photo-required]");
      const fileName=media.querySelector("[data-aora-file-name]");
      fileInput?.addEventListener("change",()=>{
        state.referenceFile=fileInput.files?.[0]||null;
        if(fileName)fileName.textContent=state.referenceFile?state.referenceFile.name:"Kein Foto ausgewählt";
      });
      requiredInput?.addEventListener("change",()=>{state.photoEvidenceRequired=Boolean(requiredInput.checked)});
    };
  }

  document.addEventListener("change",event=>{
    const input=event.target.closest?.("[data-aora-photo-proof]");
    if(!input)return;
    const file=input.files?.[0];
    if(!file)return;
    input.disabled=true;
    uploadPhoto(String(input.dataset.task||""),file,"employee_proof").then(async()=>{
      toast("Foto sicher hochgeladen.","success");
      await globalThis.uEnsureEmployeeTasks?.(true);
    }).catch(error=>toast(errorMessage(error),"error")).finally(()=>{input.disabled=false});
  });

  document.addEventListener("click",event=>{
    const retry=event.target.closest?.("[data-aora-task-retry]");
    if(retry){
      if(retry.dataset.aoraTaskRetry==="manager")globalThis.uEnsureManagerTasks?.(true);
      else globalThis.uEnsureEmployeeTasks?.(true);
      return
    }
    const view=event.target.closest?.("[data-aora-media-view]");
    if(!view)return;
    const popup=window.open("","_blank");
    if(popup)popup.document.body.textContent="Foto wird geladen …";
    mediaCall("viewMedia",{taskId:String(view.dataset.task||""),evidenceId:String(view.dataset.evidence||"")}).then(result=>{
      if(popup)popup.location.href=result.url;
      else window.location.href=result.url;
    }).catch(error=>{popup?.close();toast(errorMessage(error),"error")});
  });
})();
