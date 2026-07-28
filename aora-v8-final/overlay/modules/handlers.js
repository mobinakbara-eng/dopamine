"use strict";

function secureCurrentPosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error("Standortfreigabe wird für die sichere Kiosk-Bestätigung benötigt."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position=>resolve({lat:position.coords.latitude,lng:position.coords.longitude,accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()}),
      ()=>reject(new Error("Standort konnte nicht bestätigt werden. Bitte Standortzugriff erlauben und erneut versuchen.")),
      {enableHighAccuracy:true,timeout:12000,maximumAge:0}
    );
  });
}

app.addEventListener("click",async event=>{
  const button=event.target.closest("[data-a]");
  if(!button)return;
  const action=button.dataset.a;

  if(action==="role"){
    const accessRole=button.dataset.role;
    setAccessRole(accessRole);
    S.session=null;
    S.state=null;
    history.replaceState({},"",accessPath(accessRole));
    try{await ensureDirectory(accessRole);renderLogin()}catch(error){renderError(error.message)}
  }else if(action==="invitation-back"){
    clearInvitationCallback();
    try{await ensureDirectory(S.accessRole);renderLogin()}catch(error){renderError(error.message)}
  }else if(action==="logout"){
    await logout();
  }else if(action==="retry"){
    S.session?loadState():boot();
  }else if(action==="employee-view"){
    S.employeeView=button.dataset.view;
    renderEmployee();
  }else if(action==="admin-view"){
    S.adminView=button.dataset.view;
    renderAdmin();
    document.getElementById("aside")?.classList.remove("open");
  }else if(action==="admin-menu"){
    document.getElementById("aside")?.classList.toggle("open");
  }else if(action==="select-location"){
    S.locationId=button.dataset.id;
    S.adminView=isOwner()?"operations":"overview";
    renderAdmin();
  }else if(action==="location-modal"){
    locationModal();
  }else if(action==="edit-location"){
    locationModal(S.state.locations.find(location=>location.id===button.dataset.id));
  }else if(action==="archive-location"){
    const location=S.state.locations.find(item=>item.id===button.dataset.id);
    if(location&&confirm(`Laden „${location.name}“ wirklich archivieren?`)){
      try{await apply({type:"ARCHIVE_LOCATION",id:location.id})}catch{}
    }
  }else if(action==="manager-modal"){
    managerInvitationModal();
  }else if(action==="manager-access-modal"){
    const manager=S.state.admins.find(item=>item.id===button.dataset.id);
    if(manager)managerAccessModal(manager);
  }else if(action==="employee-account-modal"){
    employeeInvitationModal();
  }else if(action==="resend-invitation"){
    try{
      const result=await apply({type:"RESEND_INVITATION",id:button.dataset.id});
      invitationDeliveryModal(result.delivery);
    }catch{}
  }else if(action==="revoke-invitation"){
    if(confirm("Diese Einladung wirklich widerrufen?")){
      try{await apply({type:"REVOKE_INVITATION",id:button.dataset.id})}catch{}
    }
  }else if(action==="deactivate-manager"){
    if(confirm("Diesen Manager-Zugang deaktivieren?")){
      try{await apply({type:"DEACTIVATE_ACCOUNT",kind:"manager",id:button.dataset.id})}catch{}
    }
  }else if(action==="deactivate-employee"){
    if(confirm("Dieses Mitarbeiterkonto deaktivieren?")){
      try{await apply({type:"DEACTIVATE_ACCOUNT",kind:"employee",id:button.dataset.id})}catch{}
    }
  }else if(action==="open-kiosk"){
    const previousRole=["owner","manager"].includes(S.accessRole)?S.accessRole:null;
    if(previousRole)sessionStorage.setItem(`aora:${CFG.slug}:return-admin-role`,previousRole);
    const previousToken=S.session?.token;
    if(previousToken){
      try{await access({action:"logout",token:previousToken})}catch{}
    }
    if(S.accessRole)sessionStorage.removeItem(key(S.accessRole));
    sessionStorage.removeItem(key("owner"));
    sessionStorage.removeItem(key("manager"));
    setAccessRole("kiosk");
    S.session=null;
    S.state=null;
    S.directory=null;
    sessionStorage.removeItem(key("kiosk"));
    history.pushState({},"",accessPath("kiosk"));
    try{await ensureDirectory("kiosk");renderLogin()}catch(error){renderError(error.message)}
  }else if(action==="switch-admin"){
    const kioskToken=S.session?.token;
    if(kioskToken){
      try{await access({action:"logout",token:kioskToken})}catch{}
    }
    sessionStorage.removeItem(key("kiosk"));
    const returnRole=sessionStorage.getItem(`aora:${CFG.slug}:return-admin-role`)||"manager";
    sessionStorage.removeItem(`aora:${CFG.slug}:return-admin-role`);
    setAccessRole(returnRole==="owner"?"owner":"manager");
    S.session=null;
    S.state=null;
    S.directory=null;
    history.pushState({},"",accessPath(S.accessRole));
    renderLogin("Bitte erneut anmelden, um den Verwaltungsbereich zu öffnen.");
  }else if(action==="select-person"){
    S.selected=button.dataset.id;
    renderKiosk();
  }else if(action==="clear-person"){
    S.selected=null;
    renderKiosk();
  }else if(action==="transition"){
    try{
      await apply({type:"KIOSK_TRANSITION",employeeId:S.selected,target:button.dataset.target});
      S.selected=null;
      renderKiosk();
      toast("Anfrage wurde an das persönliche Mitarbeiterkonto gesendet.");
    }catch{}
  }else if(action==="clock-approve"){
    button.disabled=true;
    try{
      const position=await secureCurrentPosition();
      await apply({type:"APPROVE_CLOCK_REQUEST",id:button.dataset.id,position});
      toast("Zeiterfassung wurde bestätigt.");
    }catch(error){
      toast(error.message,"error");
      button.disabled=false;
    }
  }else if(action==="clock-deny"){
    button.disabled=true;
    try{
      await apply({type:"DENY_CLOCK_REQUEST",id:button.dataset.id,reason:"Vom Mitarbeiter abgelehnt"});
      toast("Kiosk-Anfrage wurde abgelehnt.");
    }catch{
      button.disabled=false;
    }
  }else if(action==="kiosk-help"){
    kioskHelpModal();
  }else if(action==="leave-modal"){
    leaveModal();
  }else if(action==="profile-modal"){
    profileModal();
  }else if(action==="shift-modal"){
    shiftModal();
  }else if(action==="news-modal"){
    newsModal();
  }else if(action==="leave-decision"){
    try{await apply({type:"DECIDE_LEAVE",id:button.dataset.id,decision:button.dataset.decision})}catch{}
  }else if(action==="toggle-kiosk"){
    const device=S.state.kioskDevices.find(item=>item.id===button.dataset.id);
    if(!device){
      toast("Kiosk-Gerät wurde nicht gefunden.","error");
      return;
    }
    const locking=!Boolean(device.locked);
    button.disabled=true;
    try{
      await apply({type:"TOGGLE_KIOSK_LOCK",id:device.id,locked:locking});
      toast(locking?"Kiosk-Gerät wurde gesperrt.":"Kiosk-Gerät wurde entsperrt.");
    }catch(error){
      toast(error.message||"Kiosk-Gerät konnte nicht aktualisiert werden.","error");
      if(button.isConnected)button.disabled=false;
    }
  }
});

