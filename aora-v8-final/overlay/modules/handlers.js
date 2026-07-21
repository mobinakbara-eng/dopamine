"use strict";

app.addEventListener("click",async event=>{
  const button=event.target.closest("[data-a]");
  if(!button)return;
  const action=button.dataset.a;

  if(action==="role"){
    const accessRole=button.dataset.role;
    setAccessRole(accessRole);
    S.session=null;
    S.state=null;
    S.magicLinkSent=false;
    history.replaceState({},"",accessPath(accessRole));
    renderLogin();
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
    managerModal();
  }else if(action==="manager-access-modal"){
    const manager=S.state.admins.find(item=>item.id===button.dataset.id);
    if(manager)managerAccessModal(manager);
  }else if(action==="employee-account-modal"){
    employeeAccountModal();
  }else if(action==="resend-invitation"){
    try{await apply({type:"RESEND_INVITATION",id:button.dataset.id})}catch{}
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
    setAccessRole("kiosk");
    S.session=null;
    S.state=null;
    sessionStorage.removeItem(key("kiosk"));
    history.pushState({},"",accessPath("kiosk"));
    renderLogin();
  }else if(action==="switch-admin"){
    const role=S.session?.accessRole||"manager";
    setAccessRole(role);
    S.session=restore(role);
    history.pushState({},"",accessPath(role));
    S.session?loadState():renderLogin();
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
    }catch{}
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
    try{await apply({type:"TOGGLE_KIOSK_LOCK",id:button.dataset.id})}catch{}
  }
});
