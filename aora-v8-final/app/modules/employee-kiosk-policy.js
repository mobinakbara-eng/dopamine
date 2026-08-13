"use strict";

(()=>{
  const previousEmployeeView=globalThis.employeeView;
  if(typeof previousEmployeeView==="function"){
    globalThis.employeeView=function(employee,view){
      const html=previousEmployeeView(employee,view);
      if(String(view||"home")!=="home")return html;
      return String(html).replace(/\s*<button class="checkin-button" data-a="open-kiosk">[\s\S]*?<\/button>/," ");
    };
  }

  document.addEventListener("click",event=>{
    const button=event.target.closest?.('[data-a="open-kiosk"]');
    if(!button||S.accessRole!=="employee")return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);
})();
