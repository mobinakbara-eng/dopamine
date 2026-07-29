"use strict";

function adminView(){
  if(isOwner()){
    if(S.adminView==="locations")return locationsPage();
    if(S.adminView==="managers")return managersPage();
    if(S.adminView==="invitations")return invitationsPage();
    if(S.adminView==="operations"||S.adminView==="overview")return overviewPage();
    if(S.adminView==="schedule")return schedulePage();
    if(S.adminView==="time")return timePage();
    if(S.adminView==="leave")return leavePage();
    if(S.adminView==="employees")return employeesPage();
    if(S.adminView==="news")return newsPage();
    if(S.adminView==="kiosk")return kioskAdminPage();
    if(S.adminView==="reports")return reportsPage(true);
    if(S.adminView==="settings")return settingsPage();
    return ownerOverviewPage();
  }
  if(S.adminView==="schedule")return schedulePage();
  if(S.adminView==="time")return timePage();
  if(S.adminView==="leave")return leavePage();
  if(S.adminView==="employees")return employeesPage();
  if(S.adminView==="reports")return reportsPage();
  if(S.adminView==="news")return newsPage();
  if(S.adminView==="kiosk")return kioskAdminPage();
  if(S.adminView==="settings")return settingsPage();
  return overviewPage();
}
