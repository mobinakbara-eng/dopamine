"use strict";
invRequest=async function(action,body={}){
  const payload={action,...body,sessionToken:S.session?.token};
  if(action==="issueQrUnit"){
    payload.qrToken=String(body.qrToken||body.token||"");
    delete payload.token;
  }
  const functionName=RUNTIME.environment==="preview"&&location.hostname.endsWith("-mobins-projects-4f428afa.vercel.app")?"aora-v8-inventory-preview":INVENTORY_FUNCTION;
  return request(functionName,payload);
};
