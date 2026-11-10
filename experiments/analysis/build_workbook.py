"""Build the analysis workbook (experiments/results/cinebook-analysis.xlsx) and export its charts.

    .venv/Scripts/python experiments/analysis/build_workbook.py [--no-export]

Every summary value in the workbook is a live Excel formula over the raw measurements on the same
sheet, so each number in the report can be traced by clicking on it. Charts are native Excel charts;
with Excel installed they are exported to figures/report/*.png for the report.
"""
import csv
import json
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference, Series
from openpyxl.chart.data_source import NumDataSource, NumRef
from openpyxl.chart.error_bar import ErrorBars
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as col

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data' / 'raw'
PROC = ROOT / 'data' / 'processed'
OUT = ROOT / 'experiments' / 'results' / 'cinebook-analysis.xlsx'
FIG = ROOT / 'figures' / 'report'

BOLD = Font(name='Calibri', bold=True)
HEAD_FILL = PatternFill('solid', fgColor='D9E1F2')
CALC_FILL = PatternFill('solid', fgColor='FFF2CC')
THIN = Side(style='thin', color='999999')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def events(run):
    with open(RAW / run / 'events.jsonl', encoding='utf8') as f:
        return [json.loads(line) for line in f if line.strip()]


def header(ws, row, colnum, values, fill=HEAD_FILL):
    for i, v in enumerate(values):
        c = ws.cell(row=row, column=colnum + i, value=v)
        c.font = BOLD
        c.fill = fill
        c.border = BOX
        c.alignment = Alignment(wrap_text=True, vertical='center')


# Functions added in Excel 2010+ must be stored with the _xlfn. prefix (Excel hides it on screen).
NEW_FUNCS = re.compile(r'(?<![._A-Z])(STDEV\.S|T\.INV\.2T|PERCENTILE\.INC|RANK\.AVG|CHISQ\.DIST\.RT|NORM\.S\.DIST)\(')


def put(ws, row, colnum, values, fmt=None, fill=None):
    for i, v in enumerate(values):
        if isinstance(v, str) and v.startswith('='):
            v = NEW_FUNCS.sub(lambda m: f'_xlfn.{m.group(1)}(', v)
        c = ws.cell(row=row, column=colnum + i, value=v)
        c.border = BOX
        if fmt and not (isinstance(v, str) and not v.startswith('=')):
            c.number_format = fmt
        if fill and isinstance(v, str) and v.startswith('='):
            c.fill = fill


def widths(ws, w):
    for i, x in enumerate(w, start=1):
        ws.column_dimensions[col(i)].width = x


def note(ws, cell, text):
    ws[cell] = text
    ws[cell].font = Font(name='Calibri', italic=True, color='555555')


def style_chart(ch, w=16, h=8.5):
    ch.width, ch.height = w, h
    ch.legend.position = 'b'
    for ax in (ch.x_axis, ch.y_axis):
        ax.delete = False
    return ch


def custom_err(ref):
    src = NumDataSource(numRef=NumRef(f=ref))
    return ErrorBars(errDir='y', errBarType='both', errValType='cust', noEndCap=False, plus=src, minus=src)


wb = Workbook()

# ---------------------------------------------------------------------------------------
# README
# ---------------------------------------------------------------------------------------
ws = wb.active
ws.title = 'README'
rows = [
    ['CineBook benchmarking study: analysis workbook'],
    [''],
    ['How to read this workbook'],
    ['Raw measurements are on the left of each sheet; yellow cells are formulas you can click to see how each number is computed.'],
    ['Charts on each sheet are the figures used in the report (exported as images).'],
    [''],
    ['Sheet', 'Contents', 'Report section'],
    ['1_PageLoads', '25 cold page loads (5 per page): LCP, FCP, TTFB, bytes, requests; mean, SD, 95% CI', 'Responsiveness / Figs. 4-5'],
    ['2_Accessibility', 'axe-core WCAG 2.2 A/AA violations per page, before and after fixes', 'Usability / Fig. 9'],
    ['3_API_Latency', '117 warm samples per API endpoint; percentiles, share under 200 ms; distribution', 'Responsiveness / Figs. 6-7'],
    ['4_Funnel', '10 automated booking runs (5 desktop, 5 mobile): screens, clicks, keystrokes, time', 'Booking efficiency'],
    ['5_KLM', 'Keystroke-Level Model estimate of expert booking time, by stage (formulas)', 'Booking efficiency / Fig. 8'],
    ['6_Keyboard', 'Keyboard-only booking across three iterations', 'Usability / Fig. 10'],
    ['7_DB_Queries', '30 timed runs per database query variant on 1 million seat rows', 'Responsiveness / Fig. 11'],
    ['8_Stats_Tests', 'Kruskal-Wallis and Mann-Whitney tests built from ranks (formulas)', 'Statistical analysis'],
    ['9_Supplementary', 'Payment failure tests and security checks', 'Appendix C'],
    ['10_Concurrency', 'Same-seat test (lab) and live seat race; double bookings per trial', 'Section 5.4'],
    ['11_LoadTest', '13,860 requests from 10-500 simulated clients; percentiles and throughput', 'Section 5.5'],
    [''],
    ['Formulas used'],
    ['Mean', '=AVERAGE(range)'],
    ['Standard deviation (sample)', '=STDEV.S(range)'],
    ['95% confidence interval of a mean', 'mean ± T.INV.2T(0.05, n-1) * SD / SQRT(n)'],
    ['Median, 95th percentile', '=MEDIAN(range), =PERCENTILE.INC(range, 0.95)'],
    ['Ranks for non-parametric tests', '=RANK.AVG(value, all values, 1)'],
    ['Kruskal-Wallis p-value', '=CHISQ.DIST.RT(H, k-1)'],
    ['Mann-Whitney p-value (normal approximation)', '=2*(1-NORM.S.DIST(z, TRUE))'],
]
for r, vals in enumerate(rows, start=1):
    for c, v in enumerate(vals, start=1):
        cell = ws.cell(row=r, column=c, value=v)
        cell.data_type = 's'  # formula examples are shown as text, not evaluated
