import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const required=name=>{const value=process.env[name];if(!value)throw new Error(`Missing CI value: ${name}`);return value};

async function login(page,role,email,password){
  const route=role==="owner"?"/inhaber/":role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#password-login button[type="submit"]').click();
  await expect(page.locator(role==="employee"?".employee-app":".admin-app")).toBeVisible({timeout:30000});
}

function collectRuntimeErrors(page){
  const errors=[];
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  return errors;
}

async function traverseEveryAdminView(page){
  const nav=page.locator('.admin-nav [data-a="admin-view"][data-view]');
  const views=await nav.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-view")).filter(Boolean));
  expect(views.length).toBeGreaterThan(0);
  expect(new Set(views).size).toBe(views.length);
  expect(views).not.toContain("reports");
  await expect(page.locator('.admin-nav [data-view="reports"]')).toHaveCount(0);
  await expect(page.locator('.admin-nav').getByRole("button",{name:"Berichte",exact:true})).toHaveCount(0);

  for(const view of views){
    const button=page.locator(`.admin-nav [data-a="admin-view"][data-view="${view}"]`);
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator(".admin-content")).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>S.adminView)).toBe(view);
    if(view==="worktime"){
      await expect(page.getByRole("heading",{name:"Stempeln, prüfen, ändern und abschließen."})).toBeVisible();
    }
    if(view==="compliance"){
      await expect(page.getByRole("heading",{name:"Prüfung, Exporte und Backup"})).toBeVisible();
      await expect(page.getByRole("button",{name:"CSV Arbeitszeit"})).toBeVisible();
      await expect(page.locator(".compliance-alert")).toHaveCount(0);
    }
  }
  return views;
}

async function traverseEveryEmployeeView(page){
  const nav=page.locator('.employee-bottom [data-a="employee-view"][data-view]');
  const views=await nav.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-view")).filter(Boolean));
  expect(views.length).toBeGreaterThan(0);
  expect(new Set(views).size).toBe(views.length);
  for(const view of views){
    const button=page.locator(`.employee-bottom [data-a="employee-view"][data-view="${view}"]`);
    await expect(button).toBeVisible();
    await button.click();
    await expect.poll(()=>page.evaluate(()=>S.employeeView)).toBe(view);
    await expect(page.locator(".employee-main")).toBeVisible();
  }
  return views;
}

test("every remaining role section renders without runtime errors and Berichte stays removed",async({browser,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage();
  const ownerErrors=collectRuntimeErrors(owner);
  await login(owner,"owner",required("AORA_OWNER_EMAIL"),required("AORA_OWNER_PASSWORD"));
  const ownerViews=await traverseEveryAdminView(owner);
  expect(ownerViews).toContain("tasks");
  expect(ownerViews).toContain("worktime");
  expect(ownerViews).toContain("compliance");
  await owner.evaluate(()=>{S.adminView="reports";renderAdmin()});
  await expect.poll(()=>owner.evaluate(()=>S.adminView)).toBe("owner-overview");
  await expect(owner.locator('.admin-nav [data-view="reports"]')).toHaveCount(0);
  expect(ownerErrors).toEqual([]);

  const managerContext=await browser.newContext({baseURL});
  const manager=await managerContext.newPage();
  const managerErrors=collectRuntimeErrors(manager);
  await login(manager,"manager",required("AORA_MANAGER_EMAIL"),required("AORA_MANAGER_PASSWORD"));
  const managerViews=await traverseEveryAdminView(manager);
  expect(managerViews).toContain("tasks");
  expect(managerViews).toContain("worktime");
  expect(managerViews).toContain("compliance");
  await manager.evaluate(()=>{S.adminView="reports";renderAdmin()});
  await expect.poll(()=>manager.evaluate(()=>S.adminView)).toBe("overview");
  await expect(manager.locator('.admin-nav [data-view="reports"]')).toHaveCount(0);
  expect(managerErrors).toEqual([]);

  const employeeContext=await browser.newContext({baseURL});
  const employee=await employeeContext.newPage();
  const employeeErrors=collectRuntimeErrors(employee);
  await login(employee,"employee",required("AORA_EMPLOYEE_EMAIL"),required("AORA_EMPLOYEE_PASSWORD"));
  const employeeViews=await traverseEveryEmployeeView(employee);
  for(const requiredView of ["home","calendar","time","leave","more"])expect(employeeViews).toContain(requiredView);
  expect(employeeErrors).toEqual([]);

  await employeeContext.close();
  await managerContext.close();
  await ownerContext.close();
});
