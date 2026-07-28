import { test, expect } from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const required=name=>{const value=process.env[name];if(!value)throw new Error(`Missing required accessibility value: ${name}`);return value};
const role=process.env.AORA_A11Y_ROLE||"owner";
const route={owner:"/inhaber/",manager:"/arbeitgeber/",employee:"/arbeitnehmer/"}[role];
const shell={owner:".admin-app",manager:".admin-app",employee:".employee-app"}[role];

test("WCAG runtime hardening labels forms, dialogs, focus and responsive navigation",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`);
  const email=page.locator('input[name="email"]');
  const password=page.locator('input[name="password"]');
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();
  await expect.poll(()=>email.getAttribute("id")).not.toBeNull();
  await expect(page.locator(`label[for="${await email.getAttribute("id")}"]`)).toContainText("E-Mail");
  await expect(page.locator(`label[for="${await password.getAttribute("id")}"]`)).toContainText("Passwort");

  if(!await email.evaluate(node=>node===document.activeElement))await email.focus();
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await page.keyboard.press("Tab");
  const submit=page.locator('#password-login button[type="submit"]');
  await expect(submit).toBeFocused();
  const focusStyle=await submit.evaluate(node=>getComputedStyle(node).outlineStyle);
  expect(focusStyle).not.toBe("none");

  await email.fill(required("AORA_A11Y_EMAIL"));
  await password.fill(required("AORA_A11Y_PASSWORD"));
  await submit.click();
  await expect(page.locator(shell)).toBeVisible({timeout:30000});
  await page.waitForFunction(()=>typeof globalThis.aoraHardenAccessibility==="function");
  await page.evaluate(()=>globalThis.aoraHardenAccessibility(document));

  const audit=await page.evaluate(()=>{
    const visible=node=>Boolean(node.offsetWidth||node.offsetHeight||node.getClientRects().length);
    const missingLabels=[...document.querySelectorAll("input:not([type='hidden']),select,textarea")]
      .filter(visible)
      .filter(node=>!node.disabled&&!node.hasAttribute("aria-label")&&!node.hasAttribute("aria-labelledby")&&!(node.id&&document.querySelector(`label[for="${CSS.escape(node.id)}"]`)))
      .map(node=>node.outerHTML.slice(0,160));
    const unnamedControls=[...document.querySelectorAll("button,a[href],[role='button']")]
      .filter(visible)
      .filter(node=>!node.hasAttribute("aria-label")&&!node.hasAttribute("aria-labelledby")&&!node.textContent.trim()&&!node.getAttribute("title"))
      .map(node=>node.outerHTML.slice(0,160));
    return{
      missingLabels,
      unnamedControls,
      unlabeledNavs:[...document.querySelectorAll("nav")].filter(node=>!node.hasAttribute("aria-label")&&!node.hasAttribute("aria-labelledby")).length,
      reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  expect(audit).toEqual({missingLabels:[],unnamedControls:[],unlabeledNavs:0,reducedMotion:true});

  const modalTrigger=page.locator('[data-a="employee-account-modal"],[data-a="profile-modal"]').first();
  if(await modalTrigger.isVisible()){
    await modalTrigger.click();
    const dialog=page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal","true");
    await expect(dialog).toHaveAttribute("aria-labelledby",/.+/);
    const missingDialogLabels=await dialog.locator("input:not([type='hidden']),select,textarea").evaluateAll(nodes=>nodes.filter(node=>!node.disabled&&!node.getAttribute("aria-label")&&!node.getAttribute("aria-labelledby")&&!(node.id&&document.querySelector(`label[for="${CSS.escape(node.id)}"]`))).length);
    expect(missingDialogLabels).toBe(0);
  }

  await page.setViewportSize({width:320,height:720});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});