ws['A1'].font = Font(name='Calibri', bold=True, size=14)
for r in (3, 7, 18):
    for c in range(1, 4):
        ws.cell(row=r, column=c).font = BOLD
widths(ws, [42, 90, 30])

# ---------------------------------------------------------------------------------------
# 1. Page loads (E6)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('1_PageLoads')
loads = [e for e in events('main-web') if e['type'] == 'op' and e.get('exp') == 'E6']
pages = []
for e in loads:
    key = (e['site'], e['page'])
    if key not in pages:
        pages.append(key)
ws['A1'] = 'Raw page loads (Chromium, cold cache, desktop 1366x860, 5 loads per page, 4 s apart; 30 Oct 2026)'
ws['A1'].font = BOLD
cols = ['Platform', 'Page', 'Load', 'TTFB (ms)', 'FCP (ms)', 'LCP (ms)', 'Load event (ms)', 'Transfer (KB)', 'JS (KB)', 'Images (KB)', 'Requests', '3rd-party hosts']
header(ws, 2, 1, cols)
r = 3
block = {}
for key in pages:
    rows_ = [e for e in loads if (e['site'], e['page']) == key]
    block[key] = (r, r + len(rows_) - 1)
    for i, e in enumerate(rows_, start=1):
        put(ws, r, 1, [e['site'], e['page'], i, round(e['ttfbMs'], 1), round(e['fcpMs'], 1), round(e['lcpMs'], 1), round(e['loadMs'], 1),
                       e['transferKB'], e['jsKB'], e['imageKB'], e['requests'], e['thirdPartyHosts']], '0.0')
        r += 1
raw_end = r - 1

s0 = raw_end + 3
ws.cell(row=s0 - 1, column=1, value='Summary per page (formulas)').font = BOLD
scols = ['Page', 'n', 'LCP mean', 'LCP SD', 't (95%)', 'CI half-width', 'CI low', 'CI high', 'FCP mean', 'TTFB mean',
         'Transfer mean (KB)', 'JavaScript (KB)', 'Images (KB)', 'Other (KB)', 'Requests mean', '3rd-party hosts']
header(ws, s0, 1, scols)
for i, key in enumerate(pages):
    a, b = block[key]
    rr = s0 + 1 + i
    rng = lambda c: f'{c}{a}:{c}{b}'
    put(ws, rr, 1, [f'{key[0]} {key[1]}', f'=COUNT({rng("F")})', f'=AVERAGE({rng("F")})', f'=STDEV.S({rng("F")})',
                    f'=T.INV.2T(0.05,B{rr}-1)', f'=E{rr}*D{rr}/SQRT(B{rr})', f'=C{rr}-F{rr}', f'=C{rr}+F{rr}',
                    f'=AVERAGE({rng("E")})', f'=AVERAGE({rng("D")})', f'=AVERAGE({rng("H")})', f'=AVERAGE({rng("I")})',
                    f'=AVERAGE({rng("J")})', f'=K{rr}-L{rr}-M{rr}', f'=AVERAGE({rng("K")})', f'=AVERAGE({rng("L")})'], '0.0', CALC_FILL)
s_end = s0 + len(pages)
widths(ws, [24, 18, 8, 10, 10, 10, 13, 13, 10, 11, 12, 12, 13, 11, 13, 13])
note(ws, f'A{s_end + 2}', 'LCP = Largest Contentful Paint (time until the main content is drawn). Google rates LCP under 2.5 s as good.')
note(ws, f'A{s_end + 3}', 'CI = mean ± t × SD / √n with t = T.INV.2T(0.05, n−1) = 2.776 for n = 5.')

ch = style_chart(BarChart())
ch.type = 'col'
ch.y_axis.title = 'LCP (ms), mean ± SD'
ch.y_axis.majorGridlines = None
data = Reference(ws, min_col=3, min_row=s0, max_row=s_end)
ch.add_data(data, titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=s0 + 1, max_row=s_end))
ch.series[0].errBars = custom_err(f"'1_PageLoads'!$D${s0 + 1}:$D${s_end}")
ch.legend = None
ch.y_axis.scaling.min = 0
ws.add_chart(ch, f'R{s0}')

ch2 = style_chart(BarChart())
ch2.type = 'col'
ch2.grouping = 'stacked'
ch2.overlap = 100
ch2.y_axis.title = 'Transferred (KB)'
for c_ in (12, 13, 14):
    ch2.add_data(Reference(ws, min_col=c_, min_row=s0, max_row=s_end), titles_from_data=True)
ch2.set_categories(Reference(ws, min_col=1, min_row=s0 + 1, max_row=s_end))
ws.add_chart(ch2, f'R{s0 + 19}')

# ---------------------------------------------------------------------------------------
# 2. Accessibility (E6)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('2_Accessibility')
pre = [e for e in events('main-web') if e['type'] == 'trial' and e.get('exp') == 'E6-a11y']
post = [e for e in events('main-web-postfix') if e['type'] == 'trial' and e.get('exp') == 'E6-a11y']
ws['A1'] = 'axe-core WCAG 2.2 A/AA audit: elements violating a rule, by impact'
ws['A1'].font = BOLD
header(ws, 2, 1, ['Phase', 'Platform', 'Page', 'Rules violated', 'Critical', 'Serious', 'Moderate', 'Minor', 'Total elements', 'Rules (elements)'])
r = 3
for phase, rows_ in (('before fixes', pre), ('after fixes', post)):
    for e in rows_:
        put(ws, r, 1, [phase, e['site'], e['page'], e['violationRules'], e['critical'], e['serious'], e['moderate'], e['minor'], f'=SUM(E{r}:H{r})', e['rules']], '0', CALC_FILL)
        r += 1
