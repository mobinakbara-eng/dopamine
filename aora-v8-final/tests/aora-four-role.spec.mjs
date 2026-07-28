import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG||"aora-demo";
const supabaseUrl=process.env.AORA_SUPABASE_URL||"https://xqgkawskftzurbujrpex.supabase.co";
const paths={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
function env(name){const value=process.env[name];if(!value)throw new Error(`Missing required staging secret: ${name}`);return value}
function safeUrl(input){try{const url=new URL(input);for(const key of ["token","session","key"])if(url.searchParams.has(key))url.searchParams.set(key,"[REDACTED]");return url.pathname+url.search}catch{return String(input).replace(/([?&](?:token|session|key)=)[^&#\s]+/gi,"$1[REDACTED]")}}
function diagnostics(page,{allowOffline=false}={}){
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{if(!allowOffline)errors.push(`network:${request.failure()?.errorText||"failed"}:${safeUrl(request.url())}`)});
  return()=>errors;
}
async function passwordLogin(page,role,email,password){
  await page.goto(`${paths[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#password-login button[type="submit"]').click();
  await page.waitForFunction(({workspace,role})=>Boolean(sessionStorage.getItem(`aora:${workspace}:${role}`)),{workspace,role});
  await expect(page).toHaveURL(new RegExp(`workspace=${workspace}`));
  await expect(page.locator("body")).not.toContainText("Verbindung nicht möglich");
}
async function kioskLogin(page){
  await page.goto(`${paths.kiosk}?workspace=${encodeURIComponent(workspace)}`);
  const deviceId=env("AORA_KIOSK_DEVICE_ID");
  await page.locator('select[name="subject"]').selectOption(deviceId);
  await page.locator('input[name="pin"]').fill(env("AORA_KIOSK_PIN"));
  await page.locator('#pin-login button[type="submit"]').click();
  await page.waitForFunction(workspace=>Boolean(sessionStorage.getItem(`aora:${workspace}:kiosk`)),workspace);
}

test.describe.serial("Aora 8.1.0 staging role and browser gates",()=>{
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
    await expect(page.locator("#loc-select option")).toHaveCount(Number(process.env.AORA_MANAGER_LOCATION_COUNT||1));
    await page.locator('[data-view="compliance"]').click();
    await expect(page.getByText("Compliance, Exporte und Zeitkorrekturen")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(getErrors()).toEqual([]);
  });

  test("Employee: personal login and correction entry point",async({page})=>{
    const getErrors=diagnostics(page);
    await passwordLogin(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await expect(page.locator('[data-compliance-action="request-correction"]')).toBeVisible();
    await page.waitForTimeout(1500);
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

  test("Invitation: provision, activate, login, tenant scope and replay rejection",async({page,request,browser})=>{
    const onboardingCode=env("AORA_ONBOARDING_CODE");
    const unique=`${Date.now()}-${process.env.GITHUB_RUN_ID||"local"}`;
    const managerEmail=`aora-ci-${unique}@example.com`;
    const password=`Aora-${unique}-Secure9`;
    const provision=await request.post(`${supabaseUrl}/functions/v1/aora-v8-pilot-onboarding`,{data:{
      action:"provision",code:onboardingCode,
      company:{name:`Aora CI ${unique}`,billingEmail:managerEmail,timezone:"Europe/Berlin",language:"de"},
      location:{name:"CI Standort",city:"Berlin",geofenceRadius:100},
      manager:{name:"Aora CI Manager",email:managerEmail},kiosk:{name:"CI Kiosk"}
    }});
    const provisionBody=await provision.text();
    expect(provision.status(),provisionBody).toBe(201);
    const created=JSON.parse(provisionBody);
    const invite=new URL(created.managerInvitation.inviteUrl);
    const localInvite=`${invite.pathname}${invite.search}`;
    await page.goto(localInvite);
    await expect(page.getByText("Konto aktivieren")).toBeVisible();
    await page.locator('input[name="email"]').fill(managerEmail);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="confirm"]').fill(password);
    await page.locator('#invitation-accept button[type="submit"]').click();
    await page.waitForFunction(slug=>Boolean(sessionStorage.getItem(`aora:${slug}:manager`)),created.workspaceSlug);
    await expect(page.locator("#loc-select option")).toHaveCount(1);
    await page.locator('[data-a="logout"]').click();
    await page.locator('input[name="email"]').fill(managerEmail);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('#password-login button[type="submit"]').click();
    await page.waitForFunction(slug=>Boolean(sessionStorage.getItem(`aora:${slug}:manager`)),created.workspaceSlug);
    const replayContext=await browser.newContext();
    const replay=await replayContext.newPage();
    await replay.goto(localInvite);
    await expect(replay.getByText("Link nicht mehr gültig")).toBeVisible();
    await replayContext.close();
  });
});
