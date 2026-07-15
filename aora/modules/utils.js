function routeRole(){
  const queryRole=new URLSearchParams(location.search).get("role");
  const aliases={admin:"admin",arbeitgeber:"admin",employee:"employee",arbeitnehmer:"employee",kiosk:"kiosk"};
  if(aliases[queryRole])return aliases[queryRole];
  const match=location.pathname.match(/(?:^|\/)(admin|arbeitgeber|employee|arbeitnehmer|kiosk)(?:\/|$)/);
  return aliases[match?.[1]]||null;
}
function rolePath(role){
  const paths={admin:"arbeitgeber/",employee:"arbeitnehmer/",kiosk:"kiosk/dashboard/"};
  return new URL(paths[role]||"arbeitnehmer/",document.baseURI).pathname;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c])}
function initials(n){return String(n||"AO").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function toast(msg,type=""){const n=document.createElement("div");n.className=`toast ${type}`;n.textContent=msg;toasts.appendChild(n);setTimeout(()=>n.remove(),3800)}
function berlin(){const p=new Intl.DateTimeFormat("sv-SE",{timeZone:CFG.tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date()).reduce((a,x)=>(x.type!=="literal"&&(a[x.type]=x.value),a),{});return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,seconds:p.second}}
function fd(v,opt={}){if(!v)return"–";const d=v instanceof Date?v:new Date(`${v}T12:00:00`);return new Intl.DateTimeFormat("de-DE",{timeZone:CFG.tz,weekday:opt.weekday?"long":undefined,day:"2-digit",month:opt.long?"long":"2-digit",year:opt.year===false?undefined:"numeric"}).format(d)}function startWeek(v=new Date()){const d=new Date(v),day=d.getDay()||7;d.setDate(d.getDate()-day+1);d.setHours(12,0,0,0);return d.toISOString().slice(0,10)}function addDays(s,n){const d=new Date(`${s}T12:00:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}function mins(a,b,br=0){if(!a||!b)return 0;const[ah,am]=a.split(":").map(Number),[bh,bm]=b.split(":").map(Number);let m=bh*60+bm-ah*60-am;if(m<0)m+=1440;return Math.max(0,m-Number(br||0))}function fm(m){m=Math.round(Number(m||0));const sign=m<0?"−":"";m=Math.abs(m);return`${sign}${String(Math.floor(m/60)).padStart(2,"0")}h ${String(m%60).padStart(2,"0")}m`}function emp(id){return S.state?.employees?.find(x=>x.id===id)||S.directory?.employees?.find(x=>x.id===id)}function loc(id){return S.state?.locations?.find(x=>x.id===id)||S.directory?.locations?.find(x=>x.id===id)}function live(id){return S.state?.timeEntries?.find(x=>x.employeeId===id&&["live","paused"].includes(x.status))}