last = r - 1
s0 = last + 3
ws.cell(row=s0 - 1, column=1, value='Totals by platform (formulas)').font = BOLD
header(ws, s0, 1, ['Group', 'Critical', 'Serious', 'Moderate', 'Minor', 'Total'])
groups = [('CineBook (before)', 'before fixes', 'CineBook'), ('CineBook (after)', 'after fixes', 'CineBook'),
          ('BookMyShow home', 'before fixes', 'BookMyShow'), ('District movies', 'before fixes', 'District')]
for i, (label, phase, site) in enumerate(groups):
    rr = s0 + 1 + i
    f = lambda c: f'=SUMIFS({c}$3:{c}${last},$A$3:$A${last},"{phase}",$B$3:$B${last},"{site}")'
    put(ws, rr, 1, [label, f('E'), f('F'), f('G'), f('H'), f'=SUM(B{rr}:E{rr})'], '0', CALC_FILL)
s_end = s0 + len(groups)
widths(ws, [18, 14, 14, 13, 9, 9, 10, 8, 14, 70])
ch = style_chart(BarChart())
ch.type = 'col'
ch.grouping = 'stacked'
ch.overlap = 100
ch.y_axis.title = 'Elements violating a rule'
for c_ in (2, 3, 4, 5):
    ch.add_data(Reference(ws, min_col=c_, min_row=s0, max_row=s_end), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=s0 + 1, max_row=s_end))
ws.add_chart(ch, f'H{s0}')

# ---------------------------------------------------------------------------------------
# 3. API latency (E4a)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('3_API_Latency')
samples = {}
with open(PROC / 'e4a_live_samples.csv', encoding='utf8') as f:
    for row in csv.DictReader(f):
        if row['first'] == 'false':
            samples.setdefault(row['endpoint'], []).append(float(row['latency_ms']))
eps = ['health', 'movies', 'showtimes', 'seats', 'static']
labels = {'health': 'Health check', 'movies': 'Movie list', 'showtimes': 'Showtimes', 'seats': 'Seat map', 'static': 'Static file (CDN baseline)'}
ws['A1'] = 'Warm end-to-end response times (ms) from the client, 3 rounds x 39 samples per endpoint, 25 Oct 2026'
ws['A1'].font = BOLD
header(ws, 2, 1, [labels[e] for e in eps])
n_max = max(len(v) for v in samples.values())
for i in range(n_max):
    put(ws, 3 + i, 1, [round(samples[e][i], 1) if i < len(samples[e]) else None for e in eps], '0.0')
last = 2 + n_max
s0 = 2
sc = 8
header(ws, s0, sc, ['Endpoint', 'n', 'Mean', 'SD', 'Median (p50)', 'p95', 'p99', 'Min', 'Max', 'Share < 200 ms', '200 ms target'])
for i, e in enumerate(eps):
    rr = s0 + 1 + i
    c_ = col(i + 1)
    rng = f'{c_}3:{c_}{last}'
    put(ws, rr, sc, [labels[e], f'=COUNT({rng})', f'=AVERAGE({rng})', f'=STDEV.S({rng})', f'=MEDIAN({rng})', f'=PERCENTILE.INC({rng},0.95)',
                     f'=PERCENTILE.INC({rng},0.99)', f'=MIN({rng})', f'=MAX({rng})', f'=COUNTIF({rng},"<200")/COUNT({rng})', 200], '0.0', CALC_FILL)
    ws.cell(row=rr, column=sc + 9).number_format = '0.0%'
api_end = s0 + 4  # four API endpoints, CDN baseline excluded from the chart
widths(ws, [13, 12, 12, 12, 16, 3, 3, 24, 6, 9, 9, 12, 9, 9, 8, 9, 13, 12])
note(ws, 'H10', 'p95 = value below which 95% of responses fall (PERCENTILE.INC). Target from the product requirements: p95 < 200 ms.')

ch = style_chart(BarChart())
ch.type = 'col'
ch.y_axis.title = 'Response time (ms)'
for c_ in (sc + 4, sc + 5):
    ch.add_data(Reference(ws, min_col=c_, min_row=s0, max_row=api_end), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=sc, min_row=s0 + 1, max_row=api_end))
target = LineChart()
target.add_data(Reference(ws, min_col=sc + 10, min_row=s0, max_row=api_end), titles_from_data=True)
target.series[0].graphicalProperties.line.dashStyle = 'dash'
target.series[0].graphicalProperties.line.solidFill = 'C00000'
ch.y_axis.scaling.min = 0
ch += target
ws.add_chart(ch, 'H12')

# Distribution of the seat-map response time (histogram with FREQUENCY-style COUNTIFS).
h0 = 31
ws.cell(row=h0 - 1, column=sc, value='Distribution of seat-map response times (formulas)').font = BOLD
header(ws, h0, sc, ['Bin (ms)', 'Responses'])
bins = list(range(80, 260, 20))
for i, lo in enumerate(bins):
    rr = h0 + 1 + i
    label = f'{lo}–{lo + 19}'
    put(ws, rr, sc, [label, f'=COUNTIFS(D$3:D${last},">={lo}",D$3:D${last},"<{lo + 20}")'], '0', CALC_FILL)
rr = h0 + 1 + len(bins)
put(ws, rr, sc, ['≥ 260', f'=COUNTIF(D$3:D${last},">=260")'], '0', CALC_FILL)
hist_end = rr
ch = style_chart(BarChart(), 16, 7.5)
ch.type = 'col'
ch.gapWidth = 10
ch.y_axis.title = 'Number of responses'
ch.x_axis.title = 'Seat-map response time (ms)'
ch.add_data(Reference(ws, min_col=sc + 1, min_row=h0, max_row=hist_end), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=sc, min_row=h0 + 1, max_row=hist_end))
ch.legend = None
ws.add_chart(ch, f'K{h0}')

