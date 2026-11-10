// Builds docs/research-report.docx from docs/report-source/REPORT.md.
//   node experiments/harness/build-report-word.mjs
// Uses Word's own styles (Title, Heading 1-2, Caption) so the document behaves like one written
// in Word: the navigation pane, table of contents and captions all work. Figure and table numbers
// are SEQ fields inside bookmarks, and every "Figure N" / "Table N" in the text is a REF field
// pointing at its caption, i.e. a real Word cross-reference. Citations are left as ⟦cite:…⟧
// placeholders that experiments/analysis/finalize_word.py turns into Word citations
// (References tab → Insert Citation) with an IEEE bibliography, then exports the PDF.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const {
  AlignmentType, BorderStyle, Bookmark, Document, Footer, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, SimpleField, Table, TableCell, TableRow, TextRun, WidthType,
} = require('docx');

const SRC = resolve(ROOT, 'docs/report-source/REPORT.md');
const OUT = process.env.REPORT_DOCX ? resolve(process.env.REPORT_DOCX) : resolve(ROOT, 'docs/research-report.docx');
const FONT = 'Calibri';
const PAGE = { width: 11906, height: 16838, margin: 1440 }; // A4, 2.54 cm margins (Word default)
const TEXT_W = PAGE.width - 2 * PAGE.margin; // twips
const TEXT_W_PX = Math.round((TEXT_W / 1440) * 96);

const lines = readFileSync(SRC, 'utf8').replace(/\r/g, '').split('\n');

// ---- numbering pre-pass: figures and tables in order of appearance ------------------------
const numbers = {};
let nFig = 0;
let nTab = 0;
for (const l of lines) {
  let m = /^!\[fig:([\w-]+)/.exec(l);
  if (m) numbers[`fig:${m[1]}`] = ++nFig;
  m = /^Table: tab:([\w-]+)/.exec(l);
  if (m) numbers[`tab:${m[1]}`] = ++nTab;
}
const refLabel = (key) => `${key.startsWith('fig') ? 'Figure' : 'Table'} ${numbers[key]}`;

// ---- inline text: **bold**, *italic*, [@cite], {fig:x}/{tab:x} cross-references ----------
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[@[^\]]+\]|\{(?:fig|tab):[\w-]+\})/g;
  let last = 0;
  let m;
  const plain = (t, extra = {}) => t && out.push(new TextRun({ text: t, font: FONT, ...base, ...extra }));
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) plain(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('*')) plain(tok.slice(1, -1), { italics: true });
    else if (tok.startsWith('[@')) {
      const keys = tok.slice(1, -1).split(';').map((k) => k.trim().replace(/^@/, ''));
      plain(` ⟦cite:${keys.join(',')}⟧`);
    } else {
      const key = tok.slice(1, -1);
      if (!numbers[key]) throw new Error(`unknown cross-reference ${key}`);
      out.push(new SimpleField(`REF ${key.replace(':', '_')} \\h`, refLabel(key)));
    }
    last = m.index + tok.length;
  }
  plain(text.slice(last));
  return out;
}

const body = (children, opts = {}) =>
  new Paragraph({ children, alignment: AlignmentType.JUSTIFIED, spacing: { after: 140, line: 276 }, ...opts });

function caption(key, text, keepNext = false) {
  const [kind] = key.split(':');
  const label = kind === 'fig' ? 'Figure' : 'Table';
  return new Paragraph({
    style: 'Caption',
    alignment: AlignmentType.CENTER,
    keepNext,
    spacing: { before: kind === 'fig' ? 60 : 200, after: kind === 'fig' ? 220 : 80 },
    children: [
      new Bookmark({ id: key.replace(':', '_'), children: [new TextRun({ text: `${label} `, font: FONT }), new SimpleField(`SEQ ${label} \\* ARABIC`, String(numbers[key]))] }),
      new TextRun({ text: `: ${text}`, font: FONT }),
    ],
  });
}

function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}

function figure(key, width, path, text) {
  const img = pngSize(resolve(dirname(SRC), path));
  const w = Math.round(TEXT_W_PX * width);
  const h = Math.round((w * img.h) / img.w);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 0 }, children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: w, height: h } })] }),
    caption(key, text),
  ];
}

function table(rows) {
  const cells = rows.map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const header = cells[0];
  const data = cells.slice(2);
  // Column widths in proportion to the longest text in each column (with a floor).
  const weights = header.map((_, i) => Math.max(6, ...cells.filter((_, k) => k !== 1).map((r) => Math.min(48, (r[i] ?? '').length))));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((x) => Math.floor((x / sum) * TEXT_W));
  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mk = (txt, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    borders,
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'D9E2F3' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ spacing: { after: 0, line: 240 }, children: runs(txt, { size: 18, bold: head }) })],
  });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: header.map((t, i) => mk(t, i, true)) }),
      ...data.map((r) => new TableRow({ cantSplit: true, children: header.map((_, i) => mk(r[i] ?? '', i, false)) })),
    ],
  });
}

