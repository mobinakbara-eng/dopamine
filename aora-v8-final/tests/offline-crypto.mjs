import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

const crypto=webcrypto;
const event={
  type:"KIOSK_TRANSITION",
  eventId:"123e4567-e89b-42d3-a456-426614174000",
  employeeId:"employee-secret-42",
  target:"in",
  clientCreatedAt:"2026-07-28T10:00:00.000Z",
  clientTimezone:"Europe/Berlin",
  deviceClockOffset:-120,
};
const context={organizationId:"org-test",deviceId:"device-test"};
const additionalData=new TextEncoder().encode(`aora|${context.organizationId}|${context.deviceId}|punch|${event.eventId}`);
const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
assert.equal(key.extractable,false,"Device key must be non-extractable");
await assert.rejects(()=>crypto.subtle.exportKey("raw",key),/key is not extractable|not extractable/i);
const iv=crypto.getRandomValues(new Uint8Array(12));
const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData},key,new TextEncoder().encode(JSON.stringify(event)));
const stored={eventId:event.eventId,keyId:`${context.organizationId}:${context.deviceId}`,organizationId:context.organizationId,deviceId:context.deviceId,iv:Array.from(iv),ciphertext,status:"pending",retryCount:0};
const serialized=JSON.stringify({...stored,ciphertext:Array.from(new Uint8Array(ciphertext))});
assert.equal(serialized.includes(event.employeeId),false,"Employee ID leaked into stored record");
assert.equal(serialized.includes(`\"target\":\"${event.target}\"`),false,"Transition leaked into stored record");
assert.equal(Object.hasOwn(stored,"payload"),false,"Plaintext payload property is forbidden");
assert.equal(Object.hasOwn(stored,"employeeId"),false,"Plaintext employee property is forbidden");
const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData},key,ciphertext);
assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)),event,"AES-GCM round trip changed the punch payload");
await assert.rejects(()=>crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode("wrong-device")},key,ciphertext),/operation|decrypt|authentication/i);
console.log("Offline AES-GCM test passed: non-extractable key, no plaintext employee/transition metadata, authenticated round trip.");