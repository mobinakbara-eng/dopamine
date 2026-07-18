"use strict";

app.addEventListener("click",async(event)=>{
  const button=event.target.closest("[data-a]");
  if(!button)return;
  const action=button.dataset.a;

  if(action==="role"){
    S.role=button.dataset.role;
    history.replaceState({},"",rolePath(S.role));
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
  }else if(action==="open-kiosk"){
    S.role="kiosk";
    S.session=null;
    sessionStorage.removeItem(key("kiosk"));
    history.pushState({},"",rolePath("kiosk"));
    renderLogin();
  }else if(action==="switch-admin"){
    S.role="admin";
    S.session=restore();
    history.pushState({},"",rolePath("admin"));
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
