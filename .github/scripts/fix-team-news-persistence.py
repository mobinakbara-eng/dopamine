from pathlib import Path
import json

root = Path("aora-v8-final")
structural_path = root / "supabase/functions/aora-v8-final-workspace/structural-custom.ts"
structural = structural_path.read_text()

set_marker = '  "CREATE_KIOSK_DEVICE",\n'
set_replacement = '  "ADD_ANNOUNCEMENT",\n  "CREATE_KIOSK_DEVICE",\n'
if set_replacement not in structural:
    if set_marker not in structural:
        raise SystemExit("STRUCTURAL_TYPES insertion point not found")
    structural = structural.replace(set_marker, set_replacement, 1)

case_marker = '    case "CREATE_KIOSK_DEVICE": {\n'
case_block = '''    case "ADD_ANNOUNCEMENT": {
      const input = event.announcement || {};
      const title = String(input.title || "").trim();
      const body = String(input.body || "").trim();
      const audience = String(input.audience || "").trim();
      if (!title || title.length > 160 || !body || body.length > 5000) {
        throw Object.assign(
          new Error("Titel und Text sind erforderlich und dürfen nicht zu lang sein."),
          { status: 400 },
        );
      }
      if (audience !== "all") requireLocation(state, audience);
      if (ctx.accessRole === "manager") {
        if (audience === "all" || !allowedLocations(ctx).has(audience)) {
          throw Object.assign(
            new Error("Manager dürfen Mitteilungen nur an ihre zugewiesenen Standorte senden."),
            { status: 403 },
          );
        }
      }
      const announcement = {
        id: id("announcement"),
        title,
        body,
        audience,
        createdAt: now(),
        createdBy: ctx.admin.id,
      };
      state.announcements = [announcement, ...(state.announcements || [])];
      addAudit(
        state,
        ctx,
        "announcement.created",
        "announcement",
        announcement.id,
        title,
        audience === "all" ? null : { locationId: audience },
      );
      break;
    }

'''
if case_block not in structural:
    if case_marker not in structural:
        raise SystemExit("ADD_ANNOUNCEMENT case insertion point not found")
    structural = structural.replace(case_marker, case_block + case_marker, 1)

structural_path.write_text(structural)

test_path = root / "tests/team-news-atomic-persistence-source.mjs"
test_path.write_text('''import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync(new URL("../supabase/functions/aora-v8-final-workspace/index.ts",import.meta.url),"utf8");
const structural=fs.readFileSync(new URL("../supabase/functions/aora-v8-final-workspace/structural-custom.ts",import.meta.url),"utf8");

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
assert.equal((structural.match(/case "ADD_ANNOUNCEMENT": \{/g)||[]).length,1,"ADD_ANNOUNCEMENT handler must be unique");
console.log("Team News atomic persistence source contracts passed");
''')

package_path = root / "package.json"
package = json.loads(package_path.read_text())
check = package["scripts"]["check"]
command = "node tests/team-news-atomic-persistence-source.mjs"
if command not in check:
    marker = "node tests/team-news-location-guard-source.mjs"
    if marker not in check:
        raise SystemExit("package check insertion point not found")
    check = check.replace(marker, marker + " && " + command, 1)
    package["scripts"]["check"] = check
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")
