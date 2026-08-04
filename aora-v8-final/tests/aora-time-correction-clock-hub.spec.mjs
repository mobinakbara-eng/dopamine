import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=(name)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const pathFor={employee:"/arbeitnehmer/",manager:"/arbeitgeber/"};
const shellFor={employee:".employee-app",manager:".admin-app"};

function isAccessAction(request,action){
  return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes(`"action":"${action}"`);
}
function isWorktimeAction(request,action){
  return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-worktime-center")&&String(request.postData()||"").includes(`"action":"${action}"`);
}
async function login(page,role,email,password){
  await page.goto(`${pathFor[role]}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const responsePromise=page.waitForResponse(response=>isAccessAction(response.request(),"passwordLogin"),{timeout:30000});
  await page.locator('#password-login button[type="submit"]').click();
  const response=await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.locator(shellFor[role])).toBeVisible({timeout:30000});
}
async function observeWorktime(page,action,trigger,expectedStatus=200){
  const responsePromise=page.waitForResponse(response=>isWorktimeAction(response.request(),action),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  return response.json();
}
function errors(page){
  const rows=[];
  page.on("pageerror",error=>rows.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")rows.push(`console:${message.text()}`)});
  return rows;
}

test.describe.serial("Unified worktime center",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("employee keeps one simple time page with correction history",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const browserErrors=errors(page);
    await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('.employee-bottom [data-a="employee-view"][data-view="time"]').click();
    await expect(page.getByRole("heading",{name:"Korrektur & Stempeluhr"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Deine Korrekturanfragen"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Erfasste Arbeitszeiten"})).toBeVisible();
    const kiosk=page.locator("[data-time-hub-kiosk-link]").first();
    await expect(kiosk).toHaveAttribute("target","_blank");
    await expect(kiosk).toHaveAttribute("rel",/noopener/);
    await expect(kiosk).toHaveAttribute("href",new RegExp(`/kiosk/dashboard/\\?workspace=${workspace}`));
    await expect(page.locator(".employee-correction-fab")).toHaveCount(0);
    const correctionButton=page.locator('[data-time-hub-action="correct-entry"]:not([disabled])').first();
    await expect(correctionButton).toBeVisible();
    const selectedEntry=await correctionButton.getAttribute("data-entry-id");
    await correctionButton.click();
    const dialog=page.locator("#aora-compliance-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading",{name:"Korrektur beantragen"})).toBeVisible();
    await expect(dialog.locator('select[name="timeEntryId"]')).toHaveValue(selectedEntry);
    await dialog.locator('[data-compliance-action="close"]').first().click();
    const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport+2);
    expect(browserErrors).toEqual([]);
  });

  test("manager sees one Arbeitszeit navigation instead of four overlapping sections",async({page})=>{
    const browserErrors=errors(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    const nav=page.locator('.admin-nav [data-a="admin-view"][data-view="worktime"]');
    await expect(nav).toBeVisible();
    await expect(page.locator('.admin-nav [data-view="time-control"]')).toHaveCount(0);
    await expect(page.locator('.admin-nav [data-view="time"]')).toHaveCount(0);
    await expect(page.locator('.admin-nav [data-view="reports"]')).toHaveCount(0);
    await expect(page.locator('.admin-nav [data-view="approvals"]')).toHaveCount(0);
    await expect(page.locator('.admin-nav [data-view="compliance"]')).toContainText("Prüfung & Exporte");
    await nav.click();
    await expect(page.getByRole("heading",{name:"Stempeln, prüfen, ändern und abschließen."})).toBeVisible();
    await expect(page.locator(".worktime-tabs button")).toHaveCount(5);
    await expect(page.getByText("Mitarbeiterstatus").first()).toBeVisible();
    await expect(page.getByText("Direkte Aktion").first()).toBeVisible();
    await expect(page.getByText("Nachträgliche Änderung").first()).toBeVisible();
    const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport+2);
    expect(browserErrors).toEqual([]);
  });

  test("manager punches directly, historical edit waits for employee approval",async({page,browser})=>{
    const managerErrors=errors(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await page.locator('.admin-nav [data-view="worktime"]').click();
    const employeeCard=page.locator(".worktime-person").filter({hasText:"CI Employee"}).first();
    await expect(employeeCard).toBeVisible();

    await employeeCard.getByRole("button",{name:"Einstempeln"}).click();
    let dialog=page.locator("#aora-worktime-dialog");
    await expect(dialog.getByText("Sofort wirksam")).toBeVisible();
    await dialog.locator('textarea[name="reason"]').fill("Mitarbeiter hat das Einstempeln am Kiosk vergessen");
    await observeWorktime(page,"managerPunch",()=>dialog.locator('button[type="submit"]').click());
    await expect.poll(()=>page.evaluate(()=>S.state.timeEntries.some(item=>item.status==="live"&&item.source==="manager_direct")),{timeout:30000}).toBe(true);

    const refreshedCard=page.locator(".worktime-person").filter({hasText:"CI Employee"}).first();
    await expect(refreshedCard.getByRole("button",{name:"Ausstempeln"})).toBeVisible({timeout:30000});
    await refreshedCard.getByRole("button",{name:"Ausstempeln"}).click();
    dialog=page.locator("#aora-worktime-dialog");
    await dialog.locator('textarea[name="reason"]').fill("Manager beendet die vergessene laufende Arbeitszeit");
    await observeWorktime(page,"managerPunch",()=>dialog.locator('button[type="submit"]').click());
    const directEntryId=await expect.poll(()=>page.evaluate(()=>S.state.timeEntries.find(item=>item.source==="manager_direct"&&item.status==="completed")?.id||""),{timeout:30000}).not.toBe("");

    await page.locator('[data-worktime-action="tab"][data-tab="entries"]').click();
    const directRow=page.locator(".worktime-entry").filter({hasText:"Durch Manager gestempelt"}).first();
    await expect(directRow).toBeVisible();
    await directRow.getByRole("button",{name:"Änderung vorschlagen"}).click();
    dialog=page.locator("#aora-worktime-dialog");
    await expect(dialog.getByText("Erst nach Bestätigung wirksam")).toBeVisible();
    await dialog.locator('input[name="start"]').fill("09:10");
    await dialog.locator('input[name="end"]').fill("17:20");
    await dialog.locator('input[name="breakMinutes"]').fill("35");
    await dialog.locator('textarea[name="reason"]').fill("Tatsächliche Arbeitszeit laut Schichtleitung korrigieren");
    const changeResponse=await observeWorktime(page,"managerRequestChange",()=>dialog.locator('button[type="submit"]').click(),201);
    expect(changeResponse.correctionId).toBeTruthy();
    const beforeApproval=await page.evaluate(id=>S.state.timeEntries.find(item=>item.id===id),directEntryId);
    expect(beforeApproval.start).not.toBe("09:10");

    const employeeContext=await browser.newContext();
    const employee=await employeeContext.newPage();
    const employeeErrors=errors(employee);
    await login(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await employee.locator('.employee-bottom [data-view="time"]').click();
    const approval=employee.locator(".worktime-employee-approval").filter({hasText:"09:10–17:20"}).first();
    await expect(approval).toBeVisible({timeout:30000});
    await expect(approval).toContainText("Tatsächliche Arbeitszeit");
    await observeWorktime(employee,"decideChange",()=>approval.getByRole("button",{name:"Bestätigen"}).click());
    await expect.poll(()=>employee.evaluate(id=>{
      const item=S.state.timeEntries.find(entry=>entry.id===id);
      return item?{start:item.start,end:item.end,breakMinutes:item.breakMinutes,durationMinutes:item.durationMinutes}:null;
    },directEntryId),{timeout:30000}).toEqual({start:"09:10",end:"17:20",breakMinutes:35,durationMinutes:455});
    expect(employeeErrors()).toEqual([]);
    await employeeContext.close();

    await page.locator('[data-worktime-action="tab"][data-tab="changes"]').click();
    await expect(page.getByText("Manager → Mitarbeiter").first()).toBeVisible();
    await expect(page.locator(".worktime-change").filter({hasText:"09:10–17:20"}).first()).toContainText("Bestätigt",{timeout:30000});
    expect(managerErrors()).toEqual([]);
  });
});
