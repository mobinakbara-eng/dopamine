import { test, expect } from "@playwright/test";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const testDate=process.env.AORA_TEST_DATE;

function env(name){const value=process.env[name];if(!value)throw new Error(`Missing required ephemeral CI value: ${name}`);return value}
function diagnostics(page){
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(`console:${message.text()}`)});
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed";
    const url=request.url();
    const expectedAbort=reason==="net::ERR_ABORTED"&&(url.includes("realtime-broadcast")||url.includes("compliance-proxy"));
    if(!expectedAbort)errors.push(`network:${reason}:${new URL(url).pathname}`);
  });
  return()=>errors;
}
async function passwordLogin(page,role,email,password){
  const route=role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const response=page.waitForResponse(value=>value.request().method()==="POST"&&value.url().includes("/aora-v8-pilot-access")&&String(value.request().postData()||"").includes('"action":"passwordLogin"'));
  await page.locator('#password-login button[type="submit"]').click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(role==="employee"?".employee-app":".admin-app")).toBeVisible({timeout:30000});
}
function isApprovalAction(response,action){
  return response.request().method()==="POST"&&response.url().includes("/aora-v8-timesheet-approval")&&String(response.request().postData()||"").includes(`"action":"${action}"`);
}
async function approvalResponse(page,action,trigger,expected=[200,201]){
  const responsePromise=page.waitForResponse(response=>isApprovalAction(response,action),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  expect(expected).toContain(response.status());
  return{response,body};
}
async function screenshot(page,file,fullPage=true){await page.screenshot({path:file,fullPage})}
async function directApprovalCall(page,action,payload={}){
  return page.evaluate(async({action,payload})=>{
    const response=await fetch(`${CFG.url}/functions/v1/aora-v8-timesheet-approval`,{
      method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},
      body:JSON.stringify({action,token:S.session?.token,...payload})
    });
    const type=response.headers.get("content-type")||"";
    const body=type.includes("application/json")?await response.json():null;
    return{status:response.status,body};
  },{action,payload});
}

