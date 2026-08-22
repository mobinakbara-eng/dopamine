import assert from "node:assert/strict";
import {decimalComma,entryMinutes,monthRange,stableStringify} from "../supabase/functions/aora-v8-datev-hours-export/core.ts";

assert.deepEqual(monthRange("2028-02"),{from:"2028-02-01",to:"2028-02-29",datev:"01/02/2028"});
assert.equal(entryMinutes({start:"22:00",end:"06:00",breakMinutes:30}),450,"overnight shifts must roll into the next day");
assert.equal(entryMinutes({startTime:"2026-10-25T01:30:00+02:00",endTime:"2026-10-25T02:30:00+01:00",durationMinutes:120,breakMinutes:0}),120,"canonical stored duration must win across the DST fallback hour");
assert.equal(entryMinutes({startTime:"2026-03-29T01:30:00+01:00",endTime:"2026-03-29T03:30:00+02:00",duration_minutes:60}),60,"canonical stored duration must win across the DST spring gap");
assert.equal(decimalComma(7.5),"7,50");
assert.equal(stableStringify({b:2,a:{d:4,c:3}}),'{"a":{"c":3,"d":4},"b":2}',"snapshot checksums must be key-order independent");

console.log("DATEV hours behavior: ok");
