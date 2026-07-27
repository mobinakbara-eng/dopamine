"use strict";

function isoDateValue(value){
  if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value))return value.slice(0,10);
  const date=value instanceof Date?value:new Date(value||Date.now());
  const parts=new Intl.DateTimeFormat("sv-SE",{
    timeZone:CFG.tz,year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date).reduce((result,part)=>{
    if(part.type!=="literal")result[part.type]=part.value;
    return result;
  },{});
  return`${parts.year}-${parts.month}-${parts.day}`;
}

function isoDateObject(value){
  const [year,month,day]=isoDateValue(value).split("-").map(Number);
  return new Date(Date.UTC(year,month-1,day,12,0,0));
}

function fd(value,options={}){
  if(!value)return"–";
  const dateOnly=typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value);
  const date=dateOnly?isoDateObject(value):(value instanceof Date?value:new Date(value));
  if(Number.isNaN(date.getTime()))return"–";
  return new Intl.DateTimeFormat("de-DE",{
    timeZone:dateOnly?"UTC":CFG.tz,
    weekday:options.weekday?"long":undefined,
    day:"2-digit",
    month:options.long?"long":"2-digit",
    year:options.year===false?undefined:"numeric"
  }).format(date);
}

function startWeek(value=berlin().date){
  const date=isoDateObject(value);
  const weekday=date.getUTCDay()||7;
  date.setUTCDate(date.getUTCDate()-weekday+1);
  return date.toISOString().slice(0,10);
}

function addDays(value,days){
  const date=isoDateObject(value);
  date.setUTCDate(date.getUTCDate()+Number(days||0));
  return date.toISOString().slice(0,10);
}
