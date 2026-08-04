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
function isWorkspaceEvent(request,eventType){
  if(request.method()!=="POST"||!String(request.postData()||"").includes(`"type":"${eventType}"`))return false;
  const url=request.url();
  const invitationEvents=new Set(["INVITE_MANAGER","CREATE_EMPLOYEE_ACCOUNT","RESEND_INVITATION","REVOKE_INVITATION"]);
  return invitationEvents.has(eventType)
    ? url.includes("/functions/v1/aora-v8-invitation-patch")
    : url.includes("/functions/v1/aora-v8-pilot-workspace-rules");
}
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
  await page.locator('input[name="subject"]').fill(env("AORA_KIOSK_DEVICE_ID"));
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
  await expect(modal).toHaveAttribute("role","dialog");
  await expect(modal).toHaveAttribute("aria-modal","true");
  if(heading)await expect(modal).toContainText(heading);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(button).toBeFocused();
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

  test("Owner: every navigation view, responsive shell, modals, exports and verified backup",async({page,browser,baseURL})=>{
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
    const inviteContext=await browser.newContext();
    const generatedInvitePage=await inviteContext.newPage();
    const localGeneratedInvite=new URL(`${generatedInvite.pathname}${generatedInvite.search}`,baseURL).toString();
    await generatedInvitePage.goto(localGeneratedInvite);
    await expect(generatedInvitePage.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible({timeout:30000});
    await generatedInvitePage.reload();
    await expect(generatedInvitePage.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible({timeout:30000});
    await inviteContext.close();
    await page.locator(".modal-backdrop .modal").last().locator('[data-a="close"]').first().click();
    const options=page.locator("#loc-select option");
    if(await options.count()>1){const first=await options.nth(0).getAttribute("value");const second=await options.nth(1).getAttribute("value");await page.locator("#loc-select").selectOption(second);await expect(page.locator("#loc-select")).toHaveValue(second);await page.locator("#loc-select").selectOption(first)}
    await page.locator('.admin-nav [data-view="compliance"]').click();
    await expect(page.getByText("Compliance, Exporte und Zeitkorrekturen")).toBeVisible();
    const csv=await downloadComplianceExport(page,"csv");
    const pdf=await downloadComplianceExport(page,"pdf");
    expect(csv).toMatch(/\.csv$/);
    expect(pdf).toMatch(/\.pdf$/);
    await page.locator('.admin-nav [data-view="settings"]').click();
    const restore=page.locator('[data-u="settings-restore"]');
    await expect(restore).toBeVisible();
    const fileInput=page.locator('#settings-restore-input');
    await fileInput.setInputFiles({name:"invalid-backup.json",mimeType:"application/json",buffer:Buffer.from('{"invalid":true}')});
    await expect(page.locator(".toast.error")).toBeVisible();
    expect(getErrors()).toEqual([]);
  });

  test("Manager: all scoped views and every creation modal render without errors",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    expect(Number(env("AORA_MANAGER_LOCATION_COUNT"))).toBe(1);
    expect(await page.locator("#loc-select option").count()).toBe(1);
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["overview","schedule","people","time","leave","settings"]));
    await page.locator('.admin-nav [data-view="overview"]').click();
    await openAndCloseModal(page,'[data-a="employee-modal"]',"Mitarbeiter");
    await openAndCloseModal(page,'[data-a="shift-modal"]',"Schicht");
    await openAndCloseModal(page,'[data-a="announce-modal"]',"Ankündigung");
    expect(getErrors()).toEqual([]);
  });

  test("Employee: every tab, profile, leave and correction dialogs render on mobile",async({page})=>{
    const getErrors=diagnostics(page);
    await page.setViewportSize({width:390,height:844});
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    for(const view of ["home","shifts","time","leave","more"]){await page.locator(`.employee-bottom-nav [data-view="${view}"]`).click();await assertHealthy(page);await assertNoHorizontalOverflow(page)}
    await openAndCloseModal(page,'[data-a="leave-modal"]',"Abwesenheit");
    await openAndCloseModal(page,'[data-compliance-action="open-correction"]',"Korrektur beantragen");
    await page.locator('.employee-bottom-nav [data-view="more"]').click();
    await expect(page.getByRole("button",{name:/Profil bearbeiten/})).toBeVisible();
    expect(getErrors()).toEqual([]);
  });

  test("Employee → Manager: submit and approve leave plus time correction",async({page})=>{
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('[data-a="leave-modal"]').click();
    const leaveModal=page.locator(".modal-backdrop .modal").last();
    await leaveModal.locator('input[name="start"]').fill(futureStart);
    await leaveModal.locator('input[name="end"]').fill(futureEnd);
    await leaveModal.locator('textarea[name="reason"]').fill(`CI leave ${workspace}`);
    await triggerWorkspaceEvent(page,"REQUEST_LEAVE",()=>leaveModal.locator('button[type="submit"]').click());
    await page.locator('[data-compliance-action="open-correction"]').click();
    const correctionDialog=page.locator("#aora-compliance-dialog");
    await correctionDialog.locator('input[name="date"]').fill(futureStart);
    await correctionDialog.locator('input[name="start"]').fill("09:00");
    await correctionDialog.locator('input[name="end"]').fill("17:30");
    await correctionDialog.locator('input[name="breakMinutes"]').fill("30");
    await correctionDialog.locator('textarea[name="reason"]').fill(correctionReason());
    await observeComplianceAction(page,"createCorrection",()=>correctionDialog.locator('button[type="submit"]').click());
    await page.locator('[data-a="logout"]').click();
    await passwordLogin(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await page.locator('.admin-nav [data-view="leave"]').click();
    const leaveRow=page.locator(".admin-request-row").filter({hasText:`CI leave ${workspace}`}).first();
    await expect(leaveRow).toBeVisible();
    await triggerWorkspaceEvent(page,"DECIDE_LEAVE",()=>leaveRow.locator('[data-a="leave-decide"][data-decision="approved"]').click());
    await page.locator('.admin-nav [data-view="compliance"]').click();
    const correctionRow=page.locator(".compliance-request-row").filter({hasText:correctionReason()}).first();
    await expect(correctionRow).toBeVisible();
    await observeComplianceAction(page,"decideCorrection",()=>correctionRow.locator('[data-compliance-action="decide"][data-decision="approved"]').click());
    await expect(correctionRow).toContainText("Genehmigt");
    await expect(page.getByText("8:00 Std.",{exact:true}).first()).toBeVisible();
  });

  test("Kiosk: encrypted offline queue, resync and inside/outside geofence enforcement",async({page})=>{
    const getErrors=diagnostics(page,{allowOffline:true});
    await kioskLogin(page);
    await page.context().setOffline(true);
    await page.locator(`[data-a="kiosk-select"][data-emp]`).first().click();
    await page.locator('[data-a="kiosk-transition"] input[name="geoPermission"]').check();
    await page.locator('[data-a="kiosk-transition"] button[type="submit"]').click();
    await expect(page.getByText("Lokal verschlüsselt gespeichert")).toBeVisible();
    const queueSnapshot=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("aora-v8-offline");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      const records=await new Promise((resolve,reject)=>{const tx=db.transaction("punch-queue","readonly");const request=tx.objectStore("punch-queue").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      return records;
    });
    expect(queueSnapshot.length).toBeGreaterThan(0);
    expect(JSON.stringify(queueSnapshot)).not.toContain("employeeId");
    expect(JSON.stringify(queueSnapshot)).not.toContain("CLOCK_IN");
    expect(queueSnapshot[0].cipherText).toBeTruthy();
    await page.context().setOffline(false);
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await expect.poll(()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("aora-v8-offline");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return new Promise((resolve,reject)=>{const tx=db.transaction("punch-queue","readonly");const request=tx.objectStore("punch-queue").count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})})).toBe(0);
    await page.locator(`[data-a="kiosk-select"][data-emp]`).first().click();
    await page.locator('[data-a="kiosk-transition"] input[name="geoPermission"]').check();
    const requestBody=await triggerAccessAction(page,"requestPunch",()=>page.locator('[data-a="kiosk-transition"] button[type="submit"]').click());
    expect(requestBody.request?.id).toBeTruthy();
    await page.locator('[data-a="logout"]').click();
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(page.locator(".employee-punch-gate")).toBeVisible();
    await triggerAccessRejection(page,"decidePunch",403,()=>page.locator('[data-a="employee-punch-decide"][data-decision="approved"]').click());
    await page.context().setGeolocation({latitude:52.52,longitude:13.405});
    await page.context().grantPermissions(["geolocation"],{origin:new URL(page.url()).origin});
    await triggerAccessAction(page,"decidePunch",()=>page.locator('[data-a="employee-punch-decide"][data-decision="approved"]').click());
    await expect(page.locator(".employee-punch-gate")).toBeHidden();
    expect(getErrors().filter(error=>!error.includes("net::ERR_INTERNET_DISCONNECTED"))).toEqual([]);
  });

  test("Invitation: reject breached password, activate, login, scope and replay",async({page})=>{
    await page.goto(env("AORA_INVITATION_URL"));
    await expect(page.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible();
    await page.locator('input[name="password"]').fill("Password123!");
    await triggerAccessRejection(page,"acceptInvitation",422,()=>page.locator('#invitation-accept button[type="submit"]').click());
    await expect(page.locator(".login-error")).toContainText("kompromittiert");
    await page.locator('input[name="password"]').fill(env("AORA_INVITATION_PASSWORD"));
    await triggerAccessAction(page,"acceptInvitation",()=>page.locator('#invitation-accept button[type="submit"]').click());
    await expect(page.locator(".admin-app")).toBeVisible();
    expect(await page.locator("#loc-select option").count()).toBe(1);
    await page.locator('[data-a="logout"]').click();
    await passwordLogin(page,"manager",env("AORA_INVITATION_EMAIL"),env("AORA_INVITATION_PASSWORD"));
    await page.locator('[data-a="logout"]').click();
    await page.goto(env("AORA_INVITATION_URL"));
    await expect(page.locator(".login-error")).toContainText(/bereits aktiviert|nicht mehr verfügbar/);
  });
});