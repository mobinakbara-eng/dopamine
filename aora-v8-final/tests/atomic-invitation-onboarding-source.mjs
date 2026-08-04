import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=path=>readFile(resolve(root,path),"utf8");
const [origin,invitation,structural,onboarding,migration]=await Promise.all([
  read("supabase/functions/aora-v8-final-workspace/origin.ts"),
  read("supabase/functions/aora-v8-final-workspace/invitation.ts"),
  read("supabase/functions/aora-v8-final-workspace/structural-custom.ts"),
  read("supabase/functions/aora-v8-pilot-onboarding/index.ts"),
  read("supabase/migrations/20260804221343_atomic_account_invitation_onboarding.sql"),
]);

const requireAll=(name,text,markers)=>{
  for(const marker of markers)if(!text.includes(marker))throw new Error(`Missing ${name} marker: ${marker}`);
};
const forbid=(name,text,marker)=>{
  if(text.includes(marker))throw new Error(`Forbidden ${name} marker: ${marker}`);
};

requireAll("canonical origin",origin,["AORA_APP_ORIGIN","FALLBACK_APP_ORIGIN","appOriginForRequest"]);
requireAll("restricted preview origin",origin,["TEAM_PREVIEW_SUFFIX",'url.protocol !== "https:"','url.origin === canonicalAppOrigin()']);
forbid("broad Vercel origin",origin,'hostname.endsWith(".vercel.app")');
requireAll("prepared invitation",invitation,["prepareInvitationToken","tokenHash","delivery","appOriginForRequest"]);
requireAll("atomic structural writes",structural,["aora_commit_invitation_change","aora_commit_account_deactivation","persistInvitationChange","persistAccountDeactivation"]);
requireAll("onboarding v2",onboarding,["aora_provision_pilot_organization_v2","p_kiosk_activation_code","p_kiosk_activation_expires_at","canonicalAppUrl"]);
requireAll("atomic migration",migration,[
  "create or replace function public.aora_commit_account_deactivation",
  "create or replace function public.aora_commit_invitation_change",
  "create or replace function public.aora_provision_pilot_organization_v2",
  "crypt(p_kiosk_activation_code,gen_salt('bf'))",
  "p_kiosk_activation_code !~ '^[0-9]{8}$'",
  "for update of identity",
  "set pin_hash=null, pin_expires_at=null",
  "interval '30 days'",
  "pin_expires_at",
  "validate_demo_session",
  "demo_logout",
]);
forbid("invitation origin",invitation,"dopamine-mobins-projects-4f428afa.vercel.app");
forbid("structural kiosk origin",structural,"dopamine-mobins-projects-4f428afa.vercel.app");
forbid("onboarding origin",onboarding,"dopamine-mobins-projects-4f428afa.vercel.app");

console.log("Atomic invitation, account, and onboarding source gate passed.");
