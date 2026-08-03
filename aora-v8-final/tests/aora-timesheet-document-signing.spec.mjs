import { test, expect } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { unzipSync, strFromU8 } from "fflate";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const testDate=process.env.AORA_TEST_DATE;
const functionPath="/aora-v8-timesheet-document-signing";

function required(name){const value=process.env[name];if(!value)throw new Error(`Missing ephemeral CI value: ${name}`);return value}
function actionResponse(response,action){return response.request().method()==="POST"&&response.url().includes(functionPath)&&String(response.request().postData()||"").includes(`"action":"${action}"`)}
function captureErrors(page){
  const errors=[];
  page.on("console",message=>{
    const text=message.text();
    const expected=message.type()==="error"&&/Failed to load resource: the server responded with a status of (403|409)/.test(text);
    if(message.type()==="error"&&!expected)errors.push(`console:${text}`);
  });
  page.on("pageerror",error=>errors.push(`page:${error.message}`));
  page.on("requestfailed",request=>{
    const reason=request.failure()?.errorText||"failed",url=request.url();
    const allowed=reason==="net::ERR_ABORTED"&&(url.includes("realtime-broadcast")||url.includes("compliance-proxy")||url.startsWith("blob:"));
    if(!allowed)errors.push(`network:${reason}:${url.startsWith("http")?new URL(url).pathname:url}`);
  });
  return()=>errors;
}
async function login(page,role,email,password){
  const route=role==="manager"?"/arbeitgeber/":"/arbeitnehmer/";
  await page.goto(`${route}?workspace=${encodeURIComponent(workspace)}`,{waitUntil:"domcontentloaded"});
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const responsePromise=page.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/aora-v8-pilot-access")&&String(response.request().postData()||"").includes('"action":"passwordLogin"'),{timeout:30000});
  await page.locator('#password-login button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.locator(role==="manager"?".admin-app":".employee-app")).toBeVisible({timeout:30000});
}
async function runAction(page,action,trigger,expected=[200,201]){
  const responsePromise=page.waitForResponse(response=>actionResponse(response,action),{timeout:30000});
  await trigger();
  const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  expect(expected).toContain(response.status());
  return{response,body};
}
async function directCall(page,action,payload={}){
  return page.evaluate(async({action,payload})=>{
    const response=await fetch(`${CFG.url}/functions/v1/aora-v8-timesheet-document-signing`,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify({action,token:S.session?.token,...payload})});
    const type=response.headers.get("content-type")||"";
    return{status:response.status,body:type.includes("application/json")?await response.json():null};
  },{action,payload});
}
async function installExportProbe(page){
  await page.evaluate(()=>{
    window.__docsignExportProbe={};window.__docsignExportError="";
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(...args)=>{
      const response=await originalFetch(...args);
      try{
        const body=String(args[1]?.body||"");
        if(body.includes('"action":"exportTimesheet"')){
          const parsed=JSON.parse(body),clone=response.clone(),bytes=new Uint8Array(await clone.arrayBuffer());
          let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
          window.__docsignExportProbe[`${parsed.format}:${Boolean(parsed.signed)}`]={status:clone.status,headers:Object.fromEntries(clone.headers.entries()),base64:btoa(binary)};
        }
      }catch(error){window.__docsignExportError=String(error)}
      return response;
    };
  });
}
async function exportFromUi(page,{format,signed,downloads}){
  const responsePromise=page.waitForResponse(response=>actionResponse(response,"exportTimesheet")&&String(response.request().postData()||"").includes(`"format":"${format}"`)&&String(response.request().postData()||"").includes(`"signed":${signed}`),{timeout:30000});
  await page.locator(`[data-docsign-action="export"][data-format="${format}"][data-signed="${signed}"]`).first().click();
  const response=await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers()["x-document-signed"]).toBe(signed?"true":"false");
  expect(response.headers()["x-document-checksum"]).toMatch(/^[a-f0-9]{64}$/);
  const key=`${format}:${signed}`;
  await expect.poll(()=>page.evaluate(key=>Boolean(window.__docsignExportProbe?.[key]),key),{timeout:15000}).toBe(true);
  const probe=await page.evaluate(key=>({result:window.__docsignExportProbe[key],error:window.__docsignExportError}),key);
  expect(probe.error).toBe("");expect(probe.result.status).toBe(200);
  const disposition=response.headers()["content-disposition"]||"";
  const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]||`Arbeitszeitnachweis.${format}`;
  const destination=path.join(downloads,filename);
  await writeFile(destination,Buffer.from(probe.result.base64,"base64"));
  expect((await stat(destination)).size).toBeGreaterThan(format==="pdf"?2000:1500);
  return destination;
}
async function drawSignature(page){
  const canvas=page.locator("#docsign-signature-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate(node=>{
    const context=node.getContext("2d");context.lineWidth=4;context.lineCap="round";context.strokeStyle="#151515";context.beginPath();context.moveTo(35,145);
    for(let index=0;index<24;index++)context.lineTo(35+index*27,145+Math.sin(index/2)*34);
    context.stroke();node.dataset.dirty="true";
  });
}


