const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: npm run risk -- <changed-path> [changed-path...]');
  process.exit(2);
}

const rules = [
  { level: 5, re: /(drop|truncate|delete-production|service[_-]?role|prod.*migration)/i, why: 'destructive or production-sensitive operation' },
  { level: 4, re: /(supabase\/migrations|rls|auth|session|invite|policy|permission|edge.*function|vercel\.json)/i, why: 'authorization, persistence or production boundary' },
  { level: 3, re: /(supabase|database|schema|realtime|service-worker|offline|kiosk|worktime)/i, why: 'stateful or cross-client workflow' },
  { level: 2, re: /(app\/|modules\/|\.js$|\.css$|\.html$|tests\/)/i, why: 'application behavior change' },
  { level: 1, re: /(docs|readme|skill|agent-plugin|\.md$)/i, why: 'documentation/tooling-only change' }
];

let highest = { level: 0, why: 'read/research only', path: null };
for (const file of paths) {
  for (const rule of rules) {
    if (rule.re.test(file) && rule.level > highest.level) highest = { level: rule.level, why: rule.why, path: file };
  }
}

const gates = {
  0: ['source evidence'],
  1: ['targeted validation'],
  2: ['branch', 'targeted tests', 'build/check', 'preview for UI behavior'],
  3: ['R2 gates', 'staging', 'cross-role/reconnect/idempotency checks', 'rollback plan'],
  4: ['R3 gates', 'security/tenancy review', 'explicit release gate', 'production verification plan'],
  5: ['R4 gates', 'explicit human approval', 'backup/recovery evidence', 'no irreversible execution without approval']
};
console.log(JSON.stringify({ risk: `R${highest.level}`, reason: highest.why, matchedPath: highest.path, requiredGates: gates[highest.level] }, null, 2));
