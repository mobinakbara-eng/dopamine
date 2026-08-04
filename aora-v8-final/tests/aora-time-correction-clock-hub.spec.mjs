import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=(name)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const pathFor={employee:"/arbeitnehmer/",manager:"/arbeitgeber/"};
const shellFor={employee:".employee-app",manager:".admin-app"};

function isAccessAction(request,action){
  return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes(`"action":"${action}"`);
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
function errors(page){
  const rows=[];
  page.on("pageerror",error=>rows.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")rows.push(`console:${message.text()}`)});
  return rows;
}

test.describe.serial("Integrated correction and clock hub",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("employee sees correction, clock and request status in the time tab without losing the session",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const browserErrors=errors(page);
    await login(page,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await page.locator('.employee-bottom-nav [data-a="employee-view"][data-view="time"]').click();
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
    await expect(dialog.locator('input[name="date"]')).not.toHaveValue("");
    await expect(dialog.locator('input[name="start"]')).not.toHaveValue("");
    await expect(dialog.locator('input[name="end"]')).not.toHaveValue("");
    await dialog.locator('[data-compliance-action="close"]').first().click();
    const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport+2);
    expect(browserErrors).toEqual([]);
  });

  test("manager has one control center for corrections, punch status and timesheet handoff",async({page})=>{
    const browserErrors=errors(page);
    await login(page,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    const nav=page.locator('.admin-nav [data-a="admin-view"][data-view="time-control"]');
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(page.getByRole("heading",{name:"Korrektur & Stempeluhr"})).toBeVisible();
    await expect(page.getByText("Zeitkorrekturen").first()).toBeVisible();
    await expect(page.getByText("Aktueller Stempelstatus")).toBeVisible();
    await expect(page.getByText("Offene Stempelbestätigungen")).toBeVisible();
    await expect(page.getByText("Letzte Zeitbuchungen")).toBeVisible();
    await expect(page.locator(".time-hub-manager-list")).not.toContainText("Korrekturen werden geladen",{timeout:30000});
    await expect(page.locator('[data-a="admin-view"][data-view="approvals"]')).toBeVisible();
    await expect(page.locator('[data-a="admin-view"][data-view="compliance"]')).toBeVisible();
    const kiosk=page.locator("[data-time-hub-kiosk-link]").first();
    await expect(kiosk).toHaveAttribute("target","_blank");
    await expect(kiosk).toHaveAttribute("rel",/noopener/);
    const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    expect(widths.scroll).toBeLessThanOrEqual(widths.viewport+2);
    expect(browserErrors).toEqual([]);
  });
});