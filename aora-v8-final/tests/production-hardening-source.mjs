import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const required=(name,text,markers)=>{
  for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`);
};

const [index,build,rootVercel,localVercel,domainPatch,recovery,diagnostic,indexMigration,recoveryMigration,pgNetMigration]=await Promise.all([
  read("app/index.html"),
  read("build.mjs"),
  read("../vercel.json"),
  read("vercel.json"),
  read("supabase/functions/aora-v8-domain-patch/index.ts"),
  read("supabase/functions/aora-v8-account-recovery/index.ts"),
  read("supabase/functions/aora-auth-diagnostic/index.ts"),
  read("supabase/migrations/202607311930_aora_missing_fk_indexes.sql"),
  read("supabase/migrations/202607311940_aora_account_recovery.sql"),
  read("supabase/migrations/202607311950_aora_pg_net_extension_schema.sql")
]);

required("index",index,["domain-patch-routing.js?v=827","production-experience.js?v=827","production-experience-fixes.js?v=827"]);
required("build",build,['"reset-password"','domainPatch:','accountRecovery:']);
for(const [name,text] of [["root Vercel",rootVercel],["local Vercel",localVercel]]){
  required(name,text,["Content-Security-Policy","frame-ancestors 'none'","X-Frame-Options","https://lxpmgnllgqdulfjxbdau.supabase.co","https://xqgkawskftzurbujrpex.supabase.co"]);
}
required("domain patch",domainPatch,["case\"evidenceUpload\"","case\"confirmEvidence\"","case\"pushSubscribe\"","case\"managerOverride\"","case\"createShiftSeries\"","const seriesId=makeId(\"series\")"]);
required("account recovery",recovery,["case\"requestReset\"","case\"approveReset\"","case\"resetPassword\"","aora_complete_password_reset","api.pwnedpasswords.com/range","requester_hash:requesterHash"]);
required("disabled diagnostic",diagnostic,["Diagnostic endpoint disabled","status:410","cache-control"]);
required("index migration",indexMigration,["app_sessions_org_idx","employees_primary_location_idx","workspace_events_actor_user_idx"]);
required("recovery migration",recoveryMigration,["password_reset_requests","support_requests","aora_complete_password_reset","edge_only_deny_direct"]);
required("pg_net migration",pgNetMigration,["drop extension if exists pg_net","create extension pg_net with schema extensions"]);

console.log("Production hardening source gate passed.");
