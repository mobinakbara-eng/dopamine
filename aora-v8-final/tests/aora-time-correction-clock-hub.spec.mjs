import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const route={employee:"/arbeitnehmer/",manager:"/arbeitgeber/"};
const shell={employee:".employee-app",manager:".admin-app"};

function isAction(request,functionName,action){
  return request.method()==="POST"&&request.url().includes(`/functions/v1/${functionName}`)&&String(request.postData()||"").includes(`"action":"${action}"`);
}
async function login(page,role,email,password){
  await page.goto(`${route[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const responsePromise=page.waitForResponse(response=>isAction(response.request(),"aora-v8-pilot-access","passwordLogin"),{timeout:30000});
  await page.locator('#password-login button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator(shell[role])).toBeVisible({timeout:30000});
}
async function worktime(page,action,trigger,status=200){
  const responsePromise=page.waitForResponse(response=>isAction(response.request(),"aora-v8-worktime-center",action),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  expect(response.status(),JSON.stringify(body)).toBe(status);
  return body;
}
function diagnostics(page){
  const rows=[];
  page.on("pageerror",error=>rows.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")rows.push(`console:${message.text()}`)});
  return rows;
}

test.describe.serial("Unified worktime center",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("employee keeps one simple time page with correction history",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const browserErrors=diagnostics(page);
    await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('.employee-bottom [data-view="time"]').click();
    await expect(page.getByRole("heading",{name:"Korrektur & Stempeluhr"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Deine Korrekturanfragen"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Erfasste Arbeitszeiten"})).toBeVisible();
    const kiosk=page.locator("[data-time-hub-kiosk-link]").first();
    await expect(kiosk).toHaveAttribute("target","_blank");
    await expect(kiosk).toHaveAttribute("rel",/noopener/);
    await expect(page.locator(".employee-correction-fab")).toHaveCount(0);
    const correctionButton=page.locator('[data-time-hub-action="correct-entry"]:not([disabled])').first();
    const selectedEntry=await correctionButton.getAttribute("data-entry-id");
    await correctionButton.click();
    const dialog=page.locator("#aora-compliance-dialog");
    await expect(dialog.getByRole("heading",{name:"Korrektur beantragen"})).toBeVisible();
    await expect(dialog.locator('select[name="timeEntryId"]')).toHaveValue(selectedEntry);
    await dialog.locator('[data-compliance-action="close"]').first().click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
    expect(browserErrors).toEqual([]);
  });

  test("manager sees one Arbeitszeit navigation instead of overlapping sections",async({page})=>{
    const browserErrors=diagnostics(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    const nav=page.locator('.admin-nav [data-view="worktime"]');
    await expect(nav).toBeVisible();
    for(const removed of ["time-control","time","reports","approvals"])await expect(page.locator(`.admin-nav [data-view="${removed}"]`)).toHaveCount(0);
    await expect(page.locator('.admin-nav [data-view="compliance"]')).toContainText("Prüfung & Exporte");
    await nav.click();
    await expect(page.getByRole("heading",{name:"Stempeln, prüfen, ändern und abschließen."})).toBeVisible();
    await expect(page.locator(".worktime-tabs button")).toHaveCount(5);
    await expect(page.getByText("Direkte Aktion").first()).toBeVisible();
    await expect(page.getByText("Nachträgliche Änderung").first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
    expect(browserErrors).toEqual([]);
  });

  test("manager punches directly; historical edit waits for employee approval",async({page,browser})=>{
    const managerErrors=diagnostics(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await page.locator('.admin-nav [data-view="worktime"]').click();
    let employeeCard=page.locator(".worktime-person").filter({hasText:"CI Employee"}).first();

    await employeeCard.getByRole("button",{name:"Einstempeln"}).click();
    let dialog=page.locator("#aora-worktime-dialog");
    await expect(dialog.getByText("Sofort wirksam")).toBeVisible();
    await dialog.locator('textarea[name="reason"]').fill("Mitarbeiter hat das Einstempeln am Kiosk vergessen");
    await worktime(page,"managerPunch",()=>dialog.locator('button[type="submit"]').click());
    await expect.poll(()=>page.evaluate(()=>S.state.timeEntries.some(item=>item.status==="live"&&item.source==="manager_direct")),{timeout:30000}).toBe(true);

    employeeCard=page.locator(".worktime-person").filter({hasText:"CI Employee"}).first();
    await employeeCard.getByRole("button",{name:"Ausstempeln"}).click();
    dialog=page.locator("#aora-worktime-dialog");
    await dialog.locator('textarea[name="reason"]').fill("Manager beendet die vergessene laufende Arbeitszeit");
    await worktime(page,"managerPunch",()=>dialog.locator('button[type="submit"]').click());
    await expect.poll(()=>page.evaluate(()=>S.state.timeEntries.find(item=>item.source==="manager_direct"&&item.status==="completed")?.id||""),{timeout:30000}).not.toBe("");
    const entryId=await page.evaluate(()=>S.state.timeEntries.find(item=>item.source==="manager_direct"&&item.status==="completed")?.id||"");

    await page.locator('[data-worktime-action="tab"][data-tab="entries"]').click();
    const row=page.locator(".worktime-entry").filter({hasText:"Durch Manager gestempelt"}).first();
    await row.getByRole("button",{name:"Änderung vorschlagen"}).click();
    dialog=page.locator("#aora-worktime-dialog");
    await expect(dialog.getByText("Erst nach Bestätigung wirksam")).toBeVisible();
    await dialog.locator('input[name="start"]').fill("09:10");
    await dialog.locator('input[name="end"]').fill("17:20");
    await dialog.locator('input[name="breakMinutes"]').fill("35");
    await dialog.locator('textarea[name="reason"]').fill("Tatsächliche Arbeitszeit laut Schichtleitung korrigieren");
    const proposed=await worktime(page,"managerRequestChange",()=>dialog.locator('button[type="submit"]').click(),201);
    expect(proposed.correctionId).toBeTruthy();
    expect((await page.evaluate(id=>S.state.timeEntries.find(item=>item.id===id)?.start,entryId))).not.toBe("09:10");

    const employeeContext=await browser.newContext();
    const employee=await employeeContext.newPage();
    const employeeErrors=diagnostics(employee);
    await login(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await employee.locator('.employee-bottom [data-view="time"]').click();
    const approval=employee.locator(".worktime-employee-approval").filter({hasText:"09:10–17:20"}).first();
    await expect(approval).toBeVisible({timeout:30000});
    await expect(approval).toContainText("Tatsächliche Arbeitszeit");
    await worktime(employee,"decideChange",()=>approval.getByRole("button",{name:"Bestätigen"}).click());
    await expect.poll(()=>employee.evaluate(id=>{
      const item=S.state.timeEntries.find(entry=>entry.id===id);
      return item?{start:item.start,end:item.end,breakMinutes:item.breakMinutes,durationMinutes:item.durationMinutes}:null;
    },entryId),{timeout:30000}).toEqual({start:"09:10",end:"17:20",breakMinutes:35,durationMinutes:455});
    expect(employeeErrors).toEqual([]);
    await employeeContext.close();

    await worktime(page,"overview",()=>page.locator('[data-worktime-action="refresh"]').click());
    await page.locator('[data-worktime-action="tab"][data-tab="changes"]').click();
    await expect(page.locator(".worktime-change").filter({hasText:"09:10–17:20"}).first()).toContainText("Bestätigt",{timeout:30000});
    expect(managerErrors).toEqual([]);
  });
});
