// docs/report-source/<doc>.md → docs/<name>.docx (Word), from the same source as the PDF,
// so the two versions can never drift apart. Simple single-column layout in Calibri.
//   node experiments/harness/build-docx.mjs                         REPORT.md → docs/research-report.docx
//   node experiments/harness/build-docx.mjs --doc literature-review  → docs/literature-review.docx
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { REPORT_SRC, ROOT } from './paths.mjs';

const doc = process.argv.includes('--doc') ? process.argv[process.argv.indexOf('--doc') + 1] : 'REPORT';
const srcPath = resolve(REPORT_SRC, `${doc}.md`);
const outPath = resolve(ROOT, 'docs', doc === 'REPORT' ? 'research-report.docx' : `${doc}.docx`);
const md = readFileSync(srcPath, 'utf8');

const FONT = 'Calibri';
const BODY = 21; // half-points → 10.5 pt, as in the PDF
const SMALL = 19; // 9.5 pt (tables)
const CAPTION = 20; // 10 pt
// A4 with the same margins as the PDF (19 / 22 / 14.3 mm) → text width in twips (1 mm = 56.7 twips).
const PAGE = { width: 11906, height: 16838, margin: { top: 1077, bottom: 1247, left: 811, right: 811 } };
const TEXT_W = PAGE.width - PAGE.margin.left - PAGE.margin.right;
const TEXT_W_PX = Math.round((TEXT_W / 1440) * 96);

// ---- inline HTML / markdown → runs ---------------------------------------------------------
const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Tiny HTML-ish inline parser for <b>, <i>, <em>, <strong>, <sub>, <sup>, <span>, <br>. */
function htmlRuns(html, base = {}) {
  const runs = [];
  const st = { ...base };
  const parts = html.split(/(<\/?[a-zA-Z]+[^>]*>)/g);
  for (const p of parts) {
    if (!p) continue;
    const tag = /^<(\/?)([a-zA-Z]+)/.exec(p);
    if (tag) {
      const on = tag[1] !== '/';
      const t = tag[2].toLowerCase();
      if (t === 'b' || t === 'strong') st.bold = on || base.bold;
      else if (t === 'i' || t === 'em') st.italics = on || base.italics;
      else if (t === 'sub') st.subScript = on;
      else if (t === 'sup') st.superScript = on;
      else if (t === 'br' && on) runs.push(new TextRun({ break: 1, font: FONT, size: st.size }));
      continue;
    }
    const text = decode(p);
    if (text) runs.push(new TextRun({ text, font: FONT, size: st.size ?? BODY, ...pick(st) }));
  }
  return runs;
}
const pick = (s) => ({ bold: s.bold, italics: s.italics, subScript: s.subScript, superScript: s.superScript });

/** marked inline tokens → runs (bold/italic/code/inline HTML). */
function inlineRuns(tokens, st = {}) {
  const out = [];
  const state = { ...st };
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inlineRuns(t.tokens, { ...state, bold: true }));
        break;
      case 'em':
        out.push(...inlineRuns(t.tokens, { ...state, italics: true }));
        break;
      case 'codespan':
        out.push(new TextRun({ text: decode(t.text), font: 'Consolas', size: (state.size ?? BODY) - 2, ...pick(state) }));
        break;
      case 'html': {
        const tag = /^<(\/?)([a-zA-Z]+)/.exec(t.text);
        if (tag) {
          const on = tag[1] !== '/';
          const n = tag[2].toLowerCase();
          if (n === 'sub') state.subScript = on;
          else if (n === 'sup') state.superScript = on;
          else if (n === 'b' || n === 'strong') state.bold = on;
          else if (n === 'i' || n === 'em') state.italics = on;
          else if (n === 'br') out.push(new TextRun({ break: 1 }));
        } else out.push(...htmlRuns(t.text, state));
        break;
      }
      case 'link':
        out.push(...inlineRuns(t.tokens, state));
        break;
      case 'br':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'text':
      case 'escape':
        if (t.tokens?.length) out.push(...inlineRuns(t.tokens, state));
        else out.push(new TextRun({ text: decode(t.text), font: FONT, size: state.size ?? BODY, ...pick(state) }));
        break;
      default:
        if (t.text) out.push(new TextRun({ text: decode(t.text), font: FONT, size: state.size ?? BODY, ...pick(state) }));
    }
  }
  return out;
}

// ---- blocks ----------------------------------------------------------------------------------
const para = (children, opts = {}) =>
  new Paragraph({ children, spacing: { after: 90, line: 252 }, alignment: AlignmentType.JUSTIFIED, ...opts });

