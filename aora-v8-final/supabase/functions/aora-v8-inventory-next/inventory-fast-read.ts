import {db,dbFail,fail} from "./lib.ts";

function mapFastReadResult(result:any){
  const status=String(result?.status||"");
  if(status==="ok")return result?.data||{};
  if(status==="invalid_session"||!status)fail(401,"invalid_session","Sitzung ist ungültig oder abgelaufen.");
  if(status==="organization_inactive")fail(403,"organization_inactive","Organisation ist nicht aktiv.");
  if(status==="admin_inactive")fail(403,"admin_inactive","Administrationszugang wurde deaktiviert.");
  if(status==="employee_inactive")fail(403,"employee_inactive","Mitarbeiterzugang wurde deaktiviert.");
  if(status==="employee_action_forbidden")fail(403,"employee_action_forbidden","Mitarbeiter dürfen diese Bestandsansicht nicht öffnen.");
  if(status==="location_forbidden")fail(403,"location_forbidden","Für diesen Standort fehlt die Berechtigung.");
  if(status==="inventory_permission_forbidden")fail(403,"inventory_permission_forbidden","Für diese Bestandsfunktion fehlt die Berechtigung.");
  if(status==="feature_disabled")fail(404,"feature_disabled","Diese Funktion ist für diesen Betrieb noch nicht freigeschaltet.");
  fail(403,"inventory_forbidden","Bestand ist für diesen Zugang nicht freigeschaltet.");
}

export async function fastOverview(sessionToken:string,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  if(!locationId)fail(400,"location_invalid","Standort fehlt.");
  const{data,error}=await db.rpc("aora_inventory_session_overview",{p_token:sessionToken,p_location_id:locationId});
  if(error)dbFail(error,"fast_overview",requestId);
  return mapFastReadResult(data);
}

export async function fastStock(sessionToken:string,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  if(!locationId)fail(400,"location_invalid","Standort fehlt.");
  const{data,error}=await db.rpc("aora_inventory_session_stock",{
    p_token:sessionToken,
    p_location_id:locationId,
    p_search:String(body.search||""),
    p_limit:Math.min(500,Math.max(1,Number(body.limit||500)))
  });
  if(error)dbFail(error,"fast_stock",requestId);
  return mapFastReadResult(data);
}

export async function fastMovements(sessionToken:string,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  if(!locationId)fail(400,"location_invalid","Standort fehlt.");
  const{data,error}=await db.rpc("aora_inventory_session_movements",{
    p_token:sessionToken,
    p_location_id:locationId,
    p_limit:Math.min(200,Math.max(1,Number(body.limit||100)))
  });
  if(error)dbFail(error,"fast_movements",requestId);
  return mapFastReadResult(data);
}

export async function fastReplenishment(sessionToken:string,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  if(!locationId)fail(400,"location_invalid","Standort fehlt.");
  const{data,error}=await db.rpc("aora_inventory_session_replenishment",{
    p_token:sessionToken,
    p_location_id:locationId
  });
  if(error)dbFail(error,"fast_replenishment",requestId);
  return mapFastReadResult(data);
}
