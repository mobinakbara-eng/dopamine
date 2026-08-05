import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const flags=["canonical_database","calendar_v2","schedule_board_v2","open_shift_marketplace","task_automation","clockout_task_gate"];
const required=name=>{const value=process.env[name];if(!value)throw new Error(`Missing CI value: ${name}`);return value};
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin"}).format(new Date());

function sanitizeDiagnostic(value){
  return String(value??"")
    .replace(/[0-9a-f]{64}/gi,"[redacted-token]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[redacted-email]")
    .replace(/([?&](?:token|apikey|authorization|password)=)[^&\s"']+/gi,"$1[redacted]")
    .slice(0,1600);
}
function captureDiagnostics(page,label){
  const diagnostics=[];
  page.on("response",async response=>{
    let parsed;
    try{parsed=new URL(response.url())}catch{return}
    if(!parsed.pathname.includes("/functions/v1/")||response.status()<400)return;
    let body="";
    try{body=await response.text()}catch{}
    diagnostics.push({
      label,
      type:"api-response",
      function:parsed.pathname.split("/").filter(Boolean).at(-1)||"unknown",
      status:response.status(),
      body:sanitizeDiagnostic(body)
    });
  });
  page.on("pageerror",error=>diagnostics.push({label,type:"page-error",message:sanitizeDiagnostic(error?.message||error)}));
  return diagnostics;
}
function printDiagnostics(diagnostics){
  if(diagnostics.length)console.error("AORA_SANITIZED_DIAGNOSTICS",JSON.stringify(diagnostics));
}

async function login(page,role,email,secret){
  const route=role==="owner"?"/inhaber/":role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(secret);
  await page.locator('#password-login button[type="submit"]').click();
  await expect(page.locator(role==="employee"?".employee-app":".admin-app")).toBeVisible({timeout:30000});
}

async function context(browser,baseURL){return browser.newContext({baseURL,viewport:{width:1440,height:1000}})}

test("unified Calendar, Schedule, Tasks and clock-out gate pass in the visible period",async({browser,baseURL})=>{
  const date=today();
  const dueAt=new Date(Date.now()+8*3600000).toISOString();
  const templateId=`task_template_release_${Date.now().toString(36)}`;

  const ownerContext=await context(browser,baseURL);
  const owner=await ownerContext.newPage();
  const ownerDiagnostics=captureDiagnostics(owner,"owner");
  await login(owner,"owner",required("AORA_OWNER_EMAIL"),required("AORA_OWNER_PASSWORD"));
  await owner.evaluate(async flags=>{
    for(const flagKey of flags)await uCall("updateFeatureFlag",{flagKey,scopeType:"organization",scopeValue:null,enabled:true,rolloutPercentage:100,config:{releaseGate:true}});
    await uLoadFlags();render();
  },flags);
  const enabled=await owner.evaluate(()=>Object.fromEntries(Object.entries(S.u.flags).map(([key,value])=>[key,Boolean(value.enabled)])));
  for(const flag of flags)expect(enabled[flag]).toBe(true);

  const managerContext=await context(browser,baseURL);
  const manager=await managerContext.newPage();
  const managerDiagnostics=captureDiagnostics(manager,"manager");
  await login(manager,"manager",required("AORA_MANAGER_EMAIL"),required("AORA_MANAGER_PASSWORD"));
  const setup=await manager.evaluate(async({templateId,date,dueAt})=>{
    const locationId=S.locationId||S.state.locations[0]?.id;
    const employeeId=S.state.employees[0]?.id;
    if(!locationId||!employeeId)throw new Error("CI fixture is incomplete");
    await uCall("saveTaskTemplate",{template:{id:templateId,locationId,title:"Release Opening Checklist",description:"Unified release gate",category:"opening",clockoutPolicy:"MANAGER_OVERRIDE",reviewRequired:false,active:true,version:1,items:[{id:"item_done",type:"checkbox",required:true,label:"Öffnung geprüft"}]}});
    const shift=await uCall("createShift",{shift:{locationId,employeeId,date,start:"12:00",end:"14:00",breakMinutes:0,status:"published",version:1},ruleOverride:{confirmed:true,reason:"Automatisierter Release-Gate-Test"}});
    const task=await uCall("createManualTask",{locationId,templateId,employeeIds:[employeeId],date,dueAt},true);
    return{locationId,shiftId:shift.shiftId,taskId:task.taskIds[0]};
  },{templateId,date,dueAt});
  expect(setup.shiftId).toMatch(/^shift_/);
  expect(setup.taskId).toMatch(/^task_/);

  try{
    await manager.locator('.admin-nav [data-a="admin-view"][data-view="schedule"]').click();
    await expect(manager.getByText("Weekly Planning Board")).toBeVisible({timeout:30000});
    await expect(manager.getByText("12:00–14:00").first()).toBeVisible();
    await manager.locator('.admin-nav [data-a="admin-view"][data-view="tasks"]').click();
    await expect(manager.getByText("Task Automation")).toBeVisible({timeout:30000});
    await expect(manager.getByText("Release Opening Checklist").first()).toBeVisible();
  }catch(error){
    printDiagnostics([...ownerDiagnostics,...managerDiagnostics]);
    throw error;
  }

  const employeeContext=await context(browser,baseURL);
  const employee=await employeeContext.newPage();
  const employeeDiagnostics=captureDiagnostics(employee,"employee");
  await login(employee,"employee",required("AORA_EMPLOYEE_EMAIL"),required("AORA_EMPLOYEE_PASSWORD"));
  try{
    await employee.locator('.employee-bottom [data-a="employee-view"][data-view="calendar"]').click();
    await expect(employee.locator(".aora-calendar-page")).toBeVisible({timeout:30000});
    await expect(employee.locator(".aora-calendar-grid")).toBeVisible();
    await expect(employee.locator(".aora-cal-sheet")).toBeVisible();
    await expect(employee.locator(".aora-cal-entry-shift").filter({hasText:/12:00\s*[–-]\s*14:00/}).first()).toBeVisible({timeout:30000});
    await employee.locator('.employee-bottom [data-u="employee-tasks"]').click();
    await expect(employee.getByText("Meine Aufgaben")).toBeVisible({timeout:30000});
    await expect(employee.getByText("Release Opening Checklist").first()).toBeVisible();

    const gateBefore=await employee.evaluate(async locationId=>uCall("clockoutGate",{locationId,employeeId:S.session.subjectId}),setup.locationId);
    expect(gateBefore.allowed).toBe(false);
    const checkbox=employee.locator('[data-u-task-input][data-item="item_done"]');
    await checkbox.check();
    await expect(employee.getByText("Antwort gespeichert.")).toBeVisible({timeout:15000});
    await employee.locator(`[data-u="task-submit"][data-id="${setup.taskId}"]`).click();
    await expect(employee.getByText("Aufgabe abgeschlossen.")).toBeVisible({timeout:15000});
    const gateAfter=await employee.evaluate(async locationId=>uCall("clockoutGate",{locationId,employeeId:S.session.subjectId}),setup.locationId);
    expect(gateAfter.allowed).toBe(true);
    expect(gateAfter.blockingCount).toBe(0);

    const registrations=await employee.evaluate(async()=>await navigator.serviceWorker.getRegistrations().then(items=>items.map(item=>item.scope)));
    expect(new Set(registrations).size).toBe(registrations.length);
  }catch(error){
    printDiagnostics([...ownerDiagnostics,...managerDiagnostics,...employeeDiagnostics]);
    throw error;
  }

  await owner.evaluate(async flags=>{
    for(const flagKey of flags)await uCall("updateFeatureFlag",{flagKey,scopeType:"organization",scopeValue:null,enabled:false,rolloutPercentage:100,config:{releaseGate:true}});
  },flags);
  await employeeContext.close();
  await managerContext.close();
  await ownerContext.close();
});
