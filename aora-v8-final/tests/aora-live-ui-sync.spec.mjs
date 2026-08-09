import {test,expect} from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const pathFor={manager:"/arbeitgeber/",employee:"/arbeitnehmer/",kiosk:"/kiosk/dashboard/"};
const shellFor={manager:".admin-app",employee:".employee-app",kiosk:".kiosk-app"};

function actionRequest(request,functionName,action){
  return request.method()==="POST"&&request.url().includes(`/functions/v1/${functionName}`)&&String(request.postData()||"").includes(`"action":"${action}"`);
}
async function observe(page,predicate,trigger,allowed=[200,201]){
  const responsePromise=page.waitForResponse(response=>predicate(response.request()),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  if(!allowed.includes(response.status()))throw new Error(`HTTP ${response.status()}: ${JSON.stringify(body).slice(0,300)}`);
  return body;
}
async function login(page,role,email,password){
  await page.goto(`${pathFor[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await observe(page,request=>actionRequest(request,"aora-v8-pilot-access","passwordLogin"),()=>page.locator('#password-login button[type="submit"]').click());
  await expect(page.locator(shellFor[role])).toBeVisible({timeout:30000});
}
async function kioskLogin(page){
  await page.goto(`${pathFor.kiosk}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="subject"]').fill(env("AORA_KIOSK_DEVICE_ID"));
  await page.locator('input[name="pin"]').fill(env("AORA_KIOSK_PIN"));
  await observe(page,request=>actionRequest(request,"aora-v8-pilot-access","login"),()=>page.locator('#pin-login button[type="submit"]').click());
  await expect(page.locator(shellFor.kiosk)).toBeVisible({timeout:30000});
}

// Regression for the production iOS report: the visible Löschen button existed, but
// the old bubbling document listener never reached the lifecycle Edge Function.
test("Manager lifecycle buttons reach the API from the visible Tasks page",async({page})=>{
  await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
  await page.locator('.admin-nav [data-a="admin-view"][data-view="tasks"]').click();
  const deleteButton=page.locator("[data-aora-template-delete]").first();
  await expect(deleteButton).toBeVisible({timeout:30000});

  const calls=[];
  await page.route("**/functions/v1/aora-v8-task-lifecycle",async route=>{
    const request=route.request();
    let body={};
    try{body=JSON.parse(request.postData()||"{}")}catch{}
    if(body.action==="deleteTemplate"){
      calls.push(body);
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({request_id:"browser-test",data:{deleted:true,deletedRules:0},error:null})});
      return;
    }
    await route.continue();
  });
  page.once("dialog",dialog=>dialog.accept());
  await deleteButton.click();
  await expect.poll(()=>calls.length,{timeout:10000}).toBe(1);
  expect(String(calls[0].templateId||"").length).toBeGreaterThan(2);
});

// Regression for the production refresh report: kiosk -> employee and employee approval
// must update without page.reload(). This deliberately uses separate browser contexts, so
// the assertion depends on the server realtime fan-out rather than same-tab shared memory.
test("Kiosk clock changes reconcile the Employee UI without reload",async({page,context,browser})=>{
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({latitude:52.52,longitude:13.405,accuracy:20});
  await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));

  const employeeId=await page.evaluate(()=>String(S.session?.subjectId||""));
  const initiallyLive=await page.evaluate(id=>(S.state?.timeEntries||[]).some(item=>String(item.employeeId??item.employee_id)===id&&["live","paused"].includes(String(item.status||""))),employeeId);

  const kioskContext=await browser.newContext();
  const kiosk=await kioskContext.newPage();
  await kioskLogin(kiosk);
  await kiosk.locator(`[data-a="select-person"][data-id="${employeeId}"]`).click();

  const firstTarget=initiallyLive?"out":"in";
  await expect(kiosk.locator(`[data-a="transition"][data-target="${firstTarget}"]`)).toBeVisible({timeout:30000});
  await kiosk.locator(`[data-a="transition"][data-target="${firstTarget}"]`).click();

  // No employee.reload() here. Realtime must surface the pending confirmation.
  await expect(page.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
  await observe(page,request=>String(request.postData()||"").includes('"type":"APPROVE_CLOCK_REQUEST"'),()=>page.locator('[data-a="clock-approve"]').click());
  await page.locator('.employee-bottom [data-view="time"]').click();
  await expect(page.locator(".time-hub-clock-state")).toContainText(initiallyLive?"Nicht eingestempelt":"Eingestempelt",{timeout:30000});

  // Return the isolated tenant to its original live/not-live state and verify the reverse path too.
  await kiosk.locator(`[data-a="select-person"][data-id="${employeeId}"]`).click();
  const secondTarget=initiallyLive?"in":"out";
  await expect(kiosk.locator(`[data-a="transition"][data-target="${secondTarget}"]`)).toBeVisible({timeout:30000});
  await kiosk.locator(`[data-a="transition"][data-target="${secondTarget}"]`).click();
  await expect(page.locator('[data-a="clock-approve"]')).toBeVisible({timeout:30000});
  await observe(page,request=>String(request.postData()||"").includes('"type":"APPROVE_CLOCK_REQUEST"'),()=>page.locator('[data-a="clock-approve"]').click());
  await page.locator('.employee-bottom [data-view="time"]').click();
  await expect(page.locator(".time-hub-clock-state")).toContainText(initiallyLive?"Eingestempelt":"Nicht eingestempelt",{timeout:30000});

  await kioskContext.close();
});
