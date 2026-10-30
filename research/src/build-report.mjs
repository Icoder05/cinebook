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

// IEEE references: number in a fixed-width gutter, text aligned beside it.
const refs = (h) =>
  h.replace(/<p>\[(\d+)\] ([\s\S]*?)<\/p>/g, '<p class="ref"><span class="rn">[$1]</span><span class="rt">$2</span></p>');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>CineBook concurrency report</title>
<style>
  /* IEEE conference layout (A4): two columns, 10 pt Times, small-caps Roman-numeral
     section heads, "TABLE I" captions above tables, "Fig. 1." captions below figures. */
  @page { size: A4; }
  html { -webkit-print-color-adjust: exact; }
  body { margin: 0; font: 10pt/1.18 "Times New Roman", Times, serif; color: #000; hyphens: auto; }
  .title-block { text-align: center; margin: 0 0 14pt; }
  .title-block h1 { font-size: 22pt; font-weight: normal; line-height: 1.12; margin: 0 0 12pt; }
  .authors { display: flex; justify-content: center; font-size: 10pt; line-height: 1.25; }
  .author .name { font-size: 11pt; }
  .columns { column-count: 2; column-gap: 4.2mm; text-align: justify; }
  p { margin: 0; text-indent: 1em; }
  p.abstract, p.keywords { font-size: 9pt; line-height: 1.2; text-indent: 1em; margin-bottom: 6pt; }
  p.keywords { margin-bottom: 4pt; }
  p.abstract b, p.keywords b { font-weight: bold; }
  h2 { font-size: 10pt; font-weight: normal; font-variant: small-caps; text-align: center; letter-spacing: 0.02em; margin: 9pt 0 4pt; break-after: avoid; }
  p:has(> em:first-child) { text-indent: 1em; }
  em { font-style: italic; }
  .eq { text-align: center; margin: 4pt 0; text-indent: 0; font-style: italic; }
  .tcap { text-align: center; font-size: 8pt; margin: 8pt 0 3pt; text-indent: 0; break-after: avoid; letter-spacing: 0.04em; }
  .tcap span { font-variant: small-caps; letter-spacing: 0.02em; }
  table { border-collapse: collapse; width: 100%; font-size: 7.6pt; line-height: 1.15; margin: 0 0 8pt; break-inside: avoid; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  th { border-bottom: 0.6px solid #000; font-weight: normal; font-variant: small-caps; padding: 2pt 3pt; text-align: left; }
  td { padding: 1.6pt 3pt; text-align: left; vertical-align: top; }
  figure { margin: 7pt 0 8pt; break-inside: avoid; text-indent: 0; }
  figure img { display: block; width: var(--fig-w, 100%); margin: 0 auto; }
  figure.wide { column-span: all; margin: 8pt 0 10pt; }
  figure.wide img { width: var(--wide-w, 88%); }
  figure.wide figcaption { width: var(--wide-w, 88%); margin: 3pt auto 0; }
  .wide-table { column-span: all; width: 82%; margin: 0 auto; break-inside: avoid; }
  .wide-table table { font-size: 7.8pt; }
  .refs p.ref { display: flex; gap: 0; text-indent: 0; padding-left: 0; }
  .refs p.ref .rn { flex: 0 0 2.4em; }
  .refs p.ref .rt { flex: 1; }
  figcaption { font-size: 8pt; line-height: 1.2; text-align: justify; margin-top: 3pt; }
  .refs p { font-size: 8pt; line-height: 1.2; text-indent: -1.9em; padding-left: 1.9em; margin-bottom: 2.5pt; text-align: left; }
</style></head><body>${refs(marked.parse(md))}</body></html>`;

const htmlPath = resolve(dir, 'report.html');
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(dir, 'report.pdf'), format: 'A4', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-family:Times New Roman,serif;font-size:8pt;width:100%;text-align:center;color:#000"><span class="pageNumber"></span></div>',
  // IEEE A4: top 19 mm, side 14.3 mm; bottom leaves room for the page number.
  margin: { top: '19mm', bottom: '22mm', left: '14.3mm', right: '14.3mm' },
});
const pdf = readFileSync(resolve(dir, 'report.pdf'));
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`report.pdf written (${pages} pages)`);
await browser.close();
