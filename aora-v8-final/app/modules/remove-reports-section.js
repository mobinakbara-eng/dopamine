"use strict";

const REPORTS_VIEW_ID="reports";

function removeReportsNavigationEntry(navigation){
  if(!Array.isArray(navigation))return;
  for(let index=navigation.length-1;index>=0;index-=1){
    if(navigation[index]?.[0]===REPORTS_VIEW_ID)navigation.splice(index,1);
  }
}

removeReportsNavigationEntry(managerNav);
removeReportsNavigationEntry(ownerNav);

const renderAdminWithoutReports=renderAdmin;
renderAdmin=function(){
  if(S.adminView===REPORTS_VIEW_ID){
    S.adminView=isOwner()?"owner-overview":"overview";
  }
  return renderAdminWithoutReports();
};
