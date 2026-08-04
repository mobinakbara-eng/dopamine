"use strict";

(function installOfflineApplyGuard(){
  if(window.__aoraOfflineApplyGuardInstalled)return;
  window.__aoraOfflineApplyGuardInstalled=true;
  if(typeof apply!=="function")return;

  const onlineApply=apply;
  const guardedApply=async function(event){
    const shouldQueueDirectly=
      event?.type==="KIOSK_TRANSITION"&&
      navigator.onLine===false&&
      S?.accessRole==="kiosk"&&
      typeof preparePunchEvent==="function"&&
      typeof enqueueOfflinePunch==="function";

    if(!shouldQueueDirectly)return onlineApply(event);
    if(S.busy){
      const error=new Error("Eine Aktion wird bereits verarbeitet.");
      error.status=409;
      throw error;
    }

    const prepared=preparePunchEvent(event);
    S.busy=true;
    try{
      await enqueueOfflinePunch(prepared.event);
      if(typeof renderOfflinePunchStatus==="function")await renderOfflinePunchStatus();
      if(typeof toast==="function")toast("Offline sicher gespeichert. Die Buchung wird automatisch synchronisiert, sobald die Verbindung zurück ist.","success");
      return{
        pending:true,
        offline:true,
        eventId:prepared.event.eventId,
        message:"Verschlüsselt auf diesem Gerät gespeichert."
      };
    }finally{
      S.busy=false;
    }
  };

  apply=guardedApply;
  window.apply=guardedApply;
})();
