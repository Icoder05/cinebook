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

// References: number in a fixed-width gutter, text aligned beside it.
const refs = (h) =>
  h.replace(/<p>\[(\d+)\] ([\s\S]*?)<\/p>/g, '<p class="ref"><span class="rn">[$1]</span><span class="rt">$2</span></p>');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>CineBook concurrency report</title>
<style>
  /* Simple single-column report: Calibri 11 pt, numbered sections, captions below
     figures and above tables. --fig-w tunes figure size (keeps the page count). */
  @page { size: A4; }
  html { -webkit-print-color-adjust: exact; }
  body { margin: 0; font: 10.5pt/1.25 Calibri, Carlito, 'Segoe UI', Arial, sans-serif; color: #000; }
  .title-block { text-align: center; margin: 0 0 16pt; }
  .title-block h1 { font-size: 18pt; font-weight: bold; line-height: 1.25; margin: 0 0 10pt; }
  .authors { display: flex; justify-content: center; font-size: 11pt; line-height: 1.35; }
  .author .name { font-weight: bold; }
  .columns { text-align: justify; }
  p { margin: 0 0 5pt; }
  p.abstract, p.keywords { margin: 0 0 8pt; }
  h2 { font-size: 13pt; font-weight: bold; margin: 11pt 0 5pt; break-after: avoid; }
  em { font-style: italic; }
  .eq { text-align: center; margin: 6pt 0 8pt; font-style: italic; }
  .tcap { text-align: center; font-size: 10pt; font-weight: bold; margin: 10pt 0 4pt; break-after: avoid; }
  .tcap span { font-weight: normal; }
  .tcap br { display: none; }
  .tcap span::before { content: ': '; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; line-height: 1.15; margin: 0 0 10pt; break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 1.5pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; }
  figure { margin: 6pt 0 8pt; break-inside: avoid; }
  figure img { display: block; width: var(--fig-w, 50%); margin: 0 auto; }
  figure:has(img[src*=dashboard]) img { width: 78%; }
  figcaption { font-size: 10pt; text-align: center; margin-top: 4pt; }
  .refs p.ref { display: flex; margin: 0 0 4pt; font-size: 10pt; line-height: 1.3; text-align: left; }
  .refs p.ref .rn { flex: 0 0 2.4em; }
  .refs p.ref .rt { flex: 1; }
</style></head><body>${refs(marked.parse(md))}</body></html>`;

const htmlPath = resolve(dir, 'report.html');
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(dir, 'report.pdf'), format: 'A4', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-family:Calibri,sans-serif;font-size:9pt;width:100%;text-align:center;color:#000"><span class="pageNumber"></span></div>',
  // IEEE A4: top 19 mm, side 14.3 mm; bottom leaves room for the page number.
  margin: { top: '19mm', bottom: '22mm', left: '14.3mm', right: '14.3mm' },
});
const pdf = readFileSync(resolve(dir, 'report.pdf'));
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`report.pdf written (${pages} pages)`);
await browser.close();
