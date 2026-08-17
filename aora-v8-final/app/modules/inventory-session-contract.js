"use strict";
invRequest=async function(action,body={}){
  const payload={action,...body,sessionToken:S.session?.token};
  if(action==="issueQrUnit"){
    payload.qrToken=String(body.qrToken||body.token||"");
    delete payload.token;
  }
  return request(INVENTORY_FUNCTION,payload);
};
