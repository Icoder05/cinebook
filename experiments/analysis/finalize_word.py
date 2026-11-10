"""Finish docs/research-report.docx in Microsoft Word and export the PDF.

    .venv/Scripts/python experiments/analysis/finalize_word.py

Run after experiments/harness/build-report-word.mjs. Word itself:
  1. stores every reference from docs/report-source/references.json as a Word source
     (References tab -> Manage Sources) and sets the IEEE citation style;
  2. replaces each placeholder with a Word citation field (References tab -> Insert Citation);
  3. inserts the bibliography and the table of contents;
  4. updates all fields (figure and table numbers, cross-references, citations);
  5. saves the .docx and exports docs/research-report.pdf from the same document,
     so the PDF and the Word file are identical.
"""
import json
import time
from pathlib import Path
from xml.sax.saxutils import escape

import pythoncom
import win32com.client as wc
from win32com.client import gencache

ROOT = Path(__file__).resolve().parents[2]
import os
DOCX = Path(os.environ['REPORT_DOCX']) if os.environ.get('REPORT_DOCX') else ROOT / 'docs' / 'research-report.docx'
PDF = Path(os.environ['REPORT_PDF']) if os.environ.get('REPORT_PDF') else ROOT / 'docs' / 'research-report.pdf'
REFS = json.loads((ROOT / 'docs' / 'report-source' / 'references.json').read_text(encoding='utf8'))
NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography'


def people(tag, names):
    persons = ''.join(f'<b:Person><b:Last>{escape(last)}</b:Last><b:First>{escape(first)}</b:First></b:Person>' for last, first in names)
    return f'<b:{tag}><b:NameList>{persons}</b:NameList></b:{tag}>'


def source_xml(r):
    authors = ''
    if 'authors' in r:
        authors += people('Author', r['authors'])
    if 'corporate' in r:
        authors += f'<b:Author><b:Corporate>{escape(r["corporate"])}</b:Corporate></b:Author>'
    if 'editors' in r:
        authors += people('Editor', r['editors'])
    fields = {
        'title': 'Title', 'journal': 'JournalName', 'volume': 'Volume', 'issue': 'Issue', 'pages': 'Pages', 'year': 'Year',
        'month': 'Month', 'day': 'Day', 'conference': 'ConferenceName', 'city': 'City', 'publisher': 'Publisher',
        'bookTitle': 'BookTitle', 'site': 'InternetSiteTitle', 'url': 'URL', 'yearAccessed': 'YearAccessed',
        'monthAccessed': 'MonthAccessed', 'dayAccessed': 'DayAccessed', 'standardNumber': 'StandardNumber',
    }
    body = ''.join(f'<b:{tag}>{escape(r[k])}</b:{tag}>' for k, tag in fields.items() if k in r)
    return (f'<b:Source xmlns:b="{NS}"><b:Tag>{r["tag"]}</b:Tag><b:SourceType>{r["type"]}</b:SourceType>'
            f'<b:Author>{authors}</b:Author>{body}</b:Source>')


def retry(fn, seconds=180):
    """Word rejects calls while it is busy (e.g. repaginating); wait and try again."""
    deadline = time.time() + seconds
    while True:
        try:
            return fn()
        except pythoncom.com_error as e:
            if e.hresult in (-2147418111, -2147417846) and time.time() < deadline:
                time.sleep(0.5)
                continue
            raise


def find(doc, text):
    rng = retry(lambda: doc.Content)
    f = retry(lambda: rng.Find)
    retry(f.ClearFormatting)
    if retry(lambda: f.Execute(FindText=text, MatchWildcards=True, Forward=True, Wrap=0)):
        return rng
    return None


def replace_with_field(doc, rng, code):
    retry(lambda: setattr(rng, 'Text', ''))
    retry(lambda: doc.Fields.Add(rng, -1, code, False))


# A Word lock file means another Word process still has the report open; Word would then wait
# forever on an invisible "file in use" prompt, so stop with a clear message instead.
lock = DOCX.with_name('~$' + DOCX.name[2:])
if lock.exists():
    raise SystemExit(f'{DOCX.name} is open in another Word process ({lock.name} exists). Close Word and run again.')

word = gencache.EnsureDispatch(wc.DispatchEx('Word.Application'))
retry(lambda: setattr(word, 'Visible', False))
retry(lambda: setattr(word, 'DisplayAlerts', 0))
doc = None
try:
    print('opening', DOCX.name, flush=True)
    doc = retry(lambda: word.Documents.Open(str(DOCX), ConfirmConversions=False, ReadOnly=False, AddToRecentFiles=False, Visible=False))
    bib = retry(lambda: doc.Bibliography)
    for r in REFS:
        retry(lambda r=r: bib.Sources.Add(source_xml(r)))
    retry(lambda: setattr(bib, 'BibliographyStyle', 'IEEE'))
    print(f'{len(REFS)} sources added', flush=True)

    # Citations: each ⟦cite:a,b⟧ becomes one CITATION field (several sources joined with \m).
    cited = 0
    while cited < 200:
        rng = find(doc, '⟦cite:*⟧')
        if rng is None:
            break
        keys = retry(lambda: rng.Text).strip('⟦⟧').split(':', 1)[1].split(',')
        replace_with_field(doc, rng, f'CITATION {keys[0]} \l 1033' + ''.join(f' \m {k}' for k in keys[1:]))
        cited += 1
    print(f'{cited} citations inserted', flush=True)

    rng = find(doc, '⟦toc⟧')
    retry(lambda: setattr(rng, 'Text', ''))
    retry(lambda: doc.TablesOfContents.Add(rng, True, 1, 2))
    replace_with_field(doc, find(doc, '⟦bibliography⟧'), 'BIBLIOGRAPHY')
    for mark, label in (('⟦lof⟧', 'Figure'), ('⟦lot⟧', 'Table')):
        rng = find(doc, mark)
        if rng is not None:
            retry(lambda rng=rng: setattr(rng, 'Text', ''))
            retry(lambda rng=rng, label=label: doc.TablesOfFigures.Add(rng, Caption=label, IncludeLabel=True))

    print('updating fields', flush=True)
    for _ in range(2):  # second pass settles page numbers after the bibliography grows
        retry(lambda: doc.Fields.Update())
        retry(lambda: doc.TablesOfContents(1).Update())
        for k in range(1, retry(lambda: doc.TablesOfFigures.Count) + 1):
            retry(lambda k=k: doc.TablesOfFigures(k).Update())

    if find(doc, '⟦*⟧') is not None:
        raise SystemExit('unresolved placeholder left in the document')
    pages = retry(lambda: doc.ComputeStatistics(2))
    retry(lambda: doc.SaveAs2(str(DOCX), 16))  # .docx
    retry(lambda: doc.ExportAsFixedFormat(str(PDF), 17, False, 0, 0, 0, 0, 0, True, True, 1))  # PDF with heading bookmarks
    print(f'{cited} citations, {len(REFS)} sources, {pages} pages -> {DOCX.name}, {PDF}', flush=True)
finally:
    # Always release Word, even after an error, so no hidden Word process keeps the file locked.
    if doc is not None:
        try:
            retry(lambda: doc.Close(False), 60)
        except Exception:
            pass
    retry(lambda: word.Quit(), 120)
