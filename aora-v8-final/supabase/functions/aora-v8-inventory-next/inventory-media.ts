import {db,dbFail,fail,asUuid,requirePermission,type InventoryContext} from "./lib.ts";

const BUCKET="inventory-media";
const MAX_BYTES=8*1024*1024;
const MIME_EXT:Record<string,string>={
  "image/jpeg":"jpg",
  "image/png":"png",
  "image/webp":"webp",
  "image/heic":"heic",
  "image/heif":"heif"
};

type Kind="item"|"supplier";

function kind(value:any):Kind{
  const k=String(value||"");
  if(k!=="item"&&k!=="supplier")fail(400,"inventory_media_kind_invalid","Bildtyp ist ungültig.");
  return k as Kind;
}
function tableFor(k:Kind){return k==="item"?"inventory_items":"inventory_suppliers"}
function pathPrefix(ctx:InventoryContext,k:Kind,id:string){return`${ctx.organizationId}/${k}/${id}/`}

async function assertEntity(ctx:InventoryContext,k:Kind,id:string,requestId:string){
  const{data,error}=await db.from(tableFor(k)).select("id,image_path").eq("organization_id",ctx.organizationId).eq("id",id).eq("active",true).maybeSingle();
  if(error)dbFail(error,"inventory_media_entity",requestId);
  if(!data)fail(404,"inventory_media_entity_not_found",k==="item"?"Artikel wurde nicht gefunden.":"Lieferant wurde nicht gefunden.");
  return data as any;
}

export async function prepareInventoryImageUpload(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const k=kind(body.kind),entityId=asUuid(body.entityId,k),mimeType=String(body.mimeType||"").toLowerCase(),size=Number(body.size||0);
  if(!MIME_EXT[mimeType])fail(415,"inventory_media_type_invalid","Bitte JPG, PNG, WebP, HEIC oder HEIF verwenden.");
  if(!Number.isFinite(size)||size<=0||size>MAX_BYTES)fail(413,"inventory_media_size_invalid","Das Bild darf höchstens 8 MB groß sein.");
  await assertEntity(ctx,k,entityId,requestId);
  const path=`${pathPrefix(ctx,k,entityId)}${crypto.randomUUID()}.${MIME_EXT[mimeType]}`;
  const{data,error}=await db.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});
  if(error||!data?.token)dbFail(error||new Error("signed_upload_missing"),"inventory_media_prepare",requestId);
  return{bucket:BUCKET,path,token:data.token,signedUrl:data.signedUrl,maxBytes:MAX_BYTES};
}

export async function confirmInventoryImageUpload(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"procurement",requestId);
  const k=kind(body.kind),entityId=asUuid(body.entityId,k),path=String(body.path||"");
  const prefix=pathPrefix(ctx,k,entityId);
  if(!path.startsWith(prefix)||path.includes(".."))fail(400,"inventory_media_path_invalid","Bildpfad ist ungültig.");
  const filename=path.slice(prefix.length);
  if(!filename||filename.includes("/"))fail(400,"inventory_media_path_invalid","Bildpfad ist ungültig.");
  const entity=await assertEntity(ctx,k,entityId,requestId);
  const{data:objects,error:listError}=await db.storage.from(BUCKET).list(prefix.replace(/\/$/,""),{limit:20,search:filename});
  if(listError)dbFail(listError,"inventory_media_verify",requestId);
  const object=(objects||[]).find((x:any)=>String(x.name)===filename);
  if(!object)fail(409,"inventory_media_upload_missing","Upload wurde nicht gefunden. Bitte Bild erneut auswählen.");
  const{data,error}=await db.from(tableFor(k)).update({image_path:path}).eq("organization_id",ctx.organizationId).eq("id",entityId).select("id,image_path").single();
  if(error)dbFail(error,"inventory_media_confirm",requestId);
  const oldPath=String(entity?.image_path||"");
  if(oldPath&&oldPath!==path&&oldPath.startsWith(`${ctx.organizationId}/`)){
    await db.storage.from(BUCKET).remove([oldPath]).catch(()=>null);
  }
  return{entityId,imagePath:data.image_path};
}

export async function listInventoryMedia(ctx:InventoryContext,body:any,requestId:string){
  const locationId=String(body.locationId||"");
  await requirePermission(ctx,locationId,"view",requestId);
  const itemIds=[...new Set((Array.isArray(body.itemIds)?body.itemIds:[]).slice(0,500).map((x:any)=>asUuid(x,"item")))];
  const supplierIds=[...new Set((Array.isArray(body.supplierIds)?body.supplierIds:[]).slice(0,500).map((x:any)=>asUuid(x,"supplier")))];
  const[{data:items,error:ie},{data:suppliers,error:se}]=await Promise.all([
    itemIds.length?db.from("inventory_items").select("id,image_path").eq("organization_id",ctx.organizationId).in("id",itemIds):Promise.resolve({data:[],error:null}),
    supplierIds.length?db.from("inventory_suppliers").select("id,image_path").eq("organization_id",ctx.organizationId).in("id",supplierIds):Promise.resolve({data:[],error:null})
  ]);
  if(ie||se)dbFail(ie||se,"inventory_media_list",requestId);
  const rows=[...(items||[]).map((r:any)=>({kind:"item",...r})),...(suppliers||[]).map((r:any)=>({kind:"supplier",...r}))].filter((r:any)=>Boolean(r.image_path));
  if(!rows.length)return{items:[],suppliers:[]};
  const paths=rows.map((r:any)=>String(r.image_path));
  const{data:signed,error}=await db.storage.from(BUCKET).createSignedUrls(paths,3600);
  if(error)dbFail(error,"inventory_media_sign",requestId);
  const byPath=new Map((signed||[]).map((r:any)=>[String(r.path||""),r.signedUrl||null]));
  return{
    items:rows.filter((r:any)=>r.kind==="item").map((r:any)=>({id:r.id,url:byPath.get(String(r.image_path))||null})),
    suppliers:rows.filter((r:any)=>r.kind==="supplier").map((r:any)=>({id:r.id,url:byPath.get(String(r.image_path))||null}))
  };
}
