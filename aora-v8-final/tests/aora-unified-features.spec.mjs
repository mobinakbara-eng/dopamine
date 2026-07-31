import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const flags=["canonical_database","calendar_v2","schedule_board_v2","open_shift_marketplace","task_automation","clockout_task_gate"];

function env(name){const value=process.env[name];if(!value)throw new Error(`Missing required ephemeral CI value: ${name}`);return value}
function berlinDate(offsetDays=0){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date(Date.now()+offsetDays*86400000))}
function diagnostics(page){
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed";
    const url=request.url();
    const expectedAbort=reason==="net::ERR_ABORTED"&&(url.includes("aora-v8-pilot-realtime-broadcast")||url.includes("aora-v8-pilot-compliance-proxy"));
    if(!expectedAbort)errors.push(`network:${reason}:${new URL(url).pathname}`);
  });
  return()=>errors;
}
async function passwordLogin(page,role,email,password){
  const path=role==="owner"?"/inhaber/":role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${path}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const response=page.waitForResponse(value=>value.request().method()==="POST"&&value.url().includes("/aora-v8-pilot-access")&&String(value.request().postData()||"").includes('"action":"passwordLogin"'));
  await page.locator('#password-login button[type="submit"]').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(role==="employee"?".employee-app":".admin-app")).toBeVisible({timeout:30000});
}
async function setFlags(page,enabled){
  await page.evaluate(async({flags,enabled})=>{
    for(const flagKey of flags){
      await uCall("updateFeatureFlag",{flagKey,scopeType:"organization",scopeValue:null,enabled,rolloutPercentage:100,config:{e2e:true}});
    }
    await uLoadFlags();
    render();
  },{flags,enabled});
}

async function createContext(browser,baseURL){return browser.newContext({baseURL,viewport:{width:1440,height:1000}})}

test.describe.serial("Aora unified workforce feature gates",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("Calendar V2, Schedule Board, Task Automation, clock-out gate and service worker work together",async({browser,baseURL})=>{
    const suffix=Date.now().toString(36);
    const date=berlinDate(3);
    const dueAt=new Date(Date.now()+3*86400000+18*3600000).toISOString();
    const templateId=`task_template_e2e_${suffix}`;

    const ownerContext=await createContext(browser,baseURL);
    const owner=await ownerContext.newPage();
    const ownerErrors=diagnostics(owner);
    await passwordLogin(owner,"owner",env("AORA_OWNER_EMAIL"),env("AORA_OWNER_PASSWORD"));
    await setFlags(owner,true);
    const enabled=await owner.evaluate(()=>Object.fromEntries(Object.entries(S.u.flags).map(([key,value])=>[key,Boolean(value.enabled)])));
    for(const flag of flags)expect(enabled[flag]).toBe(true);

    const managerContext=await createContext(browser,baseURL);
    const manager=await managerContext.newPage();
    const managerErrors=diagnostics(manager);
    await passwordLogin(manager,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));

    const setup=await manager.evaluate(async({templateId,date,dueAt})=>{
      const locationId=S.locationId||S.state.locations[0]?.id;
      const employeeId=S.state.employees[0]?.id;
      if(!locationId||!employeeId)throw new Error("CI location or employee missing");
      await uCall("saveTaskTemplate",{template:{
        id:templateId,locationId,title:"E2E Opening Checklist",description:"Unified feature release gate",
        category:"opening",clockoutPolicy:"MANAGER_OVERRIDE",reviewRequired:false,active:true,version:1,
        items:[{id:"item_done",type:"checkbox",required:true,label:"Öffnung geprüft"}]
      }});
      const shift=await uCall("createShift",{shift:{locationId,employeeId,date,start:"09:00",end:"17:00",breakMinutes:30,status:"published",version:1}});
      const task=await uCall("createManualTask",{locationId,templateId,employeeIds:[employeeId],date,dueAt},true);
      return{locationId,employeeId,shiftId:shift.shiftId,taskId:task.taskIds[0]};
    },{templateId,date,dueAt});
    expect(setup.shiftId).toMatch(/^shift_/);
    expect(setup.taskId).toMatch(/^task_/);

    await manager.locator('.admin-nav [data-a="admin-view"][data-view="schedule"]').click();
    await expect(manager.getByText("Weekly Planning Board")).toBeVisible({timeout:30000});
    await expect(manager.getByText("09:00–17:00").first()).toBeVisible();
    await expect(manager.locator(".u-schedule-board")).toBeVisible();

    await manager.locator('.admin-nav [data-a="admin-view"][data-view="tasks"]').click();
    await expect(manager.getByText("Task Automation")).toBeVisible({timeout:30000});
    await expect(manager.getByText("E2E Opening Checklist").first()).toBeVisible();
    await expect(manager.locator(".u-task-shell")).toBeVisible();

    await expect.poll(async()=>manager.evaluate(async()=>{
      const registration=await navigator.serviceWorker.ready;
      return Boolean(registration.active?.scriptURL.includes("/sw.js"));
    }),{timeout:30000}).toBe(true);

    const employeeContext=await createContext(browser,baseURL);
    const employee=await employeeContext.newPage();
    const employeeErrors=diagnostics(employee);
    await passwordLogin(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));

    await employee.locator('.employee-bottom [data-a="employee-view"][data-view="calendar"]').click();
    await expect(employee.getByText("Dienstplan & Aufgaben")).toBeVisible({timeout:30000});
    await expect(employee.getByText("09:00–17:00").first()).toBeVisible();
    await expect(employee.locator(".u-calendar-shell")).toBeVisible();

    await employee.locator('.employee-bottom [data-u="employee-tasks"]').click();
    await expect(employee.getByText("Meine Aufgaben")).toBeVisible({timeout:30000});
    await expect(employee.getByText("E2E Opening Checklist").first()).toBeVisible();

    const gateBefore=await employee.evaluate(async({locationId})=>uCall("clockoutGate",{locationId,employeeId:S.session.subjectId}),{locationId:setup.locationId});
    expect(gateBefore.allowed).toBe(false);
    expect(gateBefore.blockingCount).toBeGreaterThan(0);

    const checkbox=employee.locator('[data-u-task-input][data-item="item_done"]');
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await expect(employee.getByText("Antwort gespeichert.")).toBeVisible({timeout:15000});
    await employee.locator(`[data-u="task-submit"][data-id="${setup.taskId}"]`).click();
    await expect(employee.getByText("Aufgabe abgeschlossen.")).toBeVisible({timeout:15000});
    await expect(employee.locator(`[data-u="task-select"][data-id="${setup.taskId}"]`)).toContainText("completed",{timeout:30000});

    const gateAfter=await employee.evaluate(async({locationId})=>uCall("clockoutGate",{locationId,employeeId:S.session.subjectId}),{locationId:setup.locationId});
    expect(gateAfter.allowed).toBe(true);
    expect(gateAfter.blockingCount).toBe(0);

    await manager.reload();
    await expect(manager.locator(".admin-app")).toBeVisible({timeout:30000});
    await manager.locator('.admin-nav [data-a="admin-view"][data-view="tasks"]').click();
    await expect(manager.getByText("E2E Opening Checklist").first()).toBeVisible({timeout:30000});
    await expect(manager.getByText("completed").first()).toBeVisible();

    expect(ownerErrors()).toEqual([]);
    expect(managerErrors()).toEqual([]);
    expect(employeeErrors()).toEqual([]);

    await setFlags(owner,false);
    await employeeContext.close();
    await managerContext.close();
    await ownerContext.close();
  });
});