# ---------------------------------------------------------------------------------------
# 4. Booking funnel (E7)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('4_Funnel')
runs = [e for e in events('main-ux') if e['type'] == 'trial' and e.get('exp') == 'E7' and not e.get('error')]
ws['A1'] = 'Automated booking runs on the live site, sign-in to confirmed ticket (5 desktop, 5 mobile Pixel 7 profile)'
ws['A1'].font = BOLD
cols = ['Device', 'Run', 'Screens logged', 'Dialogs', 'Clicks/taps', 'Keystrokes', 'Form fields', 'System time (s)',
        'Sign-in (s)', 'Discovery (s)', 'Showtime (s)', 'Seats (s)', 'Checkout (s)', 'Fees shown before payment']
header(ws, 2, 1, cols)
r = 3
dev_rows = {}
for e in runs:
    dev_rows.setdefault(e['device'], []).append(r)
    put(ws, r, 1, [e['device'], e['trial'] + 1, e['screens'], e['dialogs'], e['clicks'], e['keystrokes'], e['formFields'], e['robotSec'],
                   e['stageSignIn'], e['stageDiscovery'], e['stageShowtime'], e['stageSeats'], e['stageCheckout'], 'yes' if e['feeBreakdownBeforePay'] else 'no'], '0.00')
    r += 1
s0 = r + 2
ws.cell(row=s0 - 1, column=1, value='Summary by device (formulas)').font = BOLD
header(ws, s0, 1, ['Device', 'n', 'Clicks', 'Keystrokes', 'System time mean (s)', 'SD', 't (95%)', 'CI low', 'CI high'])
for i, (dev, rs) in enumerate(dev_rows.items()):
    a, b = min(rs), max(rs)
    rr = s0 + 1 + i
    put(ws, rr, 1, [dev, f'=COUNT(H{a}:H{b})', f'=AVERAGE(E{a}:E{b})', f'=AVERAGE(F{a}:F{b})', f'=AVERAGE(H{a}:H{b})', f'=STDEV.S(H{a}:H{b})',
                    f'=T.INV.2T(0.05,B{rr}-1)', f'=E{rr}-G{rr}*F{rr}/SQRT(B{rr})', f'=E{rr}+G{rr}*F{rr}/SQRT(B{rr})'], '0.00', CALC_FILL)
widths(ws, [10, 6, 14, 8, 11, 11, 11, 15, 11, 13, 12, 10, 12, 14])
note(ws, f'A{s0 + 4}', 'System time is how long the website took when driven by a script (no human thinking time); it includes a 1.5 s simulated bank delay.')
note(ws, f'A{s0 + 5}', 'The booking route has 8 screens (sign-in, home, film, showtimes, seat map, summary, payment, ticket); the film page was sometimes passed too quickly to be logged.')

# ---------------------------------------------------------------------------------------
# 5. KLM estimate
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('5_KLM')
ws['A1'] = 'Keystroke-Level Model (Card, Moran & Newell, 1980): estimated time for an experienced user'
ws['A1'].font = BOLD
header(ws, 3, 1, ['Operator', 'Meaning', 'Seconds'])
ops = [('K', 'press a key (average typist)', 0.28), ('P', 'point with the mouse', 1.10), ('B', 'press or release mouse button', 0.10),
       ('H', 'move hand between keyboard and mouse', 0.40), ('M', 'mentally prepare', 1.35)]
for i, (o, m, s) in enumerate(ops):
    put(ws, 4 + i, 1, [o, m, s], '0.00')
note(ws, 'A10', 'A click = M + P + B + B. A text field adds H (to keyboard) + H (back to mouse) + one K per character typed.')
header(ws, 12, 1, ['Stage', 'Clicks', 'Text fields', 'Characters typed', 'Time per click (s)', 'Estimated time (s)', 'Share of total'])
stages = [('Sign in (e-mail, password, button)', 3, 2, 43), ('Choose city', 1, 0, 0), ('Choose film', 1, 0, 0),
          ('Choose theatre and showtime', 2, 0, 0), ('Choose 2 seats and continue', 4, 0, 0), ('Checkout and card payment', 6, 4, 34)]
for i, (st, c_, fld, k) in enumerate(stages):
    rr = 13 + i
    put(ws, rr, 1, [st, c_, fld, k, '=$C$8+$C$5+2*$C$6', f'=B{rr}*E{rr}+C{rr}*2*$C$7+D{rr}*$C$4', f'=F{rr}/$F$19'], '0.00', CALC_FILL)
    ws.cell(row=rr, column=7).number_format = '0.0%'
put(ws, 19, 1, ['Total', '=SUM(B13:B18)', '=SUM(C13:C18)', '=SUM(D13:D18)', '', '=SUM(F13:F18)', '=SUM(G13:G18)'], '0.00', CALC_FILL)
ws.cell(row=19, column=7).number_format = '0.0%'
for c_ in range(1, 8):
    ws.cell(row=19, column=c_).font = BOLD
widths(ws, [36, 40, 12, 16, 18, 18, 14])
note(ws, 'A21', 'The 43 sign-in characters are the 32-character test e-mail plus an 11-character password; card details are 16 + 11 + 4 + 3 characters.')
ch = style_chart(BarChart(), 16, 7.5)
ch.type = 'bar'
ch.x_axis.title = None
ch.y_axis.title = 'Estimated time (s)'
ch.add_data(Reference(ws, min_col=6, min_row=12, max_row=18), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=13, max_row=18))
ch.x_axis.scaling.orientation = 'maxMin'
ch.legend = None
ws.add_chart(ch, 'I3')

