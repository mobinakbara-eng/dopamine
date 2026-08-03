import { test, expect } from "@playwright/test";

const forbiddenHosts=["supabase.co","fonts.googleapis.com","fonts.gstatic.com","cdn.jsdelivr.net","google-analytics.com","googletagmanager.com"];

for(const route of ["/datenschutz/","/datenschutzbeauftragter/"]){
  test(`privacy contact page is standalone and accessible at ${route}`,async({page,baseURL})=>{
    const externalRequests=[];
    const expectedOrigin=new URL(baseURL||"http://127.0.0.1:4173").origin;
    page.on("request",request=>{
      const url=new URL(request.url());
      if(url.origin!==expectedOrigin)externalRequests.push(url.hostname);
    });
    await page.goto(route,{waitUntil:"networkidle"});
    await expect(page).toHaveTitle(/Datenschutz & Kontakt/);
    await expect(page.getByRole("heading",{name:/Ihre Daten\. Ihre Rechte\./})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Ihr Arbeitgeber ist grundsätzlich Verantwortlicher"})).toBeVisible();
    await expect(page.getByRole("heading",{name:/Datenschutzkontakt|Datenschutzbeauftragter/}).first()).toBeVisible();
    await expect(page.getByRole("heading",{name:"Was Sie verlangen können"})).toBeVisible();
    await expect(page.getByText("Art. 15",{exact:true})).toBeVisible();
    await expect(page.getByText("Art. 21",{exact:true})).toBeVisible();
    await expect(page.getByText("Berliner Beauftragte für Datenschutz und Informationsfreiheit").first()).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.locator("script")).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content",/Datenschutzkontakt/);
    for(const host of forbiddenHosts)expect(externalRequests.filter(item=>item.includes(host))).toEqual([]);
    const pageHtml=await page.locator("html").innerHTML();
    expect(pageHtml).not.toContain("{{");
    expect(pageHtml).not.toContain("@aora.example");
  });
}

test("privacy page remains usable on a narrow mobile viewport",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/datenschutz/",{waitUntil:"networkidle"});
  await expect(page.locator(".privacy-header")).toBeVisible();
  await expect(page.locator(".responsibility-grid")).toBeVisible();
  await expect(page.locator(".rights-grid")).toBeVisible();
  await expect(page.getByRole("link",{name:"Zur Anmeldung"})).toBeVisible();
});