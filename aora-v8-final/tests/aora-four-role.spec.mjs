import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const pathFor={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
const shellFor={owner:".admin-app",manager:".admin-app",employee:".employee-app",kiosk:".kiosk-app"};
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const correctionReason=()=>`Agent QA correction ${workspace}`;
const futureStart="2026-08-10";
const futureEnd="2026-08-11";

function actionRequest(request,functionName,action){
  return request.method()==="POST"&&request.url().includes(`/functions/v1/${functionName}`)&&String(request.postData()||"").includes(`"action":"${action}"`);
}
function workspaceRequest(request,type){
  if(request.method()!=="POST"||!String(request.postData()||"").includes(`"type":"${type}"`))return false;
  return request.url().includes(["INVITE_MANAGER","CREATE_EMPLOYEE_ACCOUNT","RESEND_INVITATION","REVOKE_INVITATION"].includes(type)?"/aora-v8-invitation-patch":"/aora-v8-pilot-workspace-rules");
}
async function observe(page,predicate,trigger,allowed=[200,201]){
  const responsePromise=page.waitForResponse(response=>predicate(response.request()),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  if(!allowed.includes(response.status()))throw new Error(`HTTP ${response.status()}: ${String(body?.error||"unknown error").slice(0,300)}`);
  return body;
}
const access=(page,action,trigger,allowed)=>observe(page,request=>actionRequest(request,"aora-v8-pilot-access",action),trigger,allowed);
const worktime=(page,action,trigger,allowed)=>observe(page,request=>actionRequest(request,"aora-v8-worktime-center",action),trigger,allowed);
const compliance=(page,action,trigger,allowed)=>observe(page,request=>actionRequest(request,"aora-v8-pilot-compliance-proxy",action),trigger,allowed);
const workspaceEvent=(page,type,trigger,allowed)=>observe(page,request=>workspaceRequest(request,type),trigger,allowed);

function diagnostics(page,{allowOffline=false}={}){
  const errors=[];
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed";
    if(allowOffline&&reason.includes("ERR_INTERNET_DISCONNECTED"))return;
    if(reason==="net::ERR_ABORTED"&&/(compliance-proxy|realtime-broadcast|pilot-access)/.test(request.url()))return;
    errors.push(`network:${reason}:${new URL(request.url()).pathname}`);
  });
  return()=>errors;
}
async function login(page,role,email,password){
  await page.goto(`${pathFor[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await access(page,"passwordLogin",()=>page.locator('#password-login button[type="submit"]').click());
  await expect(page.locator(shellFor[role])).toBeVisible({timeout:30000});
}
async function kioskLogin(page){
  await page.goto(`${pathFor.kiosk}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="subject"]').fill(env("AORA_KIOSK_DEVICE_ID"));
  await page.locator('input[name="pin"]').fill(env("AORA_KIOSK_PIN"));
  await access(page,"login",()=>page.locator('#pin-login button[type="submit"]').click());
  await expect(page.locator(shellFor.kiosk)).toBeVisible({timeout:30000});
}
async function healthy(page){
  await expect(page.locator("body")).not.toContainText(/Verbindung nicht möglich|Anwendungsfehler|Internal Server Error/);
  expect(await page.evaluate(()=>document.body.innerText.trim().length)).toBeGreaterThan(40);
  const duplicateIds=await page.evaluate(()=>{const ids=[...document.querySelectorAll("[id]")].map(node=>node.id).filter(Boolean);return ids.filter((id,index)=>ids.indexOf(id)!==index)});
  expect(duplicateIds).toEqual([]);
}
async function noOverflow(page){const value=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));expect(value.scroll).toBeLessThanOrEqual(value.width+2)}
async function visitAdminViews(page){
  const views=await page.locator('.admin-nav [data-a="admin-view"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.view));
  for(const view of views){
    await page.locator(`.admin-nav [data-view="${view}"]`).click();
    await expect(page.locator(".admin-content")).toBeVisible();
    await healthy(page);
  }
  return views;
}
async function exportFile(page,format){
  const downloadPromise=page.waitForEvent("download",{timeout:30000});
  await page.locator(`[data-compliance-action="export"][data-format="${format}"]`).click();
  const download=await downloadPromise;
  expect(await download.failure()).toBeNull();
  return download.suggestedFilename();
}

test.describe.serial("Aora isolated four-role and unified-worktime gate",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("owner: unified navigation, invitation, technical exports and backup",async({page,browser,baseURL})=>{
    const errors=diagnostics(page);
    await login(page,"owner",env("AORA_OWNER_EMAIL"),env("AORA_OWNER_PASSWORD"));
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["owner-overview","locations","managers","invitations","operations","worktime","compliance","settings"]));
    for(const removed of ["time","time-control","reports","approvals"])expect(views).not.toContain(removed);

    await page.locator('.admin-nav [data-view="owner-overview"]').click();
    await page.locator('[data-a="manager-modal"]').click();
    const modal=page.locator(".modal-backdrop .modal").last();
    await modal.locator('input[name="name"]').fill("Workspace Link QA");
    await modal.locator('input[name="email"]').fill(`workspace-link-${Date.now()}@example.com`);
    await modal.locator('input[name="locationIds"]').first().check();
    const invitation=await workspaceEvent(page,"INVITE_MANAGER",()=>modal.locator('button[type="submit"]').click());
    const inviteUrl=new URL(invitation.delivery.inviteUrl);
    expect(inviteUrl.searchParams.get("workspace")).toBe(workspace);
    const context=await browser.newContext();
    const invitePage=await context.newPage();
    await invitePage.goto(new URL(`${inviteUrl.pathname}${inviteUrl.search}`,baseURL).toString());
    await expect(invitePage.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible({timeout:30000});
    await invitePage.reload();
    await expect(invitePage.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible({timeout:30000});
    await context.close();
    await page.locator(".modal-backdrop .modal").last().locator('[data-a="close"]').first().click();

    await page.locator('.admin-nav [data-view="compliance"]').click();
    await expect(page.getByRole("heading",{name:"Prüfung, Exporte und Backup"})).toBeVisible();
    const filenames=[];
    for(const format of ["csv","audit","steuerberater"])filenames.push(await exportFile(page,format));
    expect(new Set(filenames).size).toBe(3);
    const backup=await compliance(page,"backup",()=>page.locator('[data-compliance-action="backup"]').click());
    expect(backup.verified).toBe(true);
    await noOverflow(page);
    expect(errors()).toEqual([]);
  });

  test("manager: scoped unified views, kiosk creation and responsive shell",async({page,browser})=>{
    const errors=diagnostics(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await expect(page.locator("#loc-select option")).toHaveCount(Number(env("AORA_MANAGER_LOCATION_COUNT")));
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["overview","schedule","worktime","leave","employees","news","kiosk","compliance","settings"]));
    for(const removed of ["time","time-control","reports","approvals"])expect(views).not.toContain(removed);
    await page.locator('.admin-nav [data-view="worktime"]').click();
    await expect(page.locator(".worktime-tabs button")).toHaveCount(5);

    await page.locator('.admin-nav [data-view="kiosk"]').click();
    await page.locator('[data-a="kiosk-create-modal"]').click();
    const modal=page.locator(".modal-backdrop .modal").last();
    await modal.locator('input[name="name"]').fill(`Manager Kiosk ${Date.now()}`);
    const created=await workspaceEvent(page,"CREATE_KIOSK_DEVICE",()=>modal.locator('button[type="submit"]').click());
    expect(created.kioskActivation.activationCode).toMatch(/^\d{8}$/);
    const context=await browser.newContext();
    const kiosk=await context.newPage();
    await kiosk.goto(created.kioskActivation.kioskUrl);
    await kiosk.locator('input[name="subject"]').fill(created.kioskActivation.deviceId);
    await kiosk.locator('input[name="pin"]').fill(created.kioskActivation.activationCode);
    await access(kiosk,"login",()=>kiosk.locator('#pin-login button[type="submit"]').click());
    await expect(kiosk.locator(".kiosk-app")).toBeVisible({timeout:30000});
    await context.close();
    await noOverflow(page);
    expect(errors()).toEqual([]);
  });

  test("employee correction is approved by manager inside Arbeitszeit",async({page,browser})=>{
    const errors=diagnostics(page);
    await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('.employee-bottom [data-view="leave"]').click();
    await page.locator('[data-a="leave-modal"]').click();
    const leave=page.locator(".modal-backdrop .modal").last();
    await leave.locator('input[name="start"]').fill(futureStart);
    await leave.locator('input[name="end"]').fill(futureEnd);
    await leave.locator('textarea[name="note"]').fill(`Agent QA ${workspace}`);
    await leave.locator('button[type="submit"]').click();
    await expect(leave).toBeHidden({timeout:30000});

    await page.locator('.employee-bottom [data-view="time"]').click();
    await page.locator('[data-time-hub-action="request-correction"]').click();
    const correction=page.locator("#aora-compliance-dialog");
    await correction.locator('input[name="breakMinutes"]').fill("5");
    await correction.locator('textarea[name="reason"]').fill(correctionReason());
    await correction.locator('button[type="submit"]').click();
    await expect(correction).toBeHidden({timeout:30000});

    const context=await browser.newContext();
    const manager=await context.newPage();
    await login(manager,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await manager.locator('.admin-nav [data-view="leave"]').click();
    const leaveRow=manager.locator(".leave-row").filter({hasText:futureStart}).first();
    await expect(leaveRow).toBeVisible();
    await leaveRow.locator('[data-decision="approved"]').click();

    await manager.locator('.admin-nav [data-view="worktime"]').click();
    await manager.locator('[data-worktime-action="tab"][data-tab="changes"]').click();
    const row=manager.locator(".worktime-change").filter({hasText:correctionReason()}).first();
    await expect(row).toBeVisible({timeout:30000});
    await worktime(manager,"decideChange",()=>row.locator('[data-worktime-action="decide"][data-decision="approved"]').click());
    await expect.poll(()=>manager.evaluate(()=>{const entry=S.state.timeEntries.find(item=>item.end);return{pause:entry?.breakMinutes,duration:entry?.durationMinutes}}),{timeout:30000}).toEqual({pause:5,duration:505});
    await context.close();
    await noOverflow(page);
    expect(errors()).toEqual([]);
  });

  test("kiosk: encrypted offline queue and geofence approval",async({page,context,browser})=>{
    const errors=diagnostics(page,{allowOffline:true});
    await kioskLogin(page);
    await page.locator('[data-a="select-person"]').first().click();
    await context.setOffline(true);
    await page.locator('[data-a="transition"]').first().click();
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:15000}).toEqual(expect.arrayContaining([expect.objectContaining({status:"pending",hasCiphertext:true,hasPlaintextPayload:false})]));
    await context.setOffline(false);
    await page.evaluate(()=>syncOfflinePunchQueue());
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:30000}).toEqual([]);

    const employeeContext=await browser.newContext({permissions:["geolocation"],geolocation:{latitude:52.52,longitude:13.405,accuracy:20}});
    const employee=await employeeContext.newPage();
    await login(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
    const clockIn=await workspaceEvent(employee,"APPROVE_CLOCK_REQUEST",()=>employee.locator('[data-a="clock-approve"]').click());
    expect(clockIn.state.timeEntries.some(item=>item.status==="live"&&item.source==="secure_kiosk")).toBe(true);
    await employeeContext.close();
    expect(errors()).toEqual([]);
  });

  test("invitation: breached password rejection, activation and replay protection",async({page,browser,baseURL})=>{
    const source=new URL(env("AORA_INVITATION_URL"));
    const url=new URL(`${source.pathname}${source.search}`,baseURL).toString();
    const email=env("AORA_INVITATION_EMAIL"),password=env("AORA_INVITATION_PASSWORD");
    await page.goto(url);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("Password123!");
    await page.locator('input[name="confirm"]').fill("Password123!");
    const rejected=await access(page,"acceptInvitation",()=>page.locator('#invitation-accept button[type="submit"]').click(),[400]);
    expect(String(rejected.error||"")).toContain("Datenlecks");
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirm"]').fill(password);
    await access(page,"acceptInvitation",()=>page.locator('#invitation-accept button[type="submit"]').click());
    await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
    const replayContext=await browser.newContext();
    const replay=await replayContext.newPage();
    await replay.goto(url);
    await expect(replay.getByText("Link nicht mehr gültig")).toBeVisible();
    await replayContext.close();
  });
});
