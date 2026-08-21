"use strict";

if(typeof globalThis.productionCall==="function"){
  const productionCallBase=globalThis.productionCall;
  globalThis.productionCall=async function(action,payload={}){
    if(action==="listRequests"&&S.accessRole!=="owner"){
      return{passwordResets:[],supportRequests:[]};
    }
    return productionCallBase(action,payload);
  };
}