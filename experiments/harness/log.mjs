// Append-only experiment log. One JSON object per line, each stamped with a run id,
// a monotonic sequence number and wall-clock time, so a run can be replayed or audited.
//   events   → data/raw/<run>/events.jsonl        (the dataset)
//   manifest → experiments/logs/<run>/manifest.json (environment + configuration)
import { createWriteStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensure, LOGS, RAW } from './paths.mjs';

export function createLogger(runId) {
  const rawDir = ensure(resolve(RAW, runId));
  const logDir = ensure(resolve(LOGS, runId));
  writeFileSync(resolve(LOGS, 'LATEST'), runId); // pointer for the live dashboard
  const events = createWriteStream(resolve(rawDir, 'events.jsonl'), { flags: 'a' });
  let seq = 0;
  const write = (obj) => events.write(`${JSON.stringify({ runId, seq: seq++, ts: new Date().toISOString(), ...obj })}\n`);
  return {
    runId,
    event: (e) => write(e),
    op: (o) => write({ type: 'op', ...o }),
    trial: (t) => write({ type: 'trial', ...t }),
    manifest: (m) => writeFileSync(resolve(logDir, 'manifest.json'), JSON.stringify(m, null, 2)),
    close: () => new Promise((r) => events.end(r)),
  };
}
