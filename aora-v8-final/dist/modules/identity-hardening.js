"use strict";

const renderAdminCanonical=renderAdmin;

currentAdmin=function(){
  const subjectId=S.session?.subjectId||S.session?.adminId;
  return(S.state?.admins||[]).find(item=>
    item.id===subjectId&&
    item.active!==false&&
    item.status!=="revoked"&&
    item.status!=="pending"
  )||null;
};

renderAdmin=function(){
  // During boot a module or DOM event can legitimately request a render while
  // the authenticated session is already restored but the workspace snapshot
  // is still in flight. An empty state at that point is not evidence that the
  // account was revoked and must never erase a valid session.
  if(!S.state||!Array.isArray(S.state.admins)){
    if(typeof renderLoading==="function")renderLoading();
    return;
  }
  const admin=currentAdmin();
  if(!admin){
    clearSessions();
    S.session=null;
    S.state=null;
    renderError("Das angemeldete Administrationskonto wurde nicht gefunden oder ist nicht aktiv. Bitte erneut anmelden.");
    return;
  }
  return renderAdminCanonical();
};
