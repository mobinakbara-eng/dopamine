import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};

function accessRequest(request,action){
  return request.method()==="POST"
    &&request.url().includes("/functions/v1/aora-v8-pilot-access")
    &&String(request.postData()||"").includes(`"action":"${action}"`);
}
async function loginManager(page){
  await page.goto(`/arbeitgeber/?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(env("AORA_MANAGER_EMAIL"));
  await page.locator('input[name="password"]').fill(env("AORA_MANAGER_PASSWORD"));
  const responsePromise=page.waitForResponse(response=>accessRequest(response.request(),"passwordLogin"),{timeout:30000});
  await page.locator('#password-login button[type="submit"]').click();
  const response=await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
}
async function primeTaskUi(page){
  await page.evaluate(()=>{
    S.u=S.u||{};
    S.u.tasks=S.u.tasks||{};
    S.u.tasks.managerData={
      locationId:S.locationId,
      templates:[{
        id:"qa_composer_template",
        title:"Closing Check",
        category:"closing",
        active:true,
        review_required:false,
        clockout_policy:"WARN_ONLY",
        task_template_items:[{id:"qa_item",label:"Closing prüfen",required:true,answer_type:"checkbox"}]
      }],
      rules:[{id:"qa_rule",active:true,trigger_type:"fixed_time",assignment_strategy:"shared_on_shift",task_templates:{title:"Closing Check"}}],
      tasks:[{id:"qa_task",status:"open",due_at:new Date(Date.now()+3600000).toISOString(),blocking_clockout:true,payload:{title:"Closing Check"},task_templates:{title:"Closing Check"},task_assignments:[{employee_id:"qa_employee",status:"assigned"}]}]
    };
    if(!Array.isArray(S.state.employees)||!S.state.employees.length){
      S.state.employees=[{id:"qa_employee",name:"QA Employee",role:"Mitarbeiter",locationId:S.locationId,active:true}];
    }
  });
}

test.describe.serial("Manager task composer v3 browser contract",()=>{
  test.beforeAll(()=>env("AORA_WORKSPACE_SLUG"));

  test("manual task creator exposes photo, employee, deadline and mandatory controls",async({page})=>{
    await loginManager(page);
    await primeTaskUi(page);
    await page.evaluate(()=>uManualTaskDialog());

    const dialog=page.locator('.aora-composer-dialog[data-composer="manual-v3"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading",{name:"Aufgabe erstellen"})).toBeVisible();
    await expect(dialog.getByText("Foto zur Aufgabe",{exact:true})).toBeVisible();
    await expect(dialog.locator('[name="managerReference"]')).toHaveCount(1);
    await expect(dialog.getByText("Foto-Nachweis vom Mitarbeiter erforderlich",{exact:true})).toBeVisible();
    await expect(dialog.locator('[name="photoEvidenceRequired"]')).toHaveCount(1);
    await expect(dialog.locator('[name="required"]')).toBeVisible();
    await expect(dialog.locator('[name="employeeIds"]')).toHaveCount(1);
    await expect(dialog.locator('[name="date"]')).toBeVisible();
    await expect(dialog.locator('[name="dueTime"]')).toBeVisible();
    await expect(dialog).not.toContainText("Priorität");
    await expect(dialog).not.toContainText("Schichtbezug");
    await expect(dialog).not.toContainText("Clock-out Policy");

    await dialog.locator('[name="employeeIds"]').check();
    await dialog.locator('[name="required"]').check();
    await dialog.locator('[name="photoEvidenceRequired"]').check();
    await expect(dialog.locator('[data-composer-summary]')).toContainText("Pflichtaufgabe");
    await expect(dialog.locator('[data-composer-summary]')).toContainText("Foto-Nachweis erforderlich");
  });

  test("manager page exposes safe template and task lifecycle controls",async({page})=>{
    await loginManager(page);
    await primeTaskUi(page);
    const html=await page.evaluate(()=>uManagerTasksPage());
    await page.locator("#app").evaluate((node,value)=>{node.innerHTML=value},html);

    await expect(page.getByRole("heading",{name:"Templates"})).toBeVisible();
    await expect(page.locator('[data-aora-template-state][data-id="qa_composer_template"]')).toHaveText("Deaktivieren");
    await expect(page.locator('[data-aora-template-delete][data-id="qa_composer_template"]')).toHaveText("Löschen");
    await expect(page.locator('[data-aora-task-cancel][data-id="qa_task"]')).toHaveText("Abbrechen");
    await expect(page.locator('[data-aora-task-delete][data-id="qa_task"]')).toHaveText("Löschen");
  });

  test("automation defaults to one shared on-shift task and supports mandatory mode",async({page})=>{
    await loginManager(page);
    await primeTaskUi(page);
    await page.evaluate(()=>uRuleDialog());

    const dialog=page.locator('.aora-composer-dialog[data-composer="automation"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading",{name:"Automatische Aufgabe"})).toBeVisible();
    await expect(dialog.locator('[name="strategy"]')).toHaveValue("shared_on_shift");
    await expect(dialog.locator('[name="time"]')).toHaveValue("22:00");
    await expect(dialog.locator('[name="strategy"] option:checked')).toHaveText(/Alle im Dienst sehen sie.*1 Person erledigt für alle/);
    await expect(dialog).not.toContainText("Clock-out Policy");

    await dialog.locator('[name="required"]').check();
    await expect(dialog.locator('[data-composer-summary]')).toContainText("Alle sehen sie · 1 Person reicht");
    await expect(dialog.locator('[data-composer-summary]')).toContainText("Pflichtaufgabe");
  });
});