# ---------------------------------------------------------------------------------------
# 6. Keyboard-only iterations
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('6_Keyboard')
ws['A1'] = 'Keyboard-only booking (Tab, Enter, arrows, typing) across three versions of CineBook'
ws['A1'].font = BOLD
header(ws, 2, 1, ['Iteration', 'Run', 'Completed', 'Tab presses', 'Where it stopped'])
r = 3
it_rows = {}
for label, run in (('1. Original', 'main-ux-prefix'), ('2. Toast trap fixed', 'main-ux-midfix'), ('3. All fixes', 'main-ux')):
    for e in [x for x in events(run) if x['type'] == 'trial' and x.get('exp') == 'E7-keyboard']:
        it_rows.setdefault(label, []).append(r)
        where = (e.get('failedAt') or '—').split(' (stuck')[0]
        put(ws, r, 1, [label, e['trial'] + 1, 'yes' if e['completed'] else 'no', e['tabs'], where if not e['completed'] else 'completed'], '0')
        r += 1
s0 = r + 2
ws.cell(row=s0 - 1, column=1, value='Summary (formulas)').font = BOLD
header(ws, s0, 1, ['Iteration', 'Runs', 'Completed', 'Mean Tab presses'])
for i, (label, rs) in enumerate(it_rows.items()):
    a, b = min(rs), max(rs)
    rr = s0 + 1 + i
    put(ws, rr, 1, [label, f'=COUNTA(B{a}:B{b})', f'=COUNTIF(C{a}:C{b},"yes")', f'=AVERAGE(D{a}:D{b})'], '0', CALC_FILL)
widths(ws, [22, 8, 11, 12, 40])
note(ws, f'A{s0 + 5}', 'Runs that did not complete stopped at a cap of 250–1000 Tab presses; their counts are the presses made before giving up.')
ch = style_chart(BarChart(), 15, 7.5)
ch.type = 'col'
ch.y_axis.title = 'Tab presses (mean of 3 runs)'
ch.add_data(Reference(ws, min_col=4, min_row=s0, max_row=s0 + 3), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=s0 + 1, max_row=s0 + 3))
ch.legend = None
ws.add_chart(ch, f'G{s0}')

# ---------------------------------------------------------------------------------------
# 7. Database query timing (E10)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('7_DB_Queries')
dbops = [e for e in events('main-dbopt') if e['type'] == 'op' and e.get('exp') == 'E10' and not e['query'].startswith('hold txn')]
variants = []
for e in dbops:
    k = (e['query'], e['variant'])
    if k not in variants:
        variants.append(k)
ws['A1'] = 'Server-side execution time (ms) from EXPLAIN ANALYZE, 30 runs per variant after 3 warm-up runs; synthetic table of 1,000,000 seat rows'
ws['A1'].font = BOLD
header(ws, 2, 1, ['Run'] + [f'{q} | {v}' for q, v in variants])
for i in range(30):
    vals = [i + 1]
    for k in variants:
        xs = [e['latencyMs'] for e in dbops if (e['query'], e['variant']) == k]
        vals.append(xs[i])
    put(ws, 3 + i, 1, vals, '0.000')
s0 = 36
ws.cell(row=s0 - 1, column=1, value='Summary per variant (formulas)').font = BOLD
header(ws, s0, 1, ['Query', 'Variant', 'n', 'Mean', 'SD', 'Median', 'p95', 'Speed-up vs first variant (median ratio)'])
first_row = {}
for i, (q, v) in enumerate(variants):
    rr = s0 + 1 + i
    c_ = col(i + 2)
    rng = f'{c_}3:{c_}32'
    first_row.setdefault(q, rr)
    put(ws, rr, 1, [q, v, f'=COUNT({rng})', f'=AVERAGE({rng})', f'=STDEV.S({rng})', f'=MEDIAN({rng})', f'=PERCENTILE.INC({rng},0.95)',
                    f'=F{first_row[q]}/F{rr}'], '0.000', CALC_FILL)
widths(ws, [20, 30] + [14] * 14)
# Chart: before vs after for the five main queries.
c0 = s0 + len(variants) + 3
ws.cell(row=c0 - 1, column=1, value='Chart data: median time before and after (formulas)').font = BOLD
header(ws, c0, 1, ['Query', 'Baseline', 'Optimised'])
pairs = [('seat map', 'no index (seq scan)', 'PK (showtime_id, seat_id)'), ('hold (2 seats)', 'no index (seq scan)', 'PK (showtime_id, seat_id)'),
         ('expiry sweep', 'no index', 'partial index (HELD only)'), ('my bookings', 'no index', 'composite (user_id, created_at)'),
         ('seat map + layout', 'normalised (3-table join)', 'denormalised (1 table)')]
for i, (q, b_, o_) in enumerate(pairs):
    rb = s0 + 1 + variants.index((q, b_))
    ro = s0 + 1 + variants.index((q, o_))
    put(ws, c0 + 1 + i, 1, [q, f'=F{rb}', f'=F{ro}'], '0.000', CALC_FILL)
ch = style_chart(BarChart())
ch.type = 'col'
ch.y_axis.title = 'Median execution time (ms, log scale)'
ch.y_axis.scaling.logBase = 10
ch.y_axis.scaling.min = 0.01
ch.y_axis.scaling.max = 1000
for c_ in (2, 3):
    ch.add_data(Reference(ws, min_col=c_, min_row=c0, max_row=c0 + len(pairs)), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=c0 + 1, max_row=c0 + len(pairs)))
ws.add_chart(ch, f'E{c0}')

# ---------------------------------------------------------------------------------------
# 8. Statistical tests from ranks
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('8_Stats_Tests')
ws['A1'] = 'Non-parametric tests on home-page LCP, built step by step from ranks'
ws['A1'].font = BOLD
homes = [('CineBook', ('CineBook', 'home')), ('BookMyShow', ('BookMyShow', 'home')), ('District', ('District', 'movies home'))]
header(ws, 3, 1, ['Platform', 'LCP (ms)', 'Rank among all 15'])
r = 4
grp = {}
for name, key in homes:
    xs = [round(e['lcpMs'], 1) for e in loads if (e['site'], e['page']) == key]
    grp[name] = (r, r + len(xs) - 1)
    for x in xs:
        put(ws, r, 1, [name, x, f'=RANK.AVG(B{r},$B$4:$B$18,1)'], '0.0', CALC_FILL)
        r += 1
