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

structural = structural.replace(
    'const locationIds = [...new Set((input.locationIds || []).map(String))];',
    'const locationIds: string[] = [...new Set<string>((input.locationIds || []).map((value: any) => String(value)))];',
)
structural = structural.replace(
    'const locationIds = [...new Set((event.locationIds || []).map(String))];',
    'const locationIds: string[] = [...new Set<string>((event.locationIds || []).map((value: any) => String(value)))];',
)
structural_path.write_text(structural)

core_path = root / "supabase/functions/aora-v8-final-workspace/core.ts"
core = core_path.read_text()
core = core.replace('const url = new URL(origin);', 'const url = new globalThis.URL(origin);')
old_signature = '''export async function sendInvite(
  origin: string | null,
  invitation: any,
  accessRole: "manager" | "employee",
) {'''
new_signature = '''export async function sendInvite(
  origin: string | null,
  invitation: any,
  accessRole: "manager" | "employee",
  workspaceSlug: string,
) {'''
if old_signature in core:
    core = core.replace(old_signature, new_signature, 1)
elif new_signature not in core:
    raise SystemExit("sendInvite signature not found")
core = core.replace('redirectUrl.searchParams.set("workspace", ctx.organization.slug);', 'redirectUrl.searchParams.set("workspace", workspaceSlug);')
core_path.write_text(core)

legacy_structural_path = root / "supabase/functions/aora-v8-final-workspace/structural.ts"
legacy_structural = legacy_structural_path.read_text()
legacy_structural = legacy_structural.replace(
    'emailResult = await sendInvite(origin, invitation, inviteRole);',
    'emailResult = await sendInvite(origin, invitation, inviteRole, ctx.organization.slug);',
)
legacy_structural_path.write_text(legacy_structural)

test_path = root / "tests/team-news-atomic-persistence-source.mjs"
test_path.write_text('''import assert from "node:assert/strict";
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
