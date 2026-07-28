import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const paths={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
function env(name){const value=process.env[name];if(!value)throw new Error(`Missing required ephemeral CI value: ${name}`);return value}
function safeUrl(input){try{const url=new URL(input);for(const key of ["token","session","key"])if(url.searchParams.has(key))url.searchParams.set(key,"[REDACTED]");return url.pathname+url.search}catch{return String(input).replace(/([?&](?:token|session|key)=)[^&#\s]+/gi,"$1[REDACTED]")}}
function diagnostics(page,{allowOffline=false}={}){
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{if(!allowOffline)errors.push(`network:${request.failure()?.errorText||"failed"}:${safeUrl(request.url())}`)});
  return()=>errors;
}
function isAccessAction(request,action){
  return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes(`"action":"${action}"`);
}
async function observeAccessAction(page,action,trigger){
  const responsePromise=page.waitForResponse(response=>isAccessAction(response.request(),action),{timeout:15000}).then(response=>({kind:"response",response}));
  const failurePromise=page.waitForEvent("requestfailed",{predicate:request=>isAccessAction(request,action),timeout:15000}).then(request=>({kind:"failure",request}));
  const timeoutPromise=new Promise(resolve=>setTimeout(()=>resolve({kind:"timeout"}),15000));
  await trigger();
  const outcome=await Promise.race([responsePromise,failurePromise,timeoutPromise]);
  if(outcome.kind==="failure")throw new Error(`Access ${action} request failed: ${outcome.request.failure()?.errorText||"unknown network error"}`);
  if(outcome.kind==="timeout"){
    const visible=String(await page.locator("body").innerText()).replace(/\s+/g," ").slice(0,500);
    throw new Error(`Access ${action} POST was not observed. Visible UI: ${visible}`);
  }
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
async function passwordLogin(page,role,email,password){
  await page.goto(`${paths[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await triggerAccessAction(page,"passwordLogin",()=>page.locator('#password-login button[type="submit"]').click());
  await page.waitForFunction(({workspace,role})=>Boolean(sessionStorage.getItem(`aora:${workspace}:${role}`)),{workspace,role});
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
  await expect(page.locator("body")).not.toContainText("Verbindung nicht möglich");
}
async function kioskLogin(page){
  await page.goto(`${paths.kiosk}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('select[name="subject"]').selectOption(env("AORA_KIOSK_DEVICE_ID"));
  await page.locator('input[name="pin"]').fill(env("AORA_KIOSK_PIN"));
  await triggerAccessAction(page,"login",()=>page.locator('#pin-login button[type="submit"]').click());
  await page.waitForFunction(value=>Boolean(sessionStorage.getItem(`aora:${value}:kiosk`)),workspace);
}

test.describe.serial("Aora 8.1.0 isolated staging role and browser gates",()=>{
  test.beforeAll(()=>{env("AORA_WORKSPACE_SLUG")});

  test("Owner: login, workspace routing and compliance center",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"owner",env("AORA_OWNER_EMAIL"),env("AORA_OWNER_PASSWORD"));
    await expect(page.locator('[data-view="owner-overview"]')).toBeVisible();
    await page.locator('[data-view="compliance"]').click();
    await expect(page.getByText("Compliance, Exporte und Zeitkorrekturen")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(getErrors()).toEqual([]);
  });

  test("Manager: scoped login and compliance access",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await expect(page.locator("#loc-select option")).toHaveCount(Number(env("AORA_MANAGER_LOCATION_COUNT")));
    await page.locator('[data-view="compliance"]').click();
    await expect(page.getByText("Compliance, Exporte und Zeitkorrekturen")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(getErrors()).toEqual([]);
  });

  test("Employee: personal login and correction entry point",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(page.locator('[data-compliance-action="request-correction"]')).toBeVisible();
    await page.locator('[data-compliance-action="request-correction"]').click();
    await expect(page.getByText("Korrektur beantragen")).toBeVisible();
    await page.locator('[data-compliance-action="close"]').first().click();
    await page.waitForTimeout(1000);
    expect(getErrors()).toEqual([]);
  });

  test("Kiosk: encrypted offline queue and online resync",async({page,context})=>{
    const getErrors=diagnostics(page,{allowOffline:true});
    await kioskLogin(page);
    const people=page.locator('[data-a="select-person"]');
    await expect(people.first()).toBeVisible();
    await people.first().click();
    await context.setOffline(true);
    await page.locator('[data-a="transition"]').first().click();
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:15000}).toEqual(expect.arrayContaining([expect.objectContaining({status:"pending",hasCiphertext:true,hasPlaintextPayload:false})]));
    await context.setOffline(false);
    await page.evaluate(()=>syncOfflinePunchQueue());
    await expect.poll(()=>page.evaluate(()=>inspectOfflineQueue()),{timeout:30000}).toEqual([]);
    expect(getErrors().filter(item=>!item.includes("ERR_INTERNET_DISCONNECTED"))).toEqual([]);
  });

  test("Invitation: reject breached password, activate, login, scope and replay",async({page,browser,baseURL})=>{
    const invitation=new URL(env("AORA_INVITATION_URL"));
    const localInvite=new URL(`${invitation.pathname}${invitation.search}`,baseURL).toString();
    const invitedEmail=env("AORA_INVITATION_EMAIL"),invitedPassword=env("AORA_INVITATION_PASSWORD");
    await page.goto(localInvite);
    await expect(page.getByRole("heading",{name:"Konto aktivieren"})).toBeVisible();
    await page.locator('input[name="email"]').fill(invitedEmail);

    const breachedPassword="Password123!";
    await page.locator('input[name="password"]').fill(breachedPassword);
    await page.locator('input[name="confirm"]').fill(breachedPassword);
    const rejection=await triggerAccessRejection(page,"acceptInvitation",400,()=>page.locator('#invitation-accept button[type="submit"]').click());
    expect(String(rejection.error||"")).toContain("Datenlecks");
    await expect(page.getByText(/bekannten Datenlecks/)).toBeVisible();
    await expect.poll(()=>page.evaluate(slug=>sessionStorage.getItem(`aora:${slug}:manager`),workspace)).toBeNull();

    await page.locator('input[name="password"]').fill(invitedPassword);
    await page.locator('input[name="confirm"]').fill(invitedPassword);
    await triggerAccessAction(page,"acceptInvitation",()=>page.locator('#invitation-accept button[type="submit"]').click());
    await page.waitForFunction(slug=>Boolean(sessionStorage.getItem(`aora:${slug}:manager`)),workspace);
    await expect(page.locator("#loc-select option")).toHaveCount(1);
    await page.locator('[data-a="logout"]').click();
    await page.locator('input[name="email"]').fill(invitedEmail);
    await page.locator('input[name="password"]').fill(invitedPassword);
    await triggerAccessAction(page,"passwordLogin",()=>page.locator('#password-login button[type="submit"]').click());
    await page.waitForFunction(slug=>Boolean(sessionStorage.getItem(`aora:${slug}:manager`)),workspace);
    const replayContext=await browser.newContext();
    const replay=await replayContext.newPage();
    await replay.goto(localInvite);
    await expect(replay.getByText("Link nicht mehr gültig")).toBeVisible();
    await replayContext.close();
  });
});