ws['E3'] = 'Kruskal-Wallis test (are the three platforms different?)'
ws['E3'].font = BOLD
header(ws, 4, 5, ['Platform', 'n', 'Rank sum R', 'R² / n'])
for i, (name, _) in enumerate(homes):
    a, b = grp[name]
    rr = 5 + i
    put(ws, rr, 5, [name, f'=COUNT(B{a}:B{b})', f'=SUM(C{a}:C{b})', f'=G{rr}^2/F{rr}'], '0.00', CALC_FILL)
put(ws, 9, 5, ['N (all loads)', '=SUM(F5:F7)'], '0', CALC_FILL)
put(ws, 10, 5, ['H = 12/(N(N+1)) Σ R²/n − 3(N+1)', '=12/(F9*(F9+1))*SUM(H5:H7)-3*(F9+1)'], '0.000', CALC_FILL)
put(ws, 11, 5, ['p-value = CHISQ.DIST.RT(H, k−1)', '=CHISQ.DIST.RT(F10,2)'], '0.0000', CALC_FILL)
put(ws, 12, 5, ['Conclusion at α = 0.05', '=IF(F11<0.05,"significant difference","no significant difference")'], None, CALC_FILL)

ws['E15'] = 'Mann-Whitney U test, CineBook vs each competitor (normal approximation)'
ws['E15'].font = BOLD
header(ws, 16, 5, ['Comparison', 'n1', 'n2', 'R1 (CineBook ranks in pair)', 'U1 = R1 − n1(n1+1)/2', 'z', 'p (two-sided)'])
r_pair = 17
for i, other in enumerate(['BookMyShow', 'District']):
    rr = r_pair + i
    a1, b1 = grp['CineBook']
    a2, b2 = grp[other]
    pair = f'(B{a1}:B{b1},B{a2}:B{b2})'
    # Ranks within the pair: count of pair values below + half the ties + 1, summed for CineBook.
    r1 = '+'.join([f'(COUNTIF(B{a1}:B{b1},"<"&B{j})+COUNTIF(B{a2}:B{b2},"<"&B{j})+(COUNTIF(B{a1}:B{b1},B{j})+COUNTIF(B{a2}:B{b2},B{j})+1)/2)' for j in range(a1, b1 + 1)])
    put(ws, rr, 5, [f'CineBook vs {other}', 5, 5, f'={r1}', f'=H{rr}-F{rr}*(F{rr}+1)/2',
                    f'=(ABS(I{rr}-F{rr}*G{rr}/2)-0.5)/SQRT(F{rr}*G{rr}*(F{rr}+G{rr}+1)/12)', f'=2*(1-NORM.S.DIST(J{rr},TRUE))'], '0.000', CALC_FILL)
widths(ws, [13, 10, 16, 3, 34, 16, 18, 22, 20, 10, 14])
note(ws, 'E21', 'Non-parametric tests compare ranks instead of raw values, so they do not assume normally distributed times (n = 5 per platform is small).')
note(ws, 'E22', 'Holm correction for the two comparisons: multiply the smaller p by 2 and the larger by 1 (keeping order); see the report.')
note(ws, 'E23', 'Page weight (transferred KB) was tested the same way by the analysis script: Kruskal-Wallis H = 12.6, p = 0.0018.')

# ---------------------------------------------------------------------------------------
# 9. Supplementary (appendix)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('9_Supplementary')
ws['A1'] = 'Supplementary checks reported in Appendix B'
ws['A1'].font = BOLD
r = 3
for title, fname in (('Live seat race: 16 test accounts request the same seat at once (12 trials)', 'e4b_live_race.csv'),
                     ('Payment double-submit: 5 identical payment requests at once (6 trials)', 'e4c_live_idempotency.csv'),
                     ('Payment and seat-hold failure tests (8 trials per scenario)', 'e9_reliability.csv'),
                     ('Security checks by OWASP API Top 10 category', 'e11_summary.csv')):
    ws.cell(row=r, column=1, value=title).font = BOLD
    with open(PROC / fname, encoding='utf8') as f:
        rows_ = list(csv.reader(f))
    header(ws, r + 1, 1, rows_[0])
    for i, row in enumerate(rows_[1:]):
        put(ws, r + 2 + i, 1, [float(x) if x.replace('.', '', 1).replace('-', '', 1).isdigit() else x for x in row])
    r += len(rows_) + 3
widths(ws, [30] + [14] * 14)

# ---------------------------------------------------------------------------------------
# 10. Concurrency and booking reliability
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('10_Concurrency')
ws['A1'] = 'Same-seat test: c clients request one seat at the same instant, 20 trials per row (cloud PostgreSQL, 25 Oct 2026)'
ws['A1'].font = BOLD
header(ws, 2, 1, ['Approach', 'Clients (c)', 'Trials', 'Trials with a double booking', 'Double bookings (total)', 'Double bookings per trial', 'Median time (ms)', 'p95 time (ms)'])
labels_ = {'naive': 'Check, then update (naive)', 'conditional_update': 'CineBook: single conditional update',
           'pessimistic_sorted': 'Row locks (SELECT FOR UPDATE)', 'serializable': 'SERIALIZABLE isolation'}
with open(PROC / 'e1_hot_seat.csv', encoding='utf8') as f:
    e1 = [row for row in csv.DictReader(f) if row['strategy'] in labels_]
