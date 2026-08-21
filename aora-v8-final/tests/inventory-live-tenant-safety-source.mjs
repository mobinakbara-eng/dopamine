import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const self=path.basename(import.meta.filename);
const protectedMarkers=[
  'e407edf2-3f4f-4381-bb77-cb4e7cec437f',
  'loc_8ff914fb-8b8d-4ed7-8127-3b7717c4df20',
  'loc_b422ae70-7df2-4279-b521-9a25477baf0e',
  'Einstein Kaffee am Tacheles',
  'EK Tacheles',
  'lxpmgnllgqdulfjxbdau',
];

const roots=[
  'app/modules',
  'supabase/functions/aora-v8-inventory-next',
  'supabase/migrations',
  'tests',
];

function walk(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const inventoryFiles=roots.flatMap(rel=>walk(path.join(root,rel))).filter(file=>{
  const name=path.basename(file);
  const rel=path.relative(root,file).replaceAll('\\','/');
  if(name===self) return false;
  if(!/\.(js|mjs|ts|sql)$/.test(name)) return false;
  return rel.includes('/inventory-')||rel.includes('aora-v8-inventory-next/')||name.includes('inventory');
});

const hits=[];
for(const file of inventoryFiles){
  const text=fs.readFileSync(file,'utf8');
  for(const marker of protectedMarkers){
    if(text.includes(marker)) hits.push(`${path.relative(root,file)} -> ${marker}`);
  }
}

assert.equal(hits.length,0,`Inventory product/QA source must never hard-code the active EK Tacheles tenant, locations, or production project. Found:\n${hits.join('\n')}`);

console.log('inventory live-tenant safety source gate passed');
