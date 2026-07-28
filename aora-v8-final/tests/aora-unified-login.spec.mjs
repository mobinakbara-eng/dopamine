import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing required ephemeral CI value: ${name}`);return value};

test("Unified login hides role selection and routes the authenticated account",async({page})=>{
  await page.goto(`/arbeitnehmer/?workspace=${encodeURIComponent(workspace)}`);

  await expect(page.getByRole("heading",{name:"Anmelden"})).toBeVisible();
  await expect(page.locator(".role-tabs")).toHaveCount(0);
  await expect(page.locator('[data-a="role"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Mitarbeiter-Zugang");
  await expect(page.locator("body")).not.toContainText("Arbeitgeber-Zugang");
  await expect(page.locator("body")).not.toContainText("Inhaber-Zugang");

  await page.locator('input[name="email"]').fill(env("AORA_OWNER_EMAIL"));
  await page.locator('input[name="password"]').fill(env("AORA_OWNER_PASSWORD"));

  let passwordLoginRequests=0;
  page.on("request",request=>{
    if(request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes('"action":"passwordLogin"'))passwordLoginRequests++;
  });
  const successfulLogin=page.waitForResponse(response=>{
    const request=response.request();
    return response.status()===200&&request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-pilot-access")&&String(request.postData()||"").includes('"action":"passwordLogin"');
  });
  await page.locator('#password-login button[type="submit"]').click();
  const response=await successfulLogin;
  const body=await response.json();

  expect(body.accessRole).toBe("owner");
  expect(passwordLoginRequests).toBe(1);
  await page.waitForFunction(({workspace})=>Boolean(sessionStorage.getItem(`aora:${workspace}:owner`)),{workspace});
  await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
  await expect(page).toHaveURL(new RegExp(`/inhaber/\\?workspace=${workspace}`));
});

