import { test, expect } from "@playwright/test";

// Coverage contract: every navigation view; exports and verified backup; all scoped views;
// every tab; submit and approve leave plus time correction; encrypted offline queue;
// inside/outside geofence enforcement; Invitation: reject breached password.
const workspace=process.env.AORA_WORKSPACE_SLUG;
const pathFor={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
const shellFor={owner:".admin-app",manager:".admin-app",employee:".employee-app",kiosk:".kiosk-app"};
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const correctionReason=()=>`Agent QA correction ${workspace}`;
const newsTitle=()=>`Manager News QA ${workspace}`;
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
async function triggerAccessRejection(page,action,expectedStatus,trigger){return access(page,action,trigger,[expectedStatus])}
async function triggerWorkspaceRejection(page,type,expectedStatus,trigger){return workspaceEvent(page,type,trigger,[expectedStatus])}

function diagnostics(page,{allowOffline=false}={}){
  const errors=[];
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed";
    if(allowOffline&&reason.includes("ERR_INTERNET_DISCONNECTED"))return;
    if(reason==="net::ERR_ABORTED"&&/(compliance-proxy|realtime-broadcast|pilot-access|workspace-rules)/.test(request.url()))return;
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
async function assertNoHorizontalOverflow(page){const value=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));expect(value.scroll).toBeLessThanOrEqual(value.width+2)}
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

  test("Owner: every navigation view, exports and verified backup",async({page,browser,baseURL})=>{
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
    await page.evaluate(()=>{
      const location=S.state.locations.find(item=>item.id===S.locationId);
      location.name='<img id="stored-location-xss" src=x onerror=alert(1)>';
      S.state.announcements.push({id:"stored-xss-check",audience:location.id,title:"Escaping QA",body:"Location names stay text."});
      S.adminView="news";
      renderAdmin();
    });
    await expect(page.locator("#stored-location-xss")).toHaveCount(0);
    await expect(page.locator("option",{hasText:'<img id="stored-location-xss" src=x onerror=alert(1)>'}).first()).toHaveText('<img id="stored-location-xss" src=x onerror=alert(1)>');
    await assertNoHorizontalOverflow(page);
    expect(errors()).toEqual([]);
  });

  test("Manager: all scoped views and unified worktime shell",async({page,browser})=>{
    const errors=diagnostics(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await expect(page.locator("#loc-select option")).toHaveCount(Number(env("AORA_MANAGER_LOCATION_COUNT")));
    const views=await visitAdminViews(page);
    expect(views).toEqual(expect.arrayContaining(["overview","schedule","worktime","leave","employees","news","kiosk","compliance","settings"]));
    for(const removed of ["time","time-control","reports","approvals"])expect(views).not.toContain(removed);
    await page.locator('.admin-nav [data-view="worktime"]').click();
    await expect(page.locator(".worktime-tabs button")).toHaveCount(5);

    await page.locator('.admin-nav [data-view="news"]').click();
    await page.locator('[data-a="news-modal"]').click();
    const newsModal=page.locator(".modal-backdrop .modal").last();
    await newsModal.locator('input[name="title"]').fill(newsTitle());
    await newsModal.locator('textarea[name="body"]').fill("Diese Mitteilung wurde durch den Manager-End-to-End-Test veröffentlicht.");
    const announcement=await workspaceEvent(page,"ADD_ANNOUNCEMENT",()=>newsModal.locator('button[type="submit"]').click());
    expect(announcement.state.announcements.some(item=>item.title===newsTitle())).toBe(true);
    await expect(newsModal).toBeHidden({timeout:30000});
    await expect(page.getByRole("heading",{name:newsTitle()})).toBeVisible();

    await page.locator('.admin-nav [data-view="kiosk"]').click();
    await page.locator('[data-a="kiosk-create-modal"]').click();
    const modal=page.locator(".modal-backdrop .modal").last();
    await modal.locator('input[name="name"]').fill(`Manager Kiosk ${Date.now()}`);
    const created=await workspaceEvent(page,"CREATE_KIOSK_DEVICE",()=>modal.locator('button[type="submit"]').click());
    expect(created.kioskActivation.activationCode).toMatch(/^\d{8}$/);
    expect(new URL(created.kioskActivation.kioskUrl).searchParams.get("workspace")).toBe(workspace);
    const context=await browser.newContext();
    const kiosk=await context.newPage();
    await kiosk.goto(created.kioskActivation.kioskUrl);
    await kiosk.locator('input[name="subject"]').fill(created.kioskActivation.deviceId);
    await kiosk.locator('input[name="pin"]').fill(created.kioskActivation.activationCode);
    await access(kiosk,"login",()=>kiosk.locator('#pin-login button[type="submit"]').click());
    await expect(kiosk.locator(".kiosk-app")).toBeVisible({timeout:30000});
    await context.close();
    await assertNoHorizontalOverflow(page);
    expect(errors()).toEqual([]);
  });

  test("Employee: every tab; submit and approve leave plus time correction",async({page,browser})=>{
    const errors=diagnostics(page);
    await page.setViewportSize({width:390,height:844});
    await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    expect(await page.evaluate(title=>S.state.announcements.some(item=>item.title===title),newsTitle())).toBe(true);
    const tabs=await page.locator('.employee-bottom [data-a="employee-view"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.view));
    expect(tabs).toEqual(["home","calendar","time","leave","more"]);
    for(const view of tabs){await page.locator(`.employee-bottom [data-view="${view}"]`).click();await healthy(page);await assertNoHorizontalOverflow(page)}

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
    await workspaceEvent(manager,"DECIDE_LEAVE",()=>leaveRow.locator('[data-decision="approved"]').click());

    await manager.locator('.admin-nav [data-view="worktime"]').click();
    await manager.locator('[data-worktime-action="tab"][data-tab="changes"]').click();
    const row=manager.locator(".worktime-change").filter({hasText:correctionReason()}).first();
    await expect(row).toBeVisible({timeout:30000});
    await worktime(manager,"decideChange",()=>row.locator('[data-worktime-action="decide"][data-decision="approved"]').click());
    await expect.poll(()=>manager.evaluate(()=>{const entry=S.state.timeEntries.find(item=>item.end);return{breakMinutes:entry?.breakMinutes,durationMinutes:entry?.durationMinutes}}),{timeout:30000}).toEqual({breakMinutes:5,durationMinutes:505});
    await context.close();
    expect(errors()).toEqual([]);
  });

  test("Kiosk: encrypted offline queue and inside/outside geofence enforcement",async({page,context,browser})=>{
    const errors=diagnostics(page,{allowOffline:true});
    await kioskLogin(page);
    await page.locator('[data-a="select-person"]').first().click();
    await context.setOffline(true);
    await page.locator('[data-a="transition"]').first().click();
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:15000}).toEqual(expect.arrayContaining([expect.objectContaining({status:"pending",hasCiphertext:true,hasPlaintextPayload:false})]));
    await context.setOffline(false);
    await page.evaluate(()=>syncOfflinePunchQueue());
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:30000}).toEqual([]);

    const workspaceBinding=await page.evaluate(async currentSlug=>{
      const sessionRecords=await withStore(OFFLINE_SESSION_STORE,"readonly",store=>idbRequest(store.getAll()));
      const originalSlug=CFG.slug;
      CFG.slug=`${currentSlug}-other`;
      const foreign=await restoreOfflineKioskSession();
      CFG.slug=originalSlug;
      const matching=await restoreOfflineKioskSession();
      return{storedSlug:sessionRecords.at(-1)?.workspaceSlug,foreign:Boolean(foreign),matching:Boolean(matching)};
    },workspace);
    expect(workspaceBinding).toEqual({storedSlug:workspace,foreign:false,matching:true});

    const deadLetter=await page.evaluate(async()=>{
      const employeeId=S.state.employees[0].id;
      const eventId=crypto.randomUUID();
      await enqueueOfflinePunch({type:"KIOSK_TRANSITION",eventId,employeeId,target:"in",clientCreatedAt:new Date().toISOString(),clientTimezone:CFG.tz,deviceClockOffset:new Date().getTimezoneOffset()});
      const originalWorkspace=workspace;
      const fail=status=>{const error=new Error(status===403?"Gerät gesperrt":"Vorübergehend nicht erreichbar");error.status=status;throw error};
      try{
        workspace=async()=>fail(503);
        await syncOfflinePunchQueue();
        const first=(await inspectOfflineQueue()).find(record=>record.eventId===eventId);
        await syncOfflinePunchQueue();
        const second=(await inspectOfflineQueue()).find(record=>record.eventId===eventId);
        workspace=async()=>fail(403);
        await syncOfflinePunchQueue();
        const terminal=(await inspectOfflineQueue()).find(record=>record.eventId===eventId);
        return{first,second,terminal};
      }finally{workspace=originalWorkspace}
    });
    expect(deadLetter.first).toMatchObject({status:"pending",retryCount:1});
    expect(deadLetter.second).toMatchObject({status:"pending",retryCount:2});
    expect(deadLetter.terminal).toMatchObject({status:"failed",retryCount:3});
    await expect(page.locator('#aora-offline-status.failed [data-offline-action="discard"]')).toBeVisible();
    page.once("dialog",dialog=>dialog.accept());
    await page.locator('#aora-offline-status [data-offline-action="discard"]').click();
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue())).toEqual([]);

    const employeeContext=await browser.newContext({permissions:["geolocation"],geolocation:{latitude:52.52,longitude:13.405,accuracy:20}});
    const employee=await employeeContext.newPage();
    await login(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
    const clockIn=await workspaceEvent(employee,"APPROVE_CLOCK_REQUEST",()=>employee.locator('[data-a="clock-approve"]').click());
    expect(clockIn.state.timeEntries.some(item=>item.status==="live"&&item.source==="secure_kiosk")).toBe(true);

    await page.reload();
    await expect(page.locator(".kiosk-app")).toBeVisible({timeout:30000});
    await page.locator('[data-a="select-person"]').first().click();
    await page.locator('[data-a="transition"][data-target="pause"]').click();
    await employee.reload();
    await expect(employee.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
    await employeeContext.setGeolocation({latitude:52.62,longitude:13.405,accuracy:20});
    const outside=await triggerWorkspaceRejection(employee,"APPROVE_CLOCK_REQUEST",403,()=>employee.locator('[data-a="clock-approve"]').click());
    expect(String(outside.error||"")).toContain("Ausserhalb des Standorts");
    await employeeContext.setGeolocation({latitude:52.52,longitude:13.405,accuracy:20});
    const paused=await workspaceEvent(employee,"APPROVE_CLOCK_REQUEST",()=>employee.locator('[data-a="clock-approve"]').click());
    expect(paused.state.timeEntries.some(item=>item.status==="paused")).toBe(true);
    await employeeContext.close();
    expect(errors()).toEqual([]);
  });

  test("Invitation: reject breached password, activate and block replay",async({page,browser,baseURL})=>{
    const source=new URL(env("AORA_INVITATION_URL"));
    const url=new URL(`${source.pathname}${source.search}`,baseURL).toString();
    const email=env("AORA_INVITATION_EMAIL"),password=env("AORA_INVITATION_PASSWORD");
    await page.goto(url);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill("Password123!");
    await page.locator('input[name="confirm"]').fill("Password123!");
    const rejected=await triggerAccessRejection(page,"acceptInvitation",400,()=>page.locator('#invitation-accept button[type="submit"]').click());
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
