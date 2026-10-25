// Append-only experiment log. One JSON object per line, each stamped with a run id,
// a monotonic sequence number and wall-clock time, so a run can be replayed or audited.
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createLogger(dir) {
  mkdirSync(dir, { recursive: true });
  // Pointer for the live dashboard.
  writeFileSync(resolve(dirname(dir), 'LATEST'), dir.split(/[\\/]/).pop());
  const runId = dir.split(/[\\/]/).pop();
  const events = createWriteStream(resolve(dir, 'events.jsonl'), { flags: 'a' });
  let seq = 0;
  const write = (obj) => events.write(`${JSON.stringify({ runId, seq: seq++, ts: new Date().toISOString(), ...obj })}\n`);
  return {
    dir,
    event: (e) => write(e),
    op: (o) => write({ type: 'op', ...o }),
    trial: (t) => write({ type: 'trial', ...t }),
    manifest: (m) => writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(m, null, 2)),
    close: () => new Promise((r) => events.end(r)),
  };
}
