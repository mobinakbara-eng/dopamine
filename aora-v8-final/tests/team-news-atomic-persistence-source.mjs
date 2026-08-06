import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync(new URL("../supabase/functions/aora-v8-final-workspace/index.ts",import.meta.url),"utf8");
const structural=fs.readFileSync(new URL("../supabase/functions/aora-v8-final-workspace/structural-custom.ts",import.meta.url),"utf8");
const core=fs.readFileSync(new URL("../supabase/functions/aora-v8-final-workspace/core.ts",import.meta.url),"utf8");

for(const fragment of [
  '"ADD_ANNOUNCEMENT",',
  'case "ADD_ANNOUNCEMENT": {',
  'const audience = String(input.audience || "").trim();',
  'if (audience !== "all") requireLocation(state, audience);',
  'audience === "all" || !allowedLocations(ctx).has(audience)',
  'state.announcements = [announcement, ...(state.announcements || [])];',
  '"announcement.created"',
]) assert.ok(structural.includes(fragment),`missing Team News persistence contract: ${fragment}`);

assert.ok(index.includes('if (STRUCTURAL_TYPES.has(body.event?.type))'),"structural routing must precede legacy forwarding");
assert.ok(index.indexOf('if (STRUCTURAL_TYPES.has(body.event?.type))') < index.indexOf('const securedEvent = guardLegacyEvent'),"Team News structural route must avoid legacy proxy recursion");
assert.ok(core.includes('const url = new globalThis.URL(origin);'),"origin parser must not be shadowed by SUPABASE URL constant");
assert.ok(core.includes('workspaceSlug: string,'),"invite redirect must receive an explicit workspace slug");
assert.equal((structural.match(/case "ADD_ANNOUNCEMENT": \{/g)||[]).length,1,"ADD_ANNOUNCEMENT handler must be unique");
console.log("Team News atomic persistence source contracts passed");