test.describe.serial("Employee-approved Arbeitszeitnachweis",()=>{
  test.beforeAll(()=>{env("AORA_WORKSPACE_SLUG");env("AORA_TEST_DATE")});

  test("manager request, employee consent, correction, approval, PDF/XLSX export and revocation",async({browser,baseURL},testInfo)=>{
    const root=testInfo.outputPath("timesheet-e2e");
    const shots=path.join(root,"screenshots");
    const downloads=path.join(root,"downloads");
    await mkdir(shots,{recursive:true});await mkdir(downloads,{recursive:true});

    const managerContext=await browser.newContext({baseURL,viewport:{width:1440,height:1100},acceptDownloads:true});
    const manager=await managerContext.newPage();
    const managerErrors=diagnostics(manager);
    await passwordLogin(manager,"manager",env("AORA_MANAGER_EMAIL"),env("AORA_MANAGER_PASSWORD"));
    await manager.locator('.admin-nav [data-a="admin-view"][data-view="approvals"]').click();
    await expect(manager.getByRole("heading",{name:"Einwilligungen und Arbeitszeitnachweise"})).toBeVisible({timeout:30000});
    await expect(manager.locator("#loc-select option")).toHaveCount(1);
    await screenshot(manager,path.join(shots,"01-manager-start.png"));

    const consentResult=await approvalResponse(manager,"sendConsentRequest",()=>manager.locator('[data-timesheet-action="send-consent"]').click(),[201]);
    expect(consentResult.body.request.status).toBe("pending");
    await expect(manager.getByText("Erklärungen offen")).toBeVisible({timeout:30000});
    await screenshot(manager,path.join(shots,"02-manager-consent-pending.png"));

    const employeeContext=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const employee=await employeeContext.newPage();
    const employeeErrors=diagnostics(employee);
    await passwordLogin(employee,"employee",env("AORA_EMPLOYEE_EMAIL"),env("AORA_EMPLOYEE_PASSWORD"));
    await employee.locator('.employee-bottom [data-a="employee-view"][data-view="more"]').click();
    await expect(employee.getByRole("heading",{name:"Freigaben & Nachweise"})).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"03-employee-more-entry.png"));
    await employee.locator('[data-timesheet-action="open-employee-documents"]').click();
    await expect(employee.getByRole("heading",{name:"Freigaben & Nachweise"})).toBeVisible();
    await expect(employee.getByText("Erklärungen lesen und bestätigen")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"04-employee-documents-pending.png"));

    await employee.locator('[data-timesheet-action="open-consent"]').click();
    const consentDialog=employee.locator("#timesheet-dialog");
    await expect(consentDialog).toBeVisible();
    await expect(consentDialog.locator('.timesheet-statement input[type="checkbox"]')).toHaveCount(3);
    await consentDialog.screenshot({path:path.join(shots,"05-consent-legal-texts.png")});
    for(const checkbox of await consentDialog.locator('.timesheet-statement input[type="checkbox"]').all())await checkbox.check();
    const canvas=consentDialog.locator("#timesheet-signature-canvas");
    const box=await canvas.boundingBox();if(!box)throw new Error("Signature canvas missing");
    await employee.mouse.move(box.x+25,box.y+box.height*0.62);await employee.mouse.down();
    for(let index=0;index<18;index++)await employee.mouse.move(box.x+25+index*12,box.y+box.height*(0.62+Math.sin(index/2)*0.12));
    await employee.mouse.up();
    await consentDialog.screenshot({path:path.join(shots,"06-consent-signed.png")});
    const acceptResult=await approvalResponse(employee,"acceptConsentRequest",()=>consentDialog.locator('button[type="submit"]').click());
    expect(acceptResult.body.request.status).toBe("accepted");
    await expect(employee.getByText("Aktiv hinterlegt")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"07-employee-signature-active.png"));

    await manager.locator('[data-timesheet-action="refresh-manager"]').click();
    await expect(manager.getByText("Erklärungen bestätigt")).toBeVisible({timeout:30000});
    await expect(manager.getByText("Unterschrift aktiv")).toBeVisible();
    await manager.locator("#timesheet-date-from").fill(testDate);
    await manager.locator("#timesheet-date-to").fill(testDate);
    const sent=await approvalResponse(manager,"sendTimesheet",()=>manager.locator('[data-timesheet-action="send-timesheet"]').click(),[201]);
    const submissionId=sent.body.submission.id;
    expect(sent.body.submission.payload.snapshot.organization.name).toBe("Arbeitgeber");
    expect(sent.body.submission.payload.snapshot.location).toMatchObject({name:"Einstein Kaffee Testfiliale",address:"Teststraße 12",postalCode:"10115",city:"Berlin"});
    expect(sent.body.submission.payload.snapshot.totals.totalMinutes).toBe(480);
    expect(JSON.stringify(sent.body.submission.payload.snapshot)).not.toMatch(/aora/i);
    await expect(manager.getByText("Wartet auf Mitarbeiter")).toBeVisible({timeout:30000});
    const deniedExport=await directApprovalCall(manager,"exportTimesheet",{submissionId,format:"pdf"});
    expect(deniedExport.status).toBe(409);
    await screenshot(manager,path.join(shots,"08-manager-timesheet-waiting.png"));

    await employee.locator('[data-timesheet-action="refresh-employee"]').click();
    await expect(employee.getByText("Wartet auf Mitarbeiter")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"09-employee-timesheet-waiting.png"));
    await employee.locator(`[data-timesheet-action="view-submission"][data-submission-id="${submissionId}"]`).click();
    const documentDialog=employee.locator("#timesheet-dialog");
    await expect(documentDialog.getByText("Einstein Kaffee Testfiliale")).toBeVisible();
    await expect(documentDialog.getByText("Teststraße 12, 10115, Berlin")).toBeVisible();
    await expect(documentDialog.getByText("08:00",{exact:true}).last()).toBeVisible();
    await documentDialog.screenshot({path:path.join(shots,"10-employee-document-review.png")});

    await documentDialog.locator("#timesheet-decision-note").fill("Bitte Beginn nochmals prüfen.");
    const declined=await approvalResponse(employee,"decideTimesheet",()=>documentDialog.locator('[data-decision="declined"]').click());
    expect(declined.body.submission.employee_decision).toBe("declined");
    await expect(employee.getByText("Abgelehnt")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"11-employee-correction-requested.png"));

    await manager.locator('[data-timesheet-action="refresh-manager"]').click();
    await expect(manager.getByText("Abgelehnt")).toBeVisible({timeout:30000});
    await expect(manager.getByText("Bitte Beginn nochmals prüfen.")).toBeVisible();
    await screenshot(manager,path.join(shots,"12-manager-correction-visible.png"));

    const resent=await approvalResponse(manager,"sendTimesheet",()=>manager.locator('[data-timesheet-action="send-timesheet"]').click(),[201]);
    expect(resent.body.submission.id).toBe(submissionId);
    expect(resent.body.submission.version).toBe(2);
    await employee.locator('[data-timesheet-action="refresh-employee"]').click();
    await employee.locator(`[data-timesheet-action="view-submission"][data-submission-id="${submissionId}"]`).click();
    const approved=await approvalResponse(employee,"decideTimesheet",()=>employee.locator('#timesheet-dialog [data-decision="approved"]').click());
    expect(approved.body.submission.status).toBe("approved");
    expect(approved.body.submission.signed_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(employee.getByText("Freigegeben")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"13-employee-approved.png"));

    const employeeExport=await directApprovalCall(employee,"exportTimesheet",{submissionId,format:"pdf"});
    expect(employeeExport.status).toBe(403);

    await manager.locator('[data-timesheet-action="refresh-manager"]').click();
    await expect(manager.getByText("Freigegeben")).toBeVisible({timeout:30000});
    await screenshot(manager,path.join(shots,"14-manager-approved-export-ready.png"));

    async function download(format){
      const event=manager.waitForEvent("download",{timeout:30000});
      await manager.locator(`[data-timesheet-action="export"][data-format="${format}"]`).click();
      const item=await event;expect(await item.failure()).toBeNull();
      const destination=path.join(downloads,item.suggestedFilename());await item.saveAs(destination);
      expect((await stat(destination)).size).toBeGreaterThan(format==="pdf"?2000:1500);
      return destination;
    }
    const pdfPath=await download("pdf");
    const xlsxPath=await download("xlsx");

    const pdf=await pdfParse(await readFile(pdfPath));
    expect(pdf.numpages).toBeGreaterThanOrEqual(1);
    expect(pdf.text).toContain("Arbeitszeitnachweis");
    expect(pdf.text).toContain("Arbeitgeber");
    expect(pdf.text).toContain("Einstein Kaffee Testfiliale");
    expect(pdf.text).toContain("Teststraße 12");
    expect(pdf.text).toContain("CI Employee");
    expect(pdf.text).toContain("QA-001");
    expect(pdf.text).not.toMatch(/aora/i);

    const workbook=XLSX.readFile(xlsxPath,{cellDates:false});
    expect(workbook.SheetNames).toEqual(["Arbeitszeit","Zusammenfassung","Freigabe"]);
    const workbookText=workbook.SheetNames.map(name=>XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join("\n");
    expect(workbookText).toContain("Arbeitgeber");
    expect(workbookText).toContain("Einstein Kaffee Testfiliale");
    expect(workbookText).toContain("Teststraße 12, 10115, Berlin");
    expect(workbookText).toContain("CI Employee");
    expect(workbookText).toContain("Vom Mitarbeiter digital freigegeben");
    expect(workbookText).not.toMatch(/aora/i);

    await manager.locator('[data-timesheet-action="refresh-manager"]').click();
    await expect(manager.getByText("Exportiert")).toBeVisible({timeout:30000});
    await screenshot(manager,path.join(shots,"15-manager-exported.png"));

    employee.once("dialog",dialog=>dialog.accept());
    await employee.locator('[data-timesheet-action="revoke-signature"]').click();
    await expect(employee.getByText("Noch nicht eingerichtet")).toBeVisible({timeout:30000});
    await screenshot(employee,path.join(shots,"16-employee-signature-revoked.png"));
    const blockedAfterRevocation=await directApprovalCall(manager,"sendTimesheet",{employeeId:sent.body.submission.employee_id,dateFrom:testDate,dateTo:testDate});
    expect(blockedAfterRevocation.status).toBe(409);

    expect(managerErrors()).toEqual([]);
    expect(employeeErrors()).toEqual([]);
    await employeeContext.close();await managerContext.close();
  });
});
