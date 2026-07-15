"use strict";
const CFG={url:"https://xqgkawskftzurbujrpex.supabase.co",slug:"aora-demo",tz:"Europe/Berlin",version:"7.2.0-original-identity"};
const app=document.getElementById("app"),toasts=document.getElementById("toast-root");
const S={role:routeRole()||"employee",session:null,directory:null,state:null,revision:0,employeeView:"home",adminView:"overview",locationId:"loc_1",selected:null,busy:false};