order = ['naive', 'conditional_update', 'pessimistic_sorted', 'serializable']
e1.sort(key=lambda row: (order.index(row['strategy']), int(row['concurrency'])))
r = 3
for row in e1:
    put(ws, r, 1, [labels_[row['strategy']], int(row['concurrency']), int(row['trials']), int(row['trials_with_double_booking']),
                   int(row['double_bookings_total']), f'=E{r}/C{r}', float(row['latency_p50_ms']), float(row['latency_p95_ms'])], '0.0', CALC_FILL)
    r += 1
c_end = r - 1
note(ws, f'A{r + 1}', 'A double booking is a seat sold to more than one client: for each seat, (number of successful claims − 1). Other locking approaches are listed in Appendix C of the report.')
# Chart data: double bookings per trial for the naive approach vs CineBook.
k0 = r + 4
ws.cell(row=k0 - 1, column=1, value='Chart data (formulas)').font = BOLD
header(ws, k0, 1, ['Clients', 'Check, then update (naive)', 'CineBook conditional update'])
for i, cval in enumerate((2, 8, 32)):
    rr = k0 + 1 + i
    put(ws, rr, 1, [str(cval), f'=SUMIFS($F$3:$F${c_end},$A$3:$A${c_end},"{labels_["naive"]}",$B$3:$B${c_end},{cval})',
                    f'=SUMIFS($F$3:$F${c_end},$A$3:$A${c_end},"{labels_["conditional_update"]}",$B$3:$B${c_end},{cval})'], '0.0', CALC_FILL)
ch = style_chart(BarChart())
ch.type = 'col'
ch.y_axis.title = 'Double bookings per trial'
ch.x_axis.title = 'Clients requesting the same seat'
for c_ in (2, 3):
    ch.add_data(Reference(ws, min_col=c_, min_row=k0, max_row=k0 + 3), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=k0 + 1, max_row=k0 + 3))
ws.add_chart(ch, f'J{k0}')

# Live seat race on the deployed site.
l0 = k0 + 8
ws.cell(row=l0 - 1, column=1, value='Live seat race on the deployed site: 16 test accounts request one seat at once').font = BOLD
with open(PROC / 'e4b_live_race.csv', encoding='utf8') as f:
    race = list(csv.DictReader(f))
header(ws, l0, 1, ['Trial', 'Clients', 'Winners', 'Refused (seat taken)', 'Errors', 'Double bookings'])
for i, row in enumerate(race):
    put(ws, l0 + 1 + i, 1, [int(row['trial']) + 1, int(row['clients']), int(row['winners']), int(row['conflicts']), int(row['errors']), int(row['double_bookings'])], '0')
le = l0 + len(race)
put(ws, le + 1, 1, ['Trials with exactly one winner', '', f'=COUNTIF(C{l0 + 1}:C{le},1)', '', '', f'=SUM(F{l0 + 1}:F{le})'], '0', CALC_FILL)
widths(ws, [36, 12, 8, 16, 16, 14, 14, 12])

# ---------------------------------------------------------------------------------------
# 11. Controlled load test (E8)
# ---------------------------------------------------------------------------------------
ws = wb.create_sheet('11_LoadTest')
ws['A1'] = 'Controlled load test: 10-500 simulated clients sent from ONE computer to the deployed site (3 repeats per level, 30 Oct 2026)'
ws['A1'].font = BOLD
lops = [e for e in events('main-scale') if e['type'] == 'op' and e.get('exp') == 'E8']
lops.sort(key=lambda e: (e['strategy'], e['c'], e['trial']))
header(ws, 2, 1, ['Workload', 'Simulated clients', 'Repeat', 'Request', 'Status', 'Response time (ms)'])
blocks = {}
for i, e in enumerate(lops):
    rr = 3 + i
    blocks.setdefault((e['strategy'], e['c']), []).append(rr)
    ws.cell(row=rr, column=1, value=e['strategy'])
    ws.cell(row=rr, column=2, value=e['c'])
    ws.cell(row=rr, column=3, value=e['trial'] + 1)
    ws.cell(row=rr, column=4, value=e['op'])
    ws.cell(row=rr, column=5, value=e['status'])
    ws.cell(row=rr, column=6, value=e['latencyMs'])
sc = 8
header(ws, 2, sc, ['Workload', 'Simulated clients', 'Requests', 'Errors', 'Median (ms)', 'p95 (ms)', 'p99 (ms)', 'Throughput mean (req/s)', 'Throughput SD'])
with open(PROC / 'e8_repeats.csv', encoding='utf8') as f:
    reps = list(csv.DictReader(f))
# Per-repeat throughput values sit beside the summary so their mean and SD are formulas too.
t0 = 14
ws.cell(row=t0 - 1, column=sc, value='Throughput per repeat (successful requests per second)').font = BOLD
header(ws, t0, sc, ['Workload', 'Simulated clients', 'Repeat 1', 'Repeat 2', 'Repeat 3'])
tp_rows = {}
for i, key in enumerate(sorted(blocks, key=lambda k: (k[0], k[1]))):
    rr = t0 + 1 + i
    vals = [float(x['throughput']) for x in reps if x['workload'] == key[0] and int(x['users']) == key[1]]
    put(ws, rr, sc, [key[0], key[1]] + vals, '0.0')
    tp_rows[key] = rr
for i, key in enumerate(sorted(blocks, key=lambda k: (k[0], k[1]))):
    rr = 3 + i
    a, b = min(blocks[key]), max(blocks[key])
    rng = f'F{a}:F{b}'
    t = tp_rows[key]
    put(ws, rr, sc, [key[0], key[1], f'=COUNT({rng})', f'=COUNTIFS(E{a}:E{b},">=400")', f'=MEDIAN({rng})', f'=PERCENTILE.INC({rng},0.95)',
                     f'=PERCENTILE.INC({rng},0.99)', f'=AVERAGE({col(sc + 2)}{t}:{col(sc + 4)}{t})', f'=STDEV.S({col(sc + 2)}{t}:{col(sc + 4)}{t})'], '0.0', CALC_FILL)
