import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const fail = (message) => { console.error(`FAIL: ${message}`); process.exitCode = 1; };
const ok = (message) => console.log(`OK: ${message}`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const mustExist = (relative) => {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) fail(`missing required file: ${relative}`);
  return file;
};

const plugin = readJson(mustExist('plugin.json'));
const allowedPluginKeys = new Set(['$schema','name','version','description','author','homepage','repository','license','keywords','extensions']);
if (plugin.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') fail('plugin.json schema must target Agent Plugins 1.0.0');
if (!/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(plugin.name || '') || /--|\.\./.test(plugin.name)) fail('plugin name is invalid');
for (const key of Object.keys(plugin)) if (!allowedPluginKeys.has(key)) fail(`plugin.json contains non-portable top-level key: ${key}`);
ok('portable plugin manifest shape');

const mcp = readJson(mustExist('mcp.json'));
if (mcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json') fail('mcp.json schema mismatch');
if (!mcp.mcpServers || typeof mcp.mcpServers !== 'object') fail('mcpServers must be an object');
for (const [name, server] of Object.entries(mcp.mcpServers || {})) {
  if (!['stdio','streamable-http','sse'].includes(server.type)) fail(`unsupported MCP type for ${name}`);
  if ((server.type === 'streamable-http' || server.type === 'sse') && !/^https:\/\//.test(server.url || '')) fail(`remote MCP ${name} must use https`);
  const serialized = JSON.stringify(server);
  if (/Bearer\s|api[_-]?key|token['\"]?\s*:/i.test(serialized)) fail(`possible credential embedded in MCP ${name}`);
}
ok('portable MCP configuration shape');

const codexManifest = readJson(mustExist('.codex-plugin/plugin.json'));
if (codexManifest.name !== 'aora-engineering') fail('Codex manifest name must be aora-engineering');
if (codexManifest.version !== plugin.version) fail('Codex manifest version must match portable plugin version');
if (codexManifest.skills !== './skills/') fail('Codex manifest skills path must be ./skills/');
if (codexManifest.mcpServers !== './.mcp.json') fail('Codex manifest mcpServers path must be ./.mcp.json');
if (!codexManifest.interface?.displayName) fail('Codex manifest requires interface.displayName');
ok('OpenAI Codex plugin manifest shape');

const codexMcp = readJson(mustExist('.mcp.json'));
const codexServers = codexMcp.mcp_servers || codexMcp;
if (!codexServers.vercel || codexServers.vercel.url !== 'https://mcp.vercel.com') fail('bundled Vercel MCP URL mismatch');
if (codexServers.vercel.default_tools_approval_mode !== 'prompt') fail('Vercel MCP must default to prompt approval');
ok('OpenAI bundled MCP configuration');

const marketplace = readJson(mustExist('.agents/plugins/marketplace.json'));
const listing = (marketplace.plugins || []).find((entry) => entry.name === 'aora-engineering');
if (!listing) fail('repo marketplace must list aora-engineering');
if (listing?.source?.source !== 'local' || listing?.source?.path !== './') fail('repo marketplace must point to plugin root with local ./ source');
if (listing?.policy?.installation !== 'AVAILABLE') fail('repo marketplace installation policy must be AVAILABLE');
if (!listing?.policy?.authentication) fail('repo marketplace requires authentication policy');
ok('repo marketplace metadata');

const skillsDir = path.join(root, 'skills');
const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const seen = new Set();
for (const dir of dirs) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dir)) fail(`invalid skill directory name: ${dir}`);
  const file = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(file)) { fail(`missing SKILL.md in ${dir}`); continue; }
  const body = fs.readFileSync(file, 'utf8');
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) { fail(`missing YAML frontmatter in ${dir}`); continue; }
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== dir) fail(`skill name '${name}' must match directory '${dir}'`);
  if (!description) fail(`skill ${dir} needs a description`);
  if (seen.has(name)) fail(`duplicate skill name: ${name}`);
  seen.add(name);
}

const required = [
  'aora-orchestrator','aora-project-context','aora-research-gate','aora-change-planner','aora-bug-hunter',
  'aora-supabase-backend','aora-database-migration','aora-tenancy-rbac','aora-inventory','aora-kiosk-offline',
  'aora-security','aora-performance-accessibility','aora-testing-release','aora-github-release','aora-incident-response'
];
for (const name of required) if (!seen.has(name)) fail(`required skill missing: ${name}`);
if (!process.exitCode) ok(`${dirs.length} skills validated with portable + OpenAI plugin compatibility`);
