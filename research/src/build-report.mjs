// REPORT.md → report.html → report.pdf (A4) with embedded figures.
//   node research/src/build-report.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../report');
const md = readFileSync(resolve(dir, 'REPORT.md'), 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>CineBook concurrency report</title>
<style>
  @page { size: A4; margin: 18mm 17mm 18mm 17mm; }
  body { font: 10.2pt/1.4 "Times New Roman", Georgia, serif; color: #111; }
  h1 { font-size: 17pt; margin: 0 0 4pt; line-height: 1.2; }
  h2 { font-size: 13pt; margin: 14pt 0 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 11pt; margin: 10pt 0 3pt; }
  p, li { text-align: justify; }
  table { border-collapse: collapse; width: 100%; font-size: 8.8pt; margin: 6pt 0; page-break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 2.5pt 4pt; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; }
  img { display: block; width: 84%; margin: 4pt auto 0; page-break-inside: avoid; }
  code { font: 8.8pt Consolas, monospace; background: #f4f4f4; padding: 0 2pt; }
  pre { font: 8.5pt Consolas, monospace; background: #f6f6f6; padding: 6pt; white-space: pre-wrap; }
  blockquote { margin: 6pt 0; padding: 4pt 10pt; border-left: 3px solid #999; background: #fafafa; }
  .meta { color: #444; font-size: 9.5pt; margin-bottom: 8pt; }
  em.caption { display:block; font-size: 9pt; color: #333; margin: 0 0 8pt; }
</style></head><body>${marked.parse(md)}</body></html>`;

const htmlPath = resolve(dir, 'report.html');
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(dir, 'report.pdf'), format: 'A4', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8pt;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '18mm', bottom: '18mm', left: '17mm', right: '17mm' },
});
const pdf = readFileSync(resolve(dir, 'report.pdf'));
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`report.pdf written (${pages} pages)`);
await browser.close();