// ---- block parser ------------------------------------------------------------------------
const children = [];
let title = '';
let listInstance = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.trim()) continue;
  if (l.startsWith('% ')) {
    title = l.slice(2).trim();
    children.push(new Paragraph({ style: 'Title', alignment: AlignmentType.CENTER, spacing: { before: 2600, after: 480 }, children: [new TextRun({ text: title, font: 'Calibri Light' })] }));
  } else if (l.startsWith('::: cover')) {
    // Cover page: the lines under the title, centred, then a new page.
    const buf = [];
    while (!lines[++i].startsWith(':::')) buf.push(lines[i].trim());
    buf.forEach((t, k) => children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: k === 0 ? 240 : 0, after: k === 0 ? 480 : 160 },
      children: [new TextRun({ text: t, font: FONT, size: k === 0 ? 32 : 24, bold: k === 0, color: k === 0 ? '1F3864' : '404040' })],
    })));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  } else if (l.startsWith('::: abstract')) {
    const buf = [];
    while (!lines[++i].startsWith(':::')) buf.push(lines[i]);
    children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Abstract', bold: true, font: FONT, size: 28 })] }));
    children.push(body(runs(buf.join(' '))));
  } else if (l.startsWith('Keywords:')) {
    children.push(body([new TextRun({ text: 'Keywords: ', bold: true, font: FONT }), ...runs(l.slice(9).trim(), { italics: true })], { spacing: { after: 360 } }));
  } else if (l === '[[TOC]]' || l === '[[LOF]]' || l === '[[LOT]]') {
    // Contents, list of figures and list of tables each start on a new page; Word fills them in.
    const [label, mark] = { '[[TOC]]': ['Contents', 'toc'], '[[LOF]]': ['List of Figures', 'lof'], '[[LOT]]': ['List of Tables', 'lot'] }[l];
    children.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 160 }, children: [new TextRun({ text: label, bold: true, font: FONT, size: 28 })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `⟦${mark}⟧`, font: FONT })] }));
  } else if (l === '[[PAGEBREAK]]') {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  } else if (l === '[[BIBLIOGRAPHY]]') {
    children.push(new Paragraph({ children: [new TextRun({ text: '⟦bibliography⟧', font: FONT })] }));
  } else if (l.startsWith('# ')) {
    const text = l.slice(2).trim();
    // Every chapter, the references and each appendix start on a new page, as in a printed report.
    const newPage = true;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: newPage, children: [new TextRun({ text })] }));
  } else if (l.startsWith('## ')) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: l.slice(3).trim() })] }));
  } else if (l.startsWith('![')) {
    const m = /^!\[(fig:[\w-]+)\|([\d.]+)\]\(([^)]+)\)\s*(.*)$/.exec(l);
    children.push(...figure(m[1], Number(m[2]), m[3], m[4]));
  } else if (l.startsWith('Table: ')) {
    const m = /^Table: (tab:[\w-]+)\s+(.*)$/.exec(l);
    children.push(caption(m[1], m[2], true));
    const rows = [];
    while (lines[i + 1]?.startsWith('|')) rows.push(lines[++i]);
    children.push(table(rows));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  } else if (l.startsWith('$$')) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 160 }, children: [new TextRun({ text: l.replace(/\$\$/g, '').trim(), italics: true, font: 'Cambria Math' })] }));
  } else if (/^- /.test(l) || /^\d+\. /.test(l)) {
    const numbered = /^\d+\. /.test(l);
    listInstance++;
    i--;
    while (lines[i + 1] && (numbered ? /^\d+\. /.test(lines[i + 1]) : /^- /.test(lines[i + 1]))) {
      const item = lines[++i].replace(/^(- |\d+\. )/, '');
      children.push(new Paragraph({
        numbering: { reference: numbered ? 'numbers' : 'bullets', level: 0, instance: numbered ? listInstance : undefined },
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80, line: 276 },
        children: runs(item),
      }));
    }
    children[children.length - 1] = children[children.length - 1]; // keep last item spacing simple
  } else {
    const buf = [l];
    while (lines[i + 1] && lines[i + 1].trim() && !/^(#|!\[|Table: |\$\$|- |\d+\. |\[\[|\||:::)/.test(lines[i + 1])) buf.push(lines[++i]);
    children.push(body(runs(buf.join(' '))));
  }
}

const doc = new Document({
  creator: 'Kishan Phani Chitakana',
  title,
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', size: 44, color: '1F3864' }, paragraph: { spacing: { after: 360 } } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', size: 32, color: '2F5496' }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', size: 26, color: '2F5496' }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
      { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 19, italics: true, color: '1F3864' } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })] })] }) },
    children,
  }],
});

writeFileSync(OUT, await Packer.toBuffer(doc));
console.log(`research-report.docx written (${nFig} figures, ${nTab} tables, ${children.length} blocks)`);
