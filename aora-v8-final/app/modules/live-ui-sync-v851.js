"use strict";

(()=>{
  if(globalThis.__aoraLiveUiSyncV851)return;
  globalThis.__aoraLiveUiSyncV851=true;

  const LIFECYCLE_FUNCTION=window.__AORA_RUNTIME_CONFIG__?.functions?.taskLifecycle||"aora-v8-task-lifecycle";
  const WORKTIME_FUNCTION="aora-v8-worktime-center";
  const WORKTIME_MUTATIONS=new Set(["managerPunch","decideChange","managerRequestChange"]);
  let reconcileTimer=null;
  let reconcileRunning=false;

  function safeError(error){
    return typeof globalThis.uErrorMessage==="function"?uErrorMessage(error):(error?.message||"Aktion fehlgeschlagen.");
  }
  function scheduleReconcile(delay=80){
    clearTimeout(reconcileTimer);
    reconcileTimer=setTimeout(()=>reconcileLiveState().catch(()=>{}),delay);
  }
  async function reconcileLiveState(){
    if(reconcileRunning||!S?.session?.token||S.busy||document.hidden||!navigator.onLine||typeof globalThis.loadState!=="function")return;
    reconcileRunning=true;
    try{await globalThis.loadState(true)}
    finally{reconcileRunning=false}
  }
  globalThis.aoraForceLiveStateRefresh=reconcileLiveState;

  async function lifecycleCall(action,payload={}){
    if(!S?.session?.token)throw new Error("Sitzung fehlt.");
    const envelope=await globalThis.request(LIFECYCLE_FUNCTION,{action,token:S.session.token,...payload});
    if(envelope?.error)throw Object.assign(new Error(envelope.error.message||"Aktion fehlgeschlagen."),{data:envelope});
    return envelope?.data;
  }
  function lifecycleTarget(event){
    const node=event.target?.closest?.("[data-aora-template-state],[data-aora-template-delete],[data-aora-task-cancel],[data-aora-task-delete]");
    return node instanceof HTMLElement?node:null;
  }
  async function handleLifecycleClick(event){
    const button=lifecycleTarget(event);
    if(!button||button.disabled)return;

    // Run before app-level/bubbling handlers. On iOS some nested page handlers were
    // swallowing these clicks before the old document-bubble listener saw them.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const templateState=button.hasAttribute("data-aora-template-state");
    const templateDelete=button.hasAttribute("data-aora-template-delete");
    const taskCancel=button.hasAttribute("data-aora-task-cancel");
    const taskDelete=button.hasAttribute("data-aora-task-delete");
    const id=String(button.dataset.id||"");
    if(!id)return;

    let accepted=true;
    if(templateState&&button.dataset.active!=="true")accepted=window.confirm("Template deaktivieren? Abhängige Automatisierungen werden pausiert, bestehende Aufgaben bleiben erhalten.");
    else if(templateDelete)accepted=window.confirm(`„${String(button.dataset.title||"Template")}“ löschen? Abhängige Automatisierungen werden beendet. Bereits erstellte Aufgaben bleiben als Historie erhalten.`);
    else if(taskCancel)accepted=window.confirm("Aufgabe abbrechen? Sie blockiert danach auch das Ausstempeln nicht mehr.");
    else if(taskDelete)accepted=window.confirm(`„${String(button.dataset.title||"Aufgabe")}“ aus den Aufgabenlisten löschen? Die Historie bleibt erhalten.`);
    if(!accepted)return;

    button.disabled=true;
    button.setAttribute("aria-busy","true");
    try{
      if(templateState){
        const active=button.dataset.active==="true";
        const result=await lifecycleCall("setTemplateActive",{templateId:id,active});
        toast(active?`Template aktiviert${result?.resumedRules?` · ${result.resumedRules} Automatisierung(en) fortgesetzt`:""}.`:`Template deaktiviert${result?.pausedRules?` · ${result.pausedRules} Automatisierung(en) pausiert`:""}.`,"success");
      }else if(templateDelete){
        const result=await lifecycleCall("deleteTemplate",{templateId:id,reason:"Vom Manager in der Aufgabenverwaltung gelöscht"});
        toast(`Template gelöscht${result?.deletedRules?` · ${result.deletedRules} Automatisierung(en) beendet`:""}.`,"success");
      }else if(taskCancel){
        await lifecycleCall("cancelTask",{taskId:id,reason:"Vom Manager in der Aufgabenverwaltung abgebrochen"});
        toast("Aufgabe abgebrochen.","success");
      }else if(taskDelete){
        await lifecycleCall("deleteTask",{taskId:id,reason:"Vom Manager in der Aufgabenverwaltung gelöscht"});
        toast("Aufgabe gelöscht.","success");
      }
      if(typeof globalThis.uEnsureManagerTasks==="function")await globalThis.uEnsureManagerTasks(true);
      else scheduleReconcile(0);
    }catch(error){
      toast(safeError(error),"error");
    }finally{
      if(button.isConnected){button.disabled=false;button.removeAttribute("aria-busy")}
    }
  }
  document.addEventListener("click",handleLifecycleClick,true);

  // managerPunch and the worktime correction actions use a dedicated Edge Function,
  // so they bypass apply() and therefore used to miss the normal workspace broadcast.
  // Refresh the originating screen and notify every active workspace session before
  // returning control to the UI.
  if(typeof globalThis.request==="function"){
    const baseRequest=globalThis.request;
    globalThis.request=async function(functionName,body){
      const result=await baseRequest(functionName,body);
      const action=String(body?.action||"");
      if(functionName===WORKTIME_FUNCTION&&WORKTIME_MUTATIONS.has(action)&&S?.session?.token){
        await reconcileLiveState().catch(()=>{});
        if(typeof globalThis.aoraBroadcastWorkspaceChange==="function"){
          await globalThis.aoraBroadcastWorkspaceChange(
            action==="managerPunch"?"MANAGER_DIRECT_PUNCH":"WORKTIME_MUTATION",
            ["timeEntries","correctionRequests","notifications","audit","compliance"],
            S.revision
          ).catch(()=>{});
        }
      }
      return result;
    };
    window.request=globalThis.request;
  }

  // Safari/PWA can miss a focus transition when returning from the kiosk tab.
  // Reconcile on every foreground signal as an additional deterministic safety net.
  window.addEventListener("pageshow",()=>scheduleReconcile(20));
  window.addEventListener("focus",()=>scheduleReconcile(20));
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleReconcile(20)});
  document.addEventListener("aora:workspace-change",()=>scheduleReconcile(40));
})();
