import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const taskExperience=await readFile(new URL("../app/modules/task-experience-v3.js",import.meta.url),"utf8");
const runtimeFixes=await readFile(new URL("../app/modules/unified-runtime-fixes.js",import.meta.url),"utf8");
const compat=await readFile(new URL("../supabase/functions/aora-v8-domain-api-compat/index.ts",import.meta.url),"utf8");

function deferred(){
  let resolve,reject;
  const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail});
  return{promise,resolve,reject};
}

function taskContext(call){
  const context={
    console,
    crypto:globalThis.crypto,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    CFG:{},
    S:{
      session:{token:"token-a",organizationId:"org-a",subjectId:"employee-a"},
      locationId:"location-a",
      u:{tasks:{data:[],selected:null,loading:false,error:"",managerData:null,managerLoading:false}}
    },
    window:{__AORA_RUNTIME_CONFIG__:{functions:{}}},
    document:{addEventListener(){},querySelectorAll(){return[]}},
    CSS:{escape:value=>String(value)},
    request:async()=>({data:null,error:null}),
    uCall:call,
    uEnsureManagerTasks:async()=>{},
    uFlag:()=>true,
    uAdd:(date,days)=>`${date}:${days}`,
    berlin:()=>({date:"2026-08-09"}),
    render(){},
    uErrorMessage:error=>error?.message||"error",
    uHtml:value=>String(value),
    toast(){},
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(taskExperience,context,{filename:"task-experience-v3.js"});
  return context;
}

{
  let requests=0;
  let invalidations=0;
  const context=taskContext(async action=>{
    if(action==="tasks"){
      requests++;
      throw new Error("temporary backend failure");
    }
    return[];
  });
  context.uInvalidateDomainCache=()=>{invalidations++};

  await context.uEnsureEmployeeTasks();
  assert.equal(requests,1,"the first failed employee load must issue exactly one request");
  assert.equal(context.S.u.tasks.error,"temporary backend failure");
  await context.uEnsureEmployeeTasks();
  assert.equal(requests,1,"render/re-entry must not retry a failed load automatically");
  await context.uEnsureEmployeeTasks(true);
  assert.equal(requests,2,"explicit retry must issue exactly one new request");
  assert.equal(invalidations,1,"explicit retry must bypass the read cache");
}

{
  let requests=0;
  const context=taskContext(async action=>{
    if(action==="tasks")requests++;
    return[];
  });
  await context.uEnsureEmployeeTasks();
  await context.uEnsureEmployeeTasks();
  assert.equal(requests,1,"an empty task list is a completed load, not a retry trigger");
}

{
  const pending=new Map();
  const context=taskContext((action,payload)=>{
    const item=deferred();
    pending.set(`${payload.locationId}:${action}`,item);
    return item.promise;
  });
  const first=context.uEnsureManagerTasks();
  context.S.locationId="location-b";
  const second=context.uEnsureManagerTasks();

  for(const action of["taskTemplates","taskRules","tasks"]){
    pending.get(`location-a:${action}`).resolve([{source:"location-a"}]);
  }
  await first;
  assert.equal(context.S.u.tasks.managerData,null,"a late response from the previous location must be discarded");

  for(const action of["taskTemplates","taskRules","tasks"]){
    pending.get(`location-b:${action}`).resolve([{source:"location-b"}]);
  }
  await second;
  assert.equal(context.S.u.tasks.managerData.locationId,"location-b");
  assert.equal(context.S.u.tasks.managerData.tasks[0].source,"location-b");
}

{
  const first=deferred();
  let call=0;
  const context=taskContext(async action=>{
    if(action!=="tasks")return[];
    call++;
    if(call===1)return first.promise;
    return[{id:"new-session-task"}];
  });
  const oldLoad=context.uEnsureEmployeeTasks();
  context.S.session={token:"token-b",organizationId:"org-b",subjectId:"employee-a"};
  const newLoad=context.uEnsureEmployeeTasks();
  first.resolve([{id:"old-session-task"}]);
  await oldLoad;
  await newLoad;
  assert.deepEqual(Array.from(context.S.u.tasks.data,item=>item.id),["new-session-task"],"a late response must not cross the session/tenant boundary");
}

{
  let requests=0;
  const context={
    console,
    CFG:{domainFunction:"domain",featureFunction:"feature",url:"https://example.invalid"},
    S:{session:{token:"token-a",organizationId:"org-a",subjectId:"same-id"},locationId:"same-location"},
    document:{head:null,querySelector(){return null}},
    navigator:{},
    uCall:async()=>null,
    request:async()=>{requests++;return{data:[requests],error:null}},
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(runtimeFixes,context,{filename:"unified-runtime-fixes.js"});
  await context.uCall("tasks",{from:"2026-08-01",to:"2026-08-09"});
  await context.uCall("tasks",{from:"2026-08-01",to:"2026-08-09"});
  assert.equal(requests,1,"same-session reads should still be deduplicated");
  context.S.session={token:"token-b",organizationId:"org-b",subjectId:"same-id"};
  await context.uCall("tasks",{from:"2026-08-01",to:"2026-08-09"});
  assert.equal(requests,2,"cache entries must never cross organization/session boundaries");
  context.uInvalidateDomainCache();
  await context.uCall("tasks",{from:"2026-08-01",to:"2026-08-09"});
  assert.equal(requests,3,"media mutations and explicit retries must invalidate cached reads");
}

assert.match(compat,/task\.payload\?\.photoEvidenceRequired===true[\s\S]*__aora_employee_photo__[\s\S]*photo_evidence_required/);
assert.match(compat,/action:action\|\|"unknown"/);
assert.match(compat,/aora-domain-compat-failed/);

console.log("Task runtime gate passed: bounded retries, empty state, cache isolation, stale-response isolation and direct photo enforcement.");