function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function figure(html) {
  const src = /src="([^"]+)"/.exec(html)[1];
  const cap = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(html)?.[1] ?? '';
  const file = resolve(dirname(srcPath), src);
  const { w, h } = pngSize(file);
  // Same relative widths as the PDF: charts at half the text width, the dashboard at 78%.
  const width = Math.round(TEXT_W_PX * (src.includes('dashboard') ? 0.78 : 0.5));
  const height = Math.round((width * h) / w);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 40 },
      children: [new ImageRun({ type: 'png', data: readFileSync(file), transformation: { width, height }, altText: { title: 'Figure', description: cap.replace(/<[^>]+>/g, ''), name: src } })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: htmlRuns(cap, { size: CAPTION }) }),
  ];
}

function tableCaption(html) {
  const label = /<div class="tcap">([^<]+)<br>/.exec(html)?.[1]?.trim() ?? '';
  const title = /<span>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '';
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: `${label}: `, bold: true, font: FONT, size: CAPTION }), ...htmlRuns(title, { size: CAPTION })],
  });
}

function table(t) {
  const cols = t.header.length;
  // Column widths proportional to the longest text in each column (bounded).
  const len = (c) => Math.max(...[t.header[c], ...t.rows.map((r) => r[c])].map((x) => x.text.length));
  const weights = Array.from({ length: cols }, (_, c) => Math.min(48, Math.max(5, len(c))));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((x) => Math.floor((x / sum) * TEXT_W));
  widths[widths.length - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (c, i, header) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      shading: header ? { type: ShadingType.CLEAR, fill: 'EEEEEE', color: 'auto' } : undefined,
      margins: { top: 30, bottom: 30, left: 80, right: 80 },
      children: [new Paragraph({ spacing: { after: 0, line: 240 }, children: inlineRuns(c.tokens, { size: SMALL, bold: header || undefined }) })],
    });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

// ---- walk the document ---------------------------------------------------------------------
const children = [];
let inRefs = false;
for (const tok of marked.lexer(md)) {
  if (tok.type === 'space') continue;
  if (tok.type === 'html') {
    const h = tok.text;
    if (h.includes('class="title-block"')) {
      const title = /<h1>([\s\S]*?)<\/h1>/.exec(h)[1];
      children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: htmlRuns(title, { size: 36, bold: true }) }));
    } else if (h.includes('class="abstract"') || h.includes('class="keywords"')) {
      const inner = /<p[^>]*>([\s\S]*?)<\/p>/.exec(h)[1];
      children.push(para(htmlRuns(inner), { spacing: { after: 140, line: 264 } }));
    } else if (h.includes('class="tcap"')) {
      children.push(tableCaption(h));
    } else if (h.includes('<figure')) {
      children.push(...figure(h));
    } else if (h.includes('class="eq"')) {
      const inner = /<div class="eq">([\s\S]*?)<\/div>/.exec(h)[1];
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 }, children: htmlRuns(inner, { italics: true }) }));
    } else if (h.includes('class="refs"')) {
      inRefs = true;
    }
    continue; // layout wrappers (columns, closing divs)
  }
  if (tok.type === 'heading') {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 240, after: 100 }, children: inlineRuns(tok.tokens, { size: 26, bold: true }) }));
    continue;
  }
  if (tok.type === 'table') {
    children.push(table(tok), new Paragraph({ spacing: { after: 80 }, children: [] }));
    continue;
  }
  if (tok.type === 'list') {
    tok.items.forEach((it, i) =>
      children.push(para([new TextRun({ text: tok.ordered ? `${(tok.start || 1) + i}. ` : '• ', font: FONT, size: BODY }), ...inlineRuns(it.tokens[0]?.tokens ?? it.tokens)], { indent: { left: 360, hanging: 360 } })),
    );
    continue;
  }
  if (tok.type === 'paragraph') {
    if (inRefs && /^\[\d+\]/.test(tok.text)) {
      children.push(new Paragraph({ spacing: { after: 40, line: 240 }, indent: { left: 480, hanging: 480 }, children: inlineRuns(tok.tokens, { size: 20 }) }));
    } else {
      children.push(para(inlineRuns(tok.tokens)));
    }
  }
}

const document = new Document({
  creator: 'CineBook',
  title: /<h1>([\s\S]*?)<\/h1>/.exec(md)?.[1] ?? 'Report',
  styles: {
    default: { document: { run: { font: FONT, size: BODY } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 36, bold: true, color: '000000' }, paragraph: { alignment: AlignmentType.CENTER } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 0 } },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })] })] }),
      },
      children,
    },
  ],
});

writeFileSync(outPath, await Packer.toBuffer(document));
console.log(`${outPath.split(/[\\/]/).pop()} written (${children.length} blocks)`);
