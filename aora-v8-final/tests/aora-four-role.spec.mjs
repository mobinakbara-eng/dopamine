import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const paths={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
const roleShell={owner:".admin-app",manager:".admin-app",employee:".employee-app"};
const futureStart="2026-08-10";
const futureEnd="2026-08-11";
const correctionReason=()=>`Agent QA correction ${workspace}`;

function env(name){const value=process.env[name];if(!value)throw new Error(`Missing required ephemeral CI value: ${name}`);return value}
function safeUrl(input){try{const url=new URL(input);for(const key of ["token","session","key"])if(url.searchParams.has(key))url.searchParams.set(key,"[REDACTED]");return url.pathname+url.search}catch{return String(input).replace(/([?&](?:token|session|key)=)[^&#\s]+/gi,"$1[REDACTED]")}}
function diagnostics(page,{allowOffline=false}={}){
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed";
    const url=safeUrl(request.url());
    const expectedAbort=reason==="net::ERR_ABORTED"&&(url.includes("/aora-v8-pilot-compliance-proxy")||url.includes("/aora-v8-pilot-realtime-broadcast"));
    if(!allowOffline&&!expectedAbort)errors.push(`network:${reason}:${url}`);
  });
  return()=>errors;
}
function isAccessAction(request,action){return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes(`"action":"${action}"`)}
function isWorkspaceEvent(request,eventType){return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-workspace-rules")&&String(request.postData()||"").includes(`"type":"${eventType}"`)}
function isComplianceAction(request,action){return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-compliance-proxy")&&String(request.postData()||"").includes(`"action":"${action}"`)}
async function observeAccessAction(page,action,trigger){
  const responsePromise=page.waitForResponse(response=>isAccessAction(response.request(),action),{timeout:15000}).then(response=>({kind:"response",response}));
  const failurePromise=page.waitForEvent("requestfailed",{predicate:request=>isAccessAction(request,action),timeout:15000}).then(request=>({kind:"failure",request}));
  const timeoutPromise=new Promise(resolve=>setTimeout(()=>resolve({kind:"timeout"}),15000));
  await trigger();
  const outcome=await Promise.race([responsePromise,failurePromise,timeoutPromise]);
  if(outcome.kind==="failure")throw new Error(`Access ${action} request failed: ${outcome.request.failure()?.errorText||"unknown network error"}`);
  if(outcome.kind==="timeout")throw new Error(`Access ${action} POST was not observed. Visible UI: ${String(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,500)}`);
  return{response:outcome.response,body:await outcome.response.json().catch(()=>({}))};
}
async function triggerAccessAction(page,action,trigger){
  const {response,body}=await observeAccessAction(page,action,trigger);
  if(response.status()!==200)throw new Error(`Access ${action} HTTP ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
async function triggerAccessRejection(page,action,expectedStatus,trigger){
  const {response,body}=await observeAccessAction(page,action,trigger);
  if(response.status()!==expectedStatus)throw new Error(`Access ${action} expected HTTP ${expectedStatus}, received ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
async function triggerWorkspaceEvent(page,eventType,trigger){
  const {response,body}=await observeWorkspaceEvent(page,eventType,trigger);
  if(response.status()!==200)throw new Error(`Workspace ${eventType} HTTP ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
async function observeWorkspaceEvent(page,eventType,trigger){
  const responsePromise=page.waitForResponse(response=>isWorkspaceEvent(response.request(),eventType),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  return{response,body};
}
async function triggerWorkspaceRejection(page,eventType,expectedStatus,trigger){
  const {response,body}=await observeWorkspaceEvent(page,eventType,trigger);
  if(response.status()!==expectedStatus)throw new Error(`Workspace ${eventType} expected HTTP ${expectedStatus}, received ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
async function observeComplianceAction(page,action,trigger){
  const responsePromise=page.waitForResponse(response=>isComplianceAction(response.request(),action),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  if(![200,201].includes(response.status()))throw new Error(`Compliance ${action} HTTP ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
async function passwordLogin(page,role,email,password){
  await page.goto(`${paths[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await triggerAccessAction(page,"passwordLogin",()=>page.locator('#password-login button[type="submit"]').click());
  await page.waitForFunction(({workspace,role})=>Boolean(sessionStorage.getItem(`aora:${workspace}:${role}`)),{workspace,role});
  await expect(page.locator(roleShell[role])).toBeVisible({timeout:30000});
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
  await expect(page.locator("body")).not.toContainText("Verbindung nicht möglich");
}
async function kioskLogin(page){
  await page.goto(`${paths.kiosk}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('select[name="subject"]').selectOption(env("AORA_KIOSK_DEVICE_ID"));
  await page.locator('input[name="pin"]').fill(env("AORA_KIOSK_PIN"));
  await triggerAccessAction(page,"login",()=>page.locator('#pin-login button[type="submit"]').click());
  await page.waitForFunction(value=>Boolean(sessionStorage.getItem(`aora:${value}:kiosk`)),workspace);
  await expect(page.locator(".kiosk-app")).toBeVisible({timeout:30000});
}
async function assertHealthy(page){
  await expect(page.locator("body")).not.toContainText("Verbindung nicht möglich");
  await expect(page.locator("body")).not.toContainText("Anwendungsfehler");
  await expect(page.locator("body")).not.toContainText("Internal Server Error");
  expect(await page.evaluate(()=>document.body.innerText.trim().length)).toBeGreaterThan(40);
  const duplicateIds=await page.evaluate(()=>{const ids=[...document.querySelectorAll("[id]")].map(node=>node.id).filter(Boolean);return ids.filter((id,index)=>ids.indexOf(id)!==index)});
  expect(duplicateIds).toEqual([]);
}
async function assertNoHorizontalOverflow(page){const metrics=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth}));expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth+2)}
async function visitAdminViews(page){
  const views=await page.locator('.admin-nav [data-a="admin-view"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.view));
  expect(views.length).toBeGreaterThan(6);
  for(const view of views){
    await page.locator(`.admin-nav [data-a="admin-view"][data-view="${view}"]`).click();
    await expect(page.locator(".admin-content")).toBeVisible();
    await expect.poll(()=>page.locator(".admin-content").innerText().then(text=>text.trim().length)).toBeGreaterThan(20);
    await assertHealthy(page);
  }
  return views;
}
async function openAndCloseModal(page,selector,heading){
  const button=page.locator(selector).first();
  await expect(button).toBeVisible();
  await button.click();
  const modal=page.locator(".modal-backdrop .modal").last();
  await expect(modal).toBeVisible();
  if(heading)await expect(modal).toContainText(heading);
  await modal.locator('[data-a="close"]').first().click();
  await expect(modal).toBeHidden();
}
async function downloadComplianceExport(page,format){
  const downloadPromise=page.waitForEvent("download",{timeout:30000});
  await page.locator(`[data-compliance-action="export"][data-format="${format}"]`).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename().length).toBeGreaterThan(4);
  expect(await download.failure()).toBeNull();
  return download.suggestedFilename();
}

test.describe.serial("Aora 8.1.0 isolated staging role and browser gates",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("Owner: every navigation view, responsive shell, modals, exports and verified backup",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"owner",env("AORA_OWNER_EMAIL"),env("AORA_OWNER_PASSWORD"));
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["owner-overview","locations","managers","invitations","operations","reports","compliance","settings"]));
    await page.locator('.admin-nav [data-view="owner-overview"]').click();
    await openAndCloseModal(page,'[data-a="location-modal"]',"Laden");
    await openAndCloseModal(page,'[data-a="manager-modal"]',"Manager");
    await page.locator('[data-a="manager-modal"]').click();
    const managerInvite=page.locator(".modal-backdrop .modal").last();
    await managerInvite.locator('input[name="name"]').fill("Workspace Link QA");
    await managerInvite.locator('input[name="email"]').fill(`workspace-link-${Date.now()}@example.com`);
    await managerInvite.locator('input[name="locationIds"]').first().check();
    const inviteResult=await triggerWorkspaceEvent(page,"INVITE_MANAGER",()=>managerInvite.locator('button[type="submit"]').click());
    const generatedInvite=new URL(inviteResult.delivery.inviteUrl);
    expect(generatedInvite.searchParams.get("workspace")).toBe(workspace);
    expect(generatedInvite.pathname).toBe("/arbeitgeber/");
    await expect(page.locator("#delivery-link")).toHaveValue(inviteResult.delivery.inviteUrl);
    await page.locator(".modal-backdrop .modal").last().locator('[data-a="close"]').first().click();
    const options=page.locator("#loc-select option");
    if(await options.count()>1){const first=await options.nth(0).getAttribute("value");const second=await options.nth(1).getAttribute("value");await page.locator("#loc-select").selectOption(second);await expect(page.locator("#loc-select")).toHaveValue(second);await page.locator("#loc-select").selectOption(first)}
    await page.locator('.admin-nav [data-view="compliance"]').click();
    await expect(page.getByText("Compliance, Exporte und Zeitkorrekturen")).toBeVisible();
    await expect(page.locator(".compliance-list")).not.toContainText("Compliance-Daten werden geladen",{timeout:30000});
    const filenames=[];for(const format of ["csv","pdf","audit","steuerberater"])filenames.push(await downloadComplianceExport(page,format));
    expect(new Set(filenames).size).toBe(4);
    const backup=await observeComplianceAction(page,"backup",()=>page.locator('[data-compliance-action="backup"]').click());
    expect(backup.verified).toBe(true);
    await page.reload();
    await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
    await assertHealthy(page);await assertNoHorizontalOverflow(page);expect(getErrors()).toEqual([]);
  });

  test("Manager: all scoped views and every creation modal render without errors",async({page,browser})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await expect(page.locator("#loc-select option")).toHaveCount(Number(env("AORA_MANAGER_LOCATION_COUNT")));
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["overview","schedule","time","leave","employees","reports","news","kiosk","compliance","settings"]));
    await page.locator('.admin-nav [data-view="overview"]').click();await openAndCloseModal(page,'[data-a="employee-account-modal"]',"Mitarbeiter");
    await page.locator('.admin-nav [data-view="schedule"]').click();await openAndCloseModal(page,'[data-a="shift-modal"]',"Neue Schicht");
    await page.locator('.admin-nav [data-view="news"]').click();await openAndCloseModal(page,'[data-a="news-modal"]',"Mitteilung erstellen");
    await page.locator('.admin-nav [data-view="kiosk"]').click();
    await page.locator('[data-a="kiosk-create-modal"]').click();
    const createKiosk=page.locator(".modal-backdrop .modal").last();
    await createKiosk.locator('input[name="name"]').fill(`Manager Kiosk ${Date.now()}`);
    const kioskResult=await triggerWorkspaceEvent(page,"CREATE_KIOSK_DEVICE",()=>createKiosk.locator('button[type="submit"]').click());
    expect(kioskResult.kioskActivation.deviceId).toMatch(/^kiosk_/);
    expect(kioskResult.kioskActivation.activationCode).toMatch(/^\d{8}$/);
    expect(new URL(kioskResult.kioskActivation.kioskUrl).searchParams.get("workspace")).toBe(workspace);
    expect(new URL(kioskResult.kioskActivation.kioskUrl).origin).toBe(new URL(page.url()).origin);
    await expect(page.getByText("Zugangsdaten bereit")).toBeVisible();
    const kioskContext=await browser.newContext();
    const createdKiosk=await kioskContext.newPage();
    const kioskErrors=diagnostics(createdKiosk);
    await createdKiosk.goto(kioskResult.kioskActivation.kioskUrl);
    await createdKiosk.locator('select[name="subject"]').selectOption(kioskResult.kioskActivation.deviceId);
    await createdKiosk.locator('input[name="pin"]').fill(kioskResult.kioskActivation.activationCode);
    await triggerAccessAction(createdKiosk,"login",()=>createdKiosk.locator('#pin-login button[type="submit"]').click());
    await expect(createdKiosk.locator(".kiosk-app")).toBeVisible({timeout:30000});
    expect(kioskErrors()).toEqual([]);
    await kioskContext.close();
    await page.locator(".modal-backdrop .modal").last().locator('[data-a="close"]').first().click();
    const toggle=page.locator('[data-a="toggle-kiosk"]').first();
    if(await toggle.count()){
      const before=(await toggle.innerText()).trim();
      await toggle.click();await expect.poll(()=>page.locator('[data-a="toggle-kiosk"]').first().innerText(),{timeout:30000}).not.toBe(before);
      await page.locator('[data-a="toggle-kiosk"]').first().click();
      await expect.poll(()=>page.locator('[data-a="toggle-kiosk"]').first().innerText(),{timeout:30000}).toBe(before);
    }
    await assertNoHorizontalOverflow(page);expect(getErrors()).toEqual([]);
  });

  test("Employee: every tab, profile, leave and correction dialogs render on mobile",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const getErrors=diagnostics(page);
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    const nav=page.locator('.employee-bottom [data-a="employee-view"]');
    await expect(nav).toHaveCount(5,{timeout:30000});
    const tabs=await nav.evaluateAll(nodes=>nodes.map(node=>node.dataset.view));
    expect(tabs).toEqual(["home","calendar","time","leave","more"]);
    for(const view of tabs){await page.locator(`[data-a="employee-view"][data-view="${view}"]`).click();await expect(page.locator(".employee-main")).toBeVisible();await assertHealthy(page);await assertNoHorizontalOverflow(page)}
    await page.locator('[data-view="more"]').click();await openAndCloseModal(page,'[data-a="profile-modal"]',"Profil bearbeiten");
    await page.locator('[data-view="leave"]').click();await openAndCloseModal(page,'[data-a="leave-modal"]',"Antrag stellen");
    await page.locator('[data-compliance-action="request-correction"]').click();await expect(page.getByText("Korrektur beantragen")).toBeVisible();await page.locator('[data-compliance-action="close"]').first().click();
    expect(getErrors()).toEqual([]);
  });

  test("Employee → Manager: submit and approve leave plus time correction",async({page,browser})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('[data-view="leave"]').click();await page.locator('[data-a="leave-modal"]').click();
    const leaveModal=page.locator(".modal-backdrop .modal").last();
    await leaveModal.locator('input[name="start"]').fill(futureStart);await leaveModal.locator('input[name="end"]').fill(futureEnd);await leaveModal.locator('textarea[name="note"]').fill(`Agent QA ${workspace}`);await leaveModal.locator('button[type="submit"]').click();
    await expect(leaveModal).toBeHidden({timeout:30000});await expect(page.locator(".employee-main")).toContainText(futureStart);
    await page.locator('[data-compliance-action="request-correction"]').click();
    const correction=page.locator("#aora-compliance-dialog");await expect(correction).toBeVisible();await correction.locator('input[name="breakMinutes"]').fill("5");await correction.locator('textarea[name="reason"]').fill(correctionReason());await correction.locator('button[type="submit"]').click();await expect(correction).not.toBeVisible({timeout:30000});
    expect(getErrors()).toEqual([]);

    const context=await browser.newContext();const manager=await context.newPage();const managerErrors=diagnostics(manager);
    await passwordLogin(manager,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await manager.locator('.admin-nav [data-view="leave"]').click();
    const leaveRow=manager.locator(".leave-row").filter({hasText:futureStart}).first();await expect(leaveRow).toBeVisible();await leaveRow.locator('[data-decision="approved"]').click();await expect.poll(()=>manager.locator(".leave-row").filter({hasText:futureStart}).first().innerText(),{timeout:30000}).toContain("approved");
    await manager.locator('.admin-nav [data-view="compliance"]').click();await expect(manager.locator(".compliance-list")).not.toContainText("Compliance-Daten werden geladen",{timeout:30000});
    const correctionRow=manager.locator(".compliance-row").filter({hasText:correctionReason()}).first();await expect(correctionRow).toBeVisible();manager.once("dialog",dialog=>dialog.accept("Agent QA approved"));await observeComplianceAction(manager,"decideCorrection",()=>correctionRow.locator('[data-decision="approved"]').click());await expect.poll(()=>manager.locator(".compliance-row").filter({hasText:correctionReason()}).first().innerText(),{timeout:30000}).toContain("Genehmigt");
    await expect.poll(()=>manager.evaluate(()=>{const entry=(S.state.timeEntries||[]).find(item=>item.end);return{breakMinutes:entry?.breakMinutes,durationMinutes:entry?.durationMinutes}}),{timeout:30000}).toEqual({breakMinutes:5,durationMinutes:505});
    expect(managerErrors()).toEqual([]);await context.close();
  });

  test("Kiosk: encrypted offline queue, resync and inside/outside geofence enforcement",async({page,context,browser})=>{
    await page.setViewportSize({width:1024,height:768});const getErrors=diagnostics(page,{allowOffline:true});
    await kioskLogin(page);await assertHealthy(page);await assertNoHorizontalOverflow(page);
    const people=page.locator('[data-a="select-person"]');await expect(people.first()).toBeVisible();await people.first().click();await context.setOffline(true);await page.locator('[data-a="transition"]').first().click();
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:15000}).toEqual(expect.arrayContaining([expect.objectContaining({status:"pending",hasCiphertext:true,hasPlaintextPayload:false})]));
    await context.setOffline(false);await page.evaluate(()=>syncOfflinePunchQueue());await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:30000}).toEqual([]);

    const employeeContext=await browser.newContext({permissions:["geolocation"],geolocation:{latitude:52.52,longitude:13.405,accuracy:20}});
    const employee=await employeeContext.newPage();const employeeErrors=diagnostics(employee);
    await passwordLogin(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
    const clockIn=await triggerWorkspaceEvent(employee,"APPROVE_CLOCK_REQUEST",()=>employee.locator('[data-a="clock-approve"]').click());
    const approvedIn=clockIn.state.clockRequests.find(item=>item.status==="approved");
    expect(approvedIn?.verification?.result).toBe("passed");
    expect(clockIn.state.timeEntries.some(item=>item.status==="live"&&item.source==="secure_kiosk")).toBe(true);

    await page.reload();await expect(page.locator(".kiosk-app")).toBeVisible({timeout:30000});
    await page.locator('[data-a="select-person"]').first().click();
    await page.locator('[data-a="transition"][data-target="pause"]').click();
    await employee.reload();await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
    await employeeContext.setGeolocation({latitude:52.62,longitude:13.405,accuracy:20});
    const outside=await triggerWorkspaceRejection(employee,"APPROVE_CLOCK_REQUEST",403,()=>employee.locator('[data-a="clock-approve"]').click());
    expect(String(outside.error||"")).toContain("Außerhalb des Standorts");
    await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible();

    await employeeContext.setGeolocation({latitude:52.52,longitude:13.405,accuracy:20});
    const pause=await triggerWorkspaceEvent(employee,"APPROVE_CLOCK_REQUEST",()=>employee.locator('[data-a="clock-approve"]').click());
    expect(pause.state.timeEntries.some(item=>item.status==="paused")).toBe(true);
    expect(employeeErrors()).toEqual([]);
    await employeeContext.close();
    expect(getErrors().filter(item=>!item.includes("ERR_INTERNET_DISCONNECTED"))).toEqual([]);
  });

  test("Invitation: reject breached password, activate, login, scope and replay",async({page,browser,baseURL})=>{
    const invitation=new URL(env("AORA_INVITATION_URL"));const localInvite=new URL(`${invitation.pathname}${invitation.search}`,baseURL).toString();const email=env("AORA_INVITATION_EMAIL"),password=env("AORA_INVITATION_PASSWORD");
    await page.goto(localInvite);await expect(page.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible();await page.locator('input[name="email"]').fill(email);
    const breachedPassword="Password123!";await page.locator('input[name="password"]').fill(breachedPassword);await page.locator('input[name="confirm"]').fill(breachedPassword);
    const rejection=await triggerAccessRejection(page,"acceptInvitation",400,()=>page.locator('#invitation-accept button[type="submit"]').click());expect(String(rejection.error||"")).toContain("Datenlecks");await expect(page.getByText(/bekannten Datenlecks/)).toBeVisible();
    await page.locator('input[name="password"]').fill(password);await page.locator('input[name="confirm"]').fill(password);await triggerAccessAction(page,"acceptInvitation",()=>page.locator('#invitation-accept button[type="submit"]').click());await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});await expect(page.locator("#loc-select option")).toHaveCount(1);
    await page.locator('[data-a="logout"]').click();await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);await triggerAccessAction(page,"passwordLogin",()=>page.locator('#password-login button[type="submit"]').click());await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
    const replayContext=await browser.newContext();const replay=await replayContext.newPage();await replay.goto(localInvite);await expect(replay.getByText("Link nicht mehr gültig")).toBeVisible();await replayContext.close();
  });
});

