import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const taskExperience=await readFile(new URL("../app/modules/task-experience-v3.js",import.meta.url),"utf8");
const managerComposer=await readFile(new URL("../app/modules/manager-task-composer-v3.js",import.meta.url),"utf8");

async function mount(page){
  await page.setContent('<main id="app"></main>');
  await page.addScriptTag({content:`
    if(typeof crypto.randomUUID!=="function")Object.defineProperty(crypto,"randomUUID",{value:()=>"00000000-0000-4000-8000-000000000001"});
    window.CFG={};
    window.S={
      session:{token:"token-a",organizationId:"org-a",subjectId:"employee-a"},
      locationId:"location-a",
      state:{employees:[{id:"employee-a",name:"Anna Test",role:"Mitarbeiter",locationId:"location-a",active:true}]},
      u:{schedule:{data:{employees:[]}},tasks:{data:[],selected:null,loading:false,error:"",managerData:null,managerLoading:false}}
    };
    window.__taskCalls=0;
    window.__taskFailure=true;
    window.uCall=async function(action,payload){
      if(action==="tasks"){
        window.__taskCalls++;
        if(window.__taskFailure)throw new Error("Backend vorübergehend nicht erreichbar");
        return[];
      }
      if(action==="scheduleBoard")return{shifts:[]};
      return[];
    };
    window.request=async()=>({data:[],error:null});
    window.uEnsureManagerTasks=async()=>{};
    window.uFlag=()=>true;
    window.uAdd=(date,days)=>date+":"+days;
    window.berlin=()=>({date:"2026-08-09"});
    window.uErrorMessage=error=>error?.message||"Unbekannter Fehler";
    window.uHtml=value=>String(value??"").replace(/[&<>\"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[char]);
    window.uLocationName=id=>id;
    window.toast=()=>{};
    window.uTaskDetail=()=>'<section><div class="u-actions"></div></section>';
    window.render=function(){
      const root=document.querySelector("#app");
      if(S.u.tasks.loading){root.innerHTML='<p data-state="loading">Lädt …</p>';return}
      if(S.u.tasks.error){root.innerHTML='<div role="alert"><span>'+uHtml(S.u.tasks.error)+'</span><button type="button" data-aora-task-retry="employee">Erneut laden</button></div>';return}
      root.innerHTML='<p data-state="empty">Keine Aufgaben.</p>';
    };
  `});
  await page.addScriptTag({content:taskExperience});
}

test("failed employee task load stops after one request and retries only on click",async({page})=>{
  await mount(page);
  await page.evaluate(()=>uEnsureEmployeeTasks());
  await expect(page.getByRole("alert")).toContainText("Backend vorübergehend nicht erreichbar");
  await expect(page.getByRole("button",{name:"Erneut laden"})).toBeVisible();
  expect(await page.evaluate(()=>window.__taskCalls)).toBe(1);
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>window.__taskCalls)).toBe(1);

  await page.evaluate(()=>{window.__taskFailure=false});
  await page.getByRole("button",{name:"Erneut laden"}).click();
  await expect(page.locator('[data-state="empty"]')).toBeVisible();
  expect(await page.evaluate(()=>window.__taskCalls)).toBe(2);
  await expect(page.locator('[data-state="loading"]')).toHaveCount(0);
});

test("employee photo proof and manager task controls remain separate",async({page})=>{
  await mount(page);
  const detail=await page.evaluate(()=>uTaskDetail({
    id:"task-a",
    payload:{photoEvidenceRequired:true},
    task_evidence:[]
  }));
  await page.locator("#app").evaluate((node,html)=>{node.innerHTML=html},detail);
  await expect(page.getByText("Foto-Nachweis erforderlich",{exact:true})).toBeVisible();
  const capture=page.locator('[data-aora-photo-proof][capture="environment"]');
  await expect(capture).toHaveAttribute("accept","image/*");

  await page.evaluate(()=>{
    S.u.tasks.managerData={locationId:S.locationId,templates:[{id:"template-a",title:"Reinigung",active:true}],rules:[],tasks:[]};
  });
  await page.addScriptTag({content:managerComposer});
  await page.evaluate(()=>uManualTaskDialog());
  const dialog=page.locator('[data-composer="manual-v3"]');
  await expect(dialog).toBeVisible();
  const mandatory=dialog.locator('[name="required"]');
  const proof=dialog.locator('[name="photoEvidenceRequired"]');
  await proof.check();
  await expect(mandatory).not.toBeChecked();
  await mandatory.check();
  await expect(proof).toBeChecked();
  await expect(dialog.locator('[name="managerReference"]')).toHaveAttribute("accept",/image\/jpeg/);
  await expect(dialog.getByText("Foto zur Aufgabe",{exact:true})).toBeVisible();
});
