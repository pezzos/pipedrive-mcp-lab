import { readAuditNdjson, queryAudit } from "./lib/audit-operations.mjs";
const args = process.argv.slice(2); const path = args.find((value) => !value.startsWith("--")) ?? "-"; const filters = {};
for (let index = 0; index < args.length; index += 1) { const key = args[index]; const name = { "--request": "requestId", "--event": "eventId", "--actor": "actorId", "--tenant": "tenantId", "--operation": "operation", "--outcome": "outcome", "--from": "from", "--to": "to" }[key]; if (name) filters[name] = args[index + 1]; }
const parsed = await readAuditNdjson(path); console.log(JSON.stringify({ ...parsed, records: queryAudit(parsed.records, filters) }));
