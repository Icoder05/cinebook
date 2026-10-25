// Live experiment dashboard: tails research/results/<LATEST>/events.jsonl and streams
// new lines to the browser over Server-Sent Events.
//   node research/dashboard/server.mjs      → http://localhost:4600
import { createServer } from 'node:http';
import { existsSync, openSync, readFileSync, readSync, statSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const results = resolve(here, '../results');
const PORT = Number(process.env.PORT ?? 4600);

function latestFile() {
  const p = resolve(results, 'LATEST');
  if (!existsSync(p)) return null;
  const run = readFileSync(p, 'utf8').trim();
  const f = resolve(results, run, 'events.jsonl');
  return existsSync(f) ? f : null;
}

createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let file = null;
    let pos = 0;
    let carry = '';
    const tick = () => {
      const f = latestFile();
      if (f !== file) {
        file = f;
        pos = 0;
        carry = '';
        res.write(`event: reset\ndata: {}\n\n`);
      }
      if (!file) return;
      const size = statSync(file).size;
      if (size <= pos) return;
      const fd = openSync(file, 'r');
      const buf = Buffer.alloc(size - pos);
      readSync(fd, buf, 0, buf.length, pos);
      closeSync(fd);
      pos = size;
      const text = carry + buf.toString('utf8');
      const lines = text.split('\n');
      carry = lines.pop() ?? '';
      // Batch to keep the browser responsive.
      for (let i = 0; i < lines.length; i += 500) {
        res.write(`data: ${JSON.stringify(lines.slice(i, i + 500).filter(Boolean))}\n\n`);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    req.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(resolve(here, 'index.html')));
}).listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
