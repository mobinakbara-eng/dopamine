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