# Chart data: p50 and p95 by number of clients, read and write side by side.
g0 = 26
ws.cell(row=g0 - 1, column=sc, value='Chart data (formulas)').font = BOLD
header(ws, g0, sc, ['Simulated clients', 'Read median', 'Read p95', 'Write median', 'Write p95'])
for i, n in enumerate((10, 50, 100, 500)):
    rr = g0 + 1 + i
    look = lambda w, colname: f'=SUMIFS({colname}$3:{colname}$10,$H$3:$H$10,"{w}",$I$3:$I$10,{n})'
    put(ws, rr, sc, [str(n), look('read', 'L'), look('read', 'M'), look('write', 'L'), look('write', 'M')], '0.0', CALC_FILL)
lc = style_chart(LineChart())
lc.y_axis.title = 'Response time (ms)'
lc.x_axis.title = 'Simulated concurrent clients (one computer)'
for c_ in range(sc + 1, sc + 5):
    lc.add_data(Reference(ws, min_col=c_, min_row=g0, max_row=g0 + 4), titles_from_data=True)
lc.set_categories(Reference(ws, min_col=sc, min_row=g0 + 1, max_row=g0 + 4))
for s_, dash in zip(lc.series, ('sysDash', 'solid', 'sysDash', 'solid')):
    s_.graphicalProperties.line.dashStyle = dash
    s_.graphicalProperties.line.width = 28000
    s_.smooth = False
ws.add_chart(lc, f'N{g0}')
widths(ws, [9, 10, 8, 9, 8, 12, 2, 10, 10, 10, 8, 12, 10, 10, 14, 12])
note(ws, 'H33', 'Errors = responses with status 400 or above. All load came from a single computer in India, so the client itself may limit the highest level.')

wb.save(OUT)
print('wrote', OUT)

# ---------------------------------------------------------------------------------------
# Export charts with Excel (Windows): recalculates every formula and saves PNG images.
# ---------------------------------------------------------------------------------------
if '--no-export' not in sys.argv:
    import time
    import pythoncom
    import win32com.client as wc
    FIG.mkdir(parents=True, exist_ok=True)
    names = {'1_PageLoads': ['xl_lcp', 'xl_page_weight'], '2_Accessibility': ['xl_accessibility'], '3_API_Latency': ['xl_api_latency', 'xl_seatmap_hist'],
             '5_KLM': ['xl_klm'], '6_Keyboard': ['xl_keyboard'], '7_DB_Queries': ['xl_db'], '10_Concurrency': ['xl_concurrency'], '11_LoadTest': ['xl_load']}
    xl = wc.DispatchEx('Excel.Application')
    xl.Visible = False
    xl.DisplayAlerts = False
    try:
        book = xl.Workbooks.Open(str(OUT))
        xl.CalculateFull()
        for sheet, files in names.items():
            sh = book.Worksheets(sheet)
            for i, name in enumerate(files, start=1):
                co = sh.ChartObjects(i)
                chart = co.Chart
                # Large canvas + large type so the exported image stays sharp in print.
                co.Width, co.Height = 900, 480
                chart.ChartArea.Format.TextFrame2.TextRange.Font.Name = 'Calibri'
                chart.ChartArea.Format.TextFrame2.TextRange.Font.Size = 18
                chart.ChartArea.Border.LineStyle = -4142  # no outline around the exported image
                chart.HasTitle = False
                for g in range(1, chart.ChartGroups().Count + 1):
                    chart.ChartGroups(g).VaryByCategories = False
                for ax_type in (1, 2):  # category, value
                    ax = chart.Axes(ax_type)
                    if ax.HasTitle:  # re-create titles so Excel lays them out without overlap
                        text = ax.AxisTitle.Text
                        ax.HasTitle = False
                        ax.HasTitle = True
                        ax.AxisTitle.Text = text
                        ax.AxisTitle.Format.TextFrame2.TextRange.Font.Bold = False
                value_axis = chart.Axes(2)
                if value_axis.ScaleType == -4133:  # logarithmic: bars start at the bottom of the axis
                    value_axis.CrossesAt = value_axis.MinimumScale
                    value_axis.TickLabels.NumberFormat = 'General'
                else:
                    value_axis.TickLabels.NumberFormat = '#,##0'
                if chart.Axes(1).ReversePlotOrder:  # horizontal bar chart listed top to bottom
                    chart.Axes(1).Crosses = 2  # value axis at the bottom
                co.RoundedCorners = False
                co.Shadow = False
                chart.ChartArea.Format.Line.Visible = 0
                # openpyxl stores a fixed plot-area layout; reserve room for labels and legend.
                chart.PlotArea.Top = 8
                chart.PlotArea.Height = co.Height - (75 if chart.HasLegend else 30)
                chart.PlotArea.Left = 34
                chart.PlotArea.Width = co.Width - 44
                if chart.HasLegend:
                    chart.Legend.Position = -4107  # bottom
                    chart.Legend.Top = co.Height - 38
                for s in range(1, chart.SeriesCollection().Count + 1):
                    series = chart.SeriesCollection(s)
                    if name == 'xl_concurrency':  # zero bars are invisible; label every value
                        series.HasDataLabels = True
                        series.DataLabels().NumberFormat = '0'
                    if 'median' in series.Name.lower():
                        series.Format.Line.DashStyle = 4
                    if 'target' in series.Name:
                        series.Format.Line.ForeColor.RGB = 0x0000C0  # dark red (BGR)
                        series.Format.Line.DashStyle = 4  # dash
                        series.Format.Line.Weight = 2.5
                chart.Export(str(FIG / f'{name}.png'))
                print('exported', name)
        book.Save()
        book.Close(False)
    finally:
        xl.Quit()
