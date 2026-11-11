// Read-only backend schema extraction. Run with --check in validation; no backend
// code or runtime dependency is imported into the frontend bundle.
import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('../../backend/src/modules/accounting/', import.meta.url);
const coa = await readFile(new URL('coa/coa.schema.ts', base), 'utf8');
const approval = await readFile(new URL('approval/approval.schema.ts', base), 'utf8');
const permissions = await readFile(new URL('approval/approval.repository.ts', base), 'utf8');
function values(source, expression) {
  const match = source.match(expression);
  if (!match) throw new Error('Accounting contract source changed; review extraction.');
  return [...match[1].matchAll(/"([A-Z_]+)"/g)].map(item => item[1]);
}
const enums = {
  accountTypes: values(coa, /const accountType = z.enum\(\[([^\]]+)\]/),
  normalBalances: values(coa, /normalBalance: z.enum\(\[([^\]]+)\]/),
  draftJournalTypes: values(approval, /journalType: z.enum\(\[([^\]]+)\]/),
  approvalStatuses: values(approval, /const approvalStatusSchema = z.enum\(\[([^\]]+)\]/)
};
const grants = Object.fromEntries(['MANAGE', 'APPROVE', 'POST'].map(key => {
  const value = permissions.match(new RegExp('const ACCOUNTING_' + key + ' = "([A-Z_]+)"'))?.[1];
  if (!value) throw new Error('Missing permission contract');
  return [key.toLowerCase(), value];
}));
const output = '// Generated from backend coa/approval schemas by scripts/sync-accounting-contract.mjs.\n'
  + Object.entries(enums).map(([name, options]) => `export const ${name} = ${JSON.stringify(options)} as const;\n`).join('')
  + `export const journalPermissions = ${JSON.stringify(grants)} as const;\n`;
const target = new URL('../src/features/accounting/core/contracts.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== output) throw new Error('Accounting contract snapshot is stale.');
  console.log('Accounting enum/permission source parity PASS');
} else { await writeFile(target, output); console.log('Generated Accounting schema choices and permissions'); }
