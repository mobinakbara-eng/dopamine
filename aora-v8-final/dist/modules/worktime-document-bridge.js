"use strict";

(function installEmbeddedDocumentRefreshBridge(){
  if(window.__aoraWorktimeDocumentBridgeInstalled)return;
  window.__aoraWorktimeDocumentBridgeInstalled=true;
  if(typeof request!=="function")return;

  const baseRequest=request;
  const wrappedRequest=async function(functionName,payload,...rest){
    const result=await baseRequest(functionName,payload,...rest);
    const shouldRefresh=
      functionName==="aora-v8-timesheet-document-signing"&&
      payload?.action==="managerOverview"&&
      S?.adminView==="worktime"&&
      document.querySelector('[data-worktime-action="tab"][data-tab="documents"].active');

    if(shouldRefresh){
      setTimeout(()=>{
        if(
          S?.session&&
          S.adminView==="worktime"&&
          document.querySelector('[data-worktime-action="tab"][data-tab="documents"].active')&&
          typeof renderAdmin==="function"
        )renderAdmin();
      },0);
    }
    return result;
  };

  request=wrappedRequest;
  window.request=wrappedRequest;
})();
