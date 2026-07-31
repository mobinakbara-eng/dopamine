import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const flags=["canonical_database","calendar_v2","schedule_board_v2","open_shift_marketplace","task_automation","clockout_task_gate"];
const required=name=>{const value=process.env[name];if(!value)throw new Error(`Missing CI value: ${name}`);return value};

async function login(page,role,email,password){
  const route=role==="owner"?"/inhaber/":role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#password-login button[type="submit"]').click();
  await expect(page.locator(role==="employee"?".employee-app":".admin-app")).toBeVisible({timeout:30000});
}

async function assertNoPageOverflow(page){
  const metrics=await page.evaluate(()=>({
    viewport:window.innerWidth,
    html:document.documentElement.scrollWidth,
    body:document.body.scrollWidth
  }));
  expect(metrics.html).toBeLessThanOrEqual(metrics.viewport+1);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport+1);
}

test("390px mobile layouts keep controls aligned and overflow contained",async({browser,baseURL})=>{
  const mobile={baseURL,viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true};

  const ownerContext=await browser.newContext(mobile);
  const owner=await ownerContext.newPage();
  await login(owner,"owner",required("AORA_OWNER_EMAIL"),required("AORA_OWNER_PASSWORD"));
  await owner.evaluate(async featureFlags=>{
    for(const flagKey of featureFlags)await uCall("updateFeatureFlag",{flagKey,scopeType:"organization",scopeValue:null,enabled:true,rolloutPercentage:100,config:{mobileGate:true}});
    await uLoadFlags();render();
  },flags);
  await assertNoPageOverflow(owner);

  const managerContext=await browser.newContext(mobile);
  const manager=await managerContext.newPage();
  await login(manager,"manager",required("AORA_MANAGER_EMAIL"),required("AORA_MANAGER_PASSWORD"));
  await manager.evaluate(()=>{S.adminView="schedule";render()});
  await expect(manager.getByText("Weekly Planning Board")).toBeVisible({timeout:30000});
  await assertNoPageOverflow(manager);
  const board=await manager.locator(".u-schedule-board").evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return{left:rect.left,right:rect.right,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,viewport:window.innerWidth};
  });
  expect(board.left).toBeGreaterThanOrEqual(-1);
  expect(board.right).toBeLessThanOrEqual(board.viewport+1);
  expect(board.scrollWidth).toBeGreaterThan(board.clientWidth);

  await manager.locator('[data-u="shift-new"]').click();
  const dialog=await manager.locator(".u-dialog").evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return{left:rect.left,right:rect.right,bottom:rect.bottom,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight};
  });
  expect(dialog.left).toBeGreaterThanOrEqual(-1);
  expect(dialog.right).toBeLessThanOrEqual(dialog.viewportWidth+1);
  expect(Math.abs(dialog.viewportHeight-dialog.bottom)).toBeLessThanOrEqual(2);
  await manager.locator('[data-u="dialog-close"]').click();

  const employeeContext=await browser.newContext(mobile);
  const employee=await employeeContext.newPage();
  await login(employee,"employee",required("AORA_EMPLOYEE_EMAIL"),required("AORA_EMPLOYEE_PASSWORD"));

  await employee.evaluate(()=>{S.employeeView="calendar";render()});
  await expect(employee.locator(".aora-calendar-page")).toBeVisible({timeout:30000});
  await expect(employee.locator(".aora-calendar-grid")).toBeVisible();
  await expect(employee.locator(".aora-cal-sheet")).toBeVisible();
  await expect(employee.locator(".aora-cal-day")).toHaveCount(42);
  await expect(employee.locator(".aora-cal-day.is-selected")).toHaveCount(1);
  await expect(employee.locator(".aora-cal-header-actions .aora-cal-icon-button")).toHaveCount(3);
  await assertNoPageOverflow(employee);
  const calendarLayout=await employee.locator(".aora-calendar-page").evaluate(element=>{
    const pageRect=element.getBoundingClientRect();
    const grid=element.querySelector(".aora-calendar-grid").getBoundingClientRect();
    const sheet=element.querySelector(".aora-cal-sheet").getBoundingClientRect();
    return{
      viewport:window.innerWidth,
      pageLeft:pageRect.left,
      pageRight:pageRect.right,
      gridLeft:grid.left,
      gridRight:grid.right,
      sheetLeft:sheet.left,
      sheetRight:sheet.right
    };
  });
  expect(calendarLayout.pageLeft).toBeGreaterThanOrEqual(-1);
  expect(calendarLayout.pageRight).toBeLessThanOrEqual(calendarLayout.viewport+1);
  expect(calendarLayout.gridLeft).toBeGreaterThanOrEqual(-1);
  expect(calendarLayout.gridRight).toBeLessThanOrEqual(calendarLayout.viewport+1);
  expect(calendarLayout.sheetLeft).toBeGreaterThanOrEqual(-1);
  expect(calendarLayout.sheetRight).toBeLessThanOrEqual(calendarLayout.viewport+1);

  await employee.locator('[data-aora-calendar="filter-menu"]').click();
  await expect(employee.locator(".aora-cal-filter-popover")).toBeVisible();
  await employee.locator('[data-aora-calendar="filter-toggle"][data-filter="tasks"]').click();
  await expect(employee.locator('[data-aora-calendar="filter-toggle"][data-filter="tasks"]')).toHaveAttribute("aria-pressed","false");
  await employee.locator('[data-aora-calendar="filter-toggle"][data-filter="tasks"]').click();

  await employee.evaluate(()=>{S.employeeView="tasks";render()});
  await expect(employee.getByText("Meine Aufgaben")).toBeVisible({timeout:30000});
  await assertNoPageOverflow(employee);
  const nav=await employee.locator(".employee-bottom").evaluate(element=>({
    count:element.children.length,
    viewport:window.innerWidth,
    left:element.getBoundingClientRect().left,
    right:element.getBoundingClientRect().right,
    buttons:[...element.children].map(item=>{const rect=item.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width}})
  }));
  expect(nav.count).toBe(6);
  expect(nav.left).toBeGreaterThanOrEqual(-1);
  expect(nav.right).toBeLessThanOrEqual(nav.viewport+1);
  for(const button of nav.buttons){
    expect(button.left).toBeGreaterThanOrEqual(-1);
    expect(button.right).toBeLessThanOrEqual(nav.viewport+1);
    expect(button.width).toBeGreaterThan(40);
  }

  await owner.evaluate(async featureFlags=>{
    for(const flagKey of featureFlags)await uCall("updateFeatureFlag",{flagKey,scopeType:"organization",scopeValue:null,enabled:false,rolloutPercentage:100,config:{mobileGate:true}});
  },flags);
  await employeeContext.close();
  await managerContext.close();
  await ownerContext.close();
});
