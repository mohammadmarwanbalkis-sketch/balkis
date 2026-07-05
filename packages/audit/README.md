# @balkis/audit

Audit persistence for [Balkis](../../README.md) executions.

```ts
import { AuditedEngine, InMemoryAuditStore, JsonlFileAuditSink } from "@balkis/audit";

const store = new InMemoryAuditStore();
const audited = new AuditedEngine(engine, [store, new JsonlFileAuditSink("./audit.jsonl")]);

await audited.run(netSalary, inputs); // recorded whether it succeeds or fails
store.byTarget("payroll.net-salary"); // query recorded runs
store.failures();                      // failed runs carry the structured error
```

- **Every run is recorded** — successes with the full `ExecutionReport`, failures with the structured `BalkisError` JSON. Records are JSON-serializable end to end.
- **Sink failures are loud by default.** Auditing was requested, so a lost record throws; pass `onSinkError` explicitly if you prefer degraded operation.
- **Sinks are pluggable** — implement `AuditSink.record(record)` for databases, queues, or encrypted stores. This package ships the two everything starts with: in-memory (tests, dashboards) and JSONL append files.