test.describe.serial("document-scoped Arbeitszeitnachweis",()=>{
  test.beforeAll(()=>{required("AORA_WORKSPACE_SLUG");required("AORA_TEST_DATE")});

  test("manager preview, correction, one-time employee signature and signed exports",async({browser,baseURL},testInfo)=>{
    test.setTimeout(300000);
    const root=testInfo.outputPath("document-signing-evidence"),screenshots=path.join(root,"screenshots"),downloads=path.join(root,"downloads");
    await mkdir(screenshots,{recursive:true});await mkdir(downloads,{recursive:true});

    const managerContext=await browser.newContext({baseURL,viewport:{width:1440,height:1100},acceptDownloads:true});
    const manager=await managerContext.newPage(),managerErrors=captureErrors(manager);
    await login(manager,"manager",required("AORA_MANAGER_EMAIL"),required("AORA_MANAGER_PASSWORD"));
    await manager.locator('.admin-nav [data-a="admin-view"][data-view="approvals"]').click();
    await expect(manager.getByRole("heading",{name:"Erst prüfen und exportieren. Dann gezielt bestätigen lassen."})).toBeVisible({timeout:30000});
    await manager.screenshot({path:path.join(screenshots,"01-manager-empty-workflow.png"),fullPage:true});

    await manager.locator("#docsign-date-from").fill(testDate);
    await manager.locator("#docsign-date-to").fill(testDate);
    const prepared=await runAction(manager,"prepareTimesheet",()=>manager.locator('[data-docsign-action="prepare"]').click(),[201]);
    const submissionId=prepared.body.submission.id;
    expect(prepared.body.submission.status).toBe("open");
    expect(prepared.body.submission.document_signature_id).toBeNull();
    expect(prepared.body.submission.payload.snapshot.totals.totalMinutes).toBe(480);
    expect(prepared.body.submission.payload.snapshot.organization.name).toBe("Arbeitgeber");
    await expect(manager.getByText("PDF ohne Unterschrift",{exact:true}).first()).toBeVisible({timeout:30000});
    await manager.screenshot({path:path.join(screenshots,"02-manager-draft-ready.png"),fullPage:true});

    expect((await directCall(manager,"exportTimesheet",{submissionId,format:"pdf",signed:true})).status).toBe(409);
    await installExportProbe(manager);
    const unsignedPdf=await exportFromUi(manager,{format:"pdf",signed:false,downloads});
    const unsignedParsed=await pdfParse(await readFile(unsignedPdf));
    expect(unsignedParsed.text).toContain("UNBESTAETIGTE VERSION");
    expect(unsignedParsed.text).toContain("Keine Bestaetigung des Mitarbeiters");
    expect(unsignedParsed.text).not.toContain("Bestaetigung und einmalige Unterschrift");

    const requested=await runAction(manager,"requestApproval",()=>manager.locator('[data-docsign-action="request"]').first().click(),[200]);
    expect(requested.body.submission.status).toBe("submitted");
    await expect(manager.getByText("Wartet auf Mitarbeiter",{exact:true}).first()).toBeVisible({timeout:30000});
    await manager.screenshot({path:path.join(screenshots,"03-manager-request-sent.png"),fullPage:true});

    const employeeContext=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const employee=await employeeContext.newPage(),employeeErrors=captureErrors(employee);
    await login(employee,"employee",required("AORA_EMPLOYEE_EMAIL"),required("AORA_EMPLOYEE_PASSWORD"));
    await employee.locator('.employee-bottom [data-a="employee-view"][data-view="more"]').click();
    await expect(employee.getByRole("heading",{name:"Prüfen & einmalig unterschreiben"})).toBeVisible({timeout:30000});
    await employee.locator('[data-docsign-action="open-employee"]').click();
    await expect(employee.getByRole("heading",{name:"Du entscheidest bei jedem Nachweis neu."})).toBeVisible({timeout:30000});
    await employee.screenshot({path:path.join(screenshots,"04-employee-inbox.png"),fullPage:true});

    await employee.locator(`[data-docsign-action="view"][data-submission-id="${submissionId}"]`).click();
    await expect(employee.locator("#docsign-consent")).toBeVisible();
    await expect(employee.getByText("Diese Zeichnung wird nicht als allgemeine Unterschrift gespeichert.")).toBeVisible();
    await employee.locator("#docsign-decision-note").fill("Bitte Beginn nochmals prüfen.");
    const declined=await runAction(employee,"decideTimesheet",()=>employee.locator('[data-docsign-action="decide"][data-decision="declined"]').click(),[200]);
    expect(declined.body.submission.status).toBe("open");
    expect(declined.body.submission.employee_decision).toBe("declined");
    await employee.screenshot({path:path.join(screenshots,"05-employee-correction-requested.png"),fullPage:true});

    await manager.locator('[data-docsign-action="refresh-manager"]').click();
    await expect(manager.getByText("Korrektur angefordert",{exact:true}).first()).toBeVisible({timeout:30000});
    await expect(manager.getByText("Bitte Beginn nochmals prüfen.").first()).toBeVisible();
    await manager.screenshot({path:path.join(screenshots,"06-manager-correction-visible.png"),fullPage:true});

    const versionTwo=await runAction(manager,"prepareTimesheet",()=>manager.locator('[data-docsign-action="prepare"]').click(),[200]);
    expect(versionTwo.body.submission.version).toBe(2);
    expect(versionTwo.body.submission.status).toBe("open");
    await runAction(manager,"requestApproval",()=>manager.locator('[data-docsign-action="request"]').first().click(),[200]);

    await employee.locator('[data-docsign-action="refresh-employee"]').click();
    await expect(employee.getByText(/Version 2/).first()).toBeVisible({timeout:30000});
    await employee.locator(`[data-docsign-action="view"][data-submission-id="${submissionId}"]`).click();
    await expect(employee.getByText("Arbeitszeitnachweis · Version 2")).toBeVisible();
    await employee.locator("#docsign-consent").check();
    await drawSignature(employee);
    await employee.screenshot({path:path.join(screenshots,"07-employee-one-time-signature.png"),fullPage:true});
    const approved=await runAction(employee,"decideTimesheet",()=>employee.locator('[data-docsign-action="decide"][data-decision="approved"]').click(),[200]);
    expect(approved.body.submission.status).toBe("approved");
    expect(approved.body.submission.document_signature_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(approved.body.submission.signature_id).toBeNull();
    expect(approved.body.submission.signed_hash).toMatch(/^[a-f0-9]{64}$/);
    await employee.screenshot({path:path.join(screenshots,"08-employee-approved.png"),fullPage:true});

    expect((await directCall(employee,"exportTimesheet",{submissionId,format:"pdf",signed:true})).status).toBe(403);
    await manager.locator('[data-docsign-action="refresh-manager"]').click();
    await expect(manager.getByText("Bestätigt & unterschrieben",{exact:true}).first()).toBeVisible({timeout:30000});
    await manager.screenshot({path:path.join(screenshots,"09-manager-signed-ready.png"),fullPage:true});

    const signedPdf=await exportFromUi(manager,{format:"pdf",signed:true,downloads});
    const signedXlsx=await exportFromUi(manager,{format:"xlsx",signed:true,downloads});
    const signedParsed=await pdfParse(await readFile(signedPdf));
    expect(signedParsed.text).toContain("BESTAETIGTE VERSION MIT MITARBEITERUNTERSCHRIFT");
    expect(signedParsed.text).toContain("Bestaetigung und einmalige Unterschrift des Mitarbeiters");
    expect(signedParsed.text).toContain("Einstein Kaffee Testfiliale");
    expect(signedParsed.text).toContain("CI Employee");
    expect(signedParsed.text).not.toMatch(/Aora/i);

    const archive=unzipSync(new Uint8Array(await readFile(signedXlsx)));
    const workbookXml=strFromU8(archive["xl/workbook.xml"]);
    expect(workbookXml).toContain('name="Arbeitszeit"');expect(workbookXml).toContain('name="Zusammenfassung"');expect(workbookXml).toContain('name="Freigabe"');
    const workbookText=Object.entries(archive).filter(([name])=>name.endsWith(".xml")).map(([,bytes])=>strFromU8(bytes)).join("\n");
    expect(workbookText).toContain("Vom Mitarbeiter digital bestätigt und einmalig unterschrieben");
    expect(workbookText).toContain("Die Unterschrift gilt ausschließlich für diese Dokumentversion");
    expect(workbookText).not.toMatch(/Aora/i);

    await manager.locator('[data-docsign-action="refresh-manager"]').click();
    await expect(manager.getByText("Bestätigt & exportiert",{exact:true}).first()).toBeVisible({timeout:30000});
    await manager.screenshot({path:path.join(screenshots,"10-manager-final-locked.png"),fullPage:true});
    expect((await directCall(manager,"prepareTimesheet",{employeeId:prepared.body.submission.employee_id,dateFrom:testDate,dateTo:testDate})).status).toBe(409);

    expect(managerErrors()).toEqual([]);expect(employeeErrors()).toEqual([]);
    await employeeContext.close();await managerContext.close();
  });
});
