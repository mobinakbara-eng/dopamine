export function monthRange(period:string){
  const[year,month]=period.split("-").map(Number);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return{from:`${period}-01`,to:`${period}-${String(last).padStart(2,"0")}`,datev:`01/${String(month).padStart(2,"0")}/${year}`};
}

export function clockMinutes(value:unknown){
  const match=String(value||"").match(/^(\d{1,2}):(\d{2})/);
  return match?Number(match[1])*60+Number(match[2]):null;
}

export function entryMinutes(entry:any){
  const stored=Number(entry?.durationMinutes??entry?.duration_minutes);
  if(Number.isFinite(stored)&&stored>=0)return Math.round(stored);
  const startRaw=entry?.start??entry?.startTime??entry?.start_time;
  const endRaw=entry?.end??entry?.endTime??entry?.end_time;
  const start=clockMinutes(String(startRaw||"").includes("T")?String(startRaw).slice(11,16):startRaw);
  let end=clockMinutes(String(endRaw||"").includes("T")?String(endRaw).slice(11,16):endRaw);
  if(start===null||end===null)return 0;
  if(end<start)end+=1440;
  const breakMinutes=Math.max(0,Number(entry?.breakMinutes??entry?.break_minutes??0)||0);
  return Math.max(0,Math.round(end-start-breakMinutes));
}

export function decimalComma(value:number){
  if(!Number.isFinite(value))throw new Error("invalid_hours_value");
  return value.toFixed(2).replace(".",",");
}

export function stableStringify(value:any):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;
  return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
