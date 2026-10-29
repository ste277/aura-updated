"""AURA-PALM-01-G2: build the human-review PDF from origin/main content (content.json),
the I1 review packet (packet.md) and the G1 package (package.md). Nothing is retyped
where a source exists: tables, questions, W1-W4, L1-L8 and the 19-row table are parsed."""
import json, re, sys, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, Image, KeepTogether, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas as rl_canvas

D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
SUP = '/System/Library/Fonts/Supplemental/'
pdfmetrics.registerFont(TTFont('Body', SUP + 'Arial.ttf'))
pdfmetrics.registerFont(TTFont('Body-B', SUP + 'Arial Bold.ttf'))
pdfmetrics.registerFont(TTFont('Body-I', SUP + 'Arial Italic.ttf'))
pdfmetrics.registerFont(TTFont('Body-BI', SUP + 'Arial Bold Italic.ttf'))
pdfmetrics.registerFont(TTFont('Sym', SUP + 'Arial Unicode.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Body', normal='Body', bold='Body-B', italic='Body-I', boldItalic='Body-BI')

C = json.load(open(os.path.join(D, 'content.json')))
PACKET = open(os.path.join(D, 'packet.md')).read()
PKG = open(os.path.join(D, 'package.md')).read()
VERSION = 'G3 v1.1 (draft)'
PREPARED = '11 November 2026'
REVISION = 'origin/main @ 1741a95'
BANNER = 'DRAFT — HUMAN REVIEW REQUIRED — NOT APPROVED FOR PUBLICATION'

INK = colors.HexColor('#1f2430'); MUTED = colors.HexColor('#5b6170'); RULE = colors.HexColor('#c9ced8')
ACCENT = colors.HexColor('#5b3fa8'); RED = colors.HexColor('#b3261e'); TINT = colors.HexColor('#f3f1fa')
EXIST = colors.HexColor('#f4f5f7'); PROP = colors.HexColor('#e8f1fb'); PROPB = colors.HexColor('#2b6cb0')

S = {}
def st(name, **kw):
    base = dict(fontName='Body', fontSize=9.5, leading=13.2, textColor=INK)
    base.update(kw); S[name] = ParagraphStyle(name, **base)
st('body'); st('small', fontSize=8.2, leading=11); st('cell', fontSize=8.2, leading=10.8)
st('cellb', fontName='Body-B', fontSize=8.2, leading=10.8)
st('muted', fontSize=8.2, leading=11, textColor=MUTED)
st('h1', fontName='Body-B', fontSize=16, leading=20, textColor=ACCENT, spaceBefore=4, spaceAfter=8, keepWithNext=1)
st('h1toc', fontName='Body-B', fontSize=16, leading=20, textColor=ACCENT, spaceAfter=8)
st('h2', fontName='Body-B', fontSize=11.5, leading=15, textColor=INK, spaceBefore=10, spaceAfter=5, keepWithNext=1)
st('h3', fontName='Body-B', fontSize=10, leading=13, textColor=ACCENT, spaceBefore=8, spaceAfter=3)
st('label', fontName='Body-B', fontSize=7.2, leading=9, textColor=ACCENT)
st('title', fontName='Body-B', fontSize=26, leading=31, textColor=INK, alignment=TA_CENTER)
st('subtitle', fontSize=13, leading=17, textColor=MUTED, alignment=TA_CENTER)
st('banner', fontName='Body-B', fontSize=11, leading=15, textColor=RED, alignment=TA_CENTER)
st('toc1', fontSize=10, leading=15, leftIndent=0); st('toc2', fontSize=8.8, leading=12.5, leftIndent=14, textColor=MUTED)
st('caption', fontSize=8.2, leading=11, textColor=MUTED)
st('warn', fontName='Body-B', fontSize=9, leading=12.5, textColor=RED)

BOX = '<font name="Sym">☐</font>'
DIAMOND = '<font name="Sym">◆</font>'

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def md(t):
    """Markdown inline -> reportlab markup. Content strings themselves are escaped only."""
    t = esc(t)
    t = re.sub(r'&lt;(/?(?:b|i|br/))&gt;', r'<\1>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', t)
    t = re.sub(r'`([^`]+)`', r'<font color="#5b6170">\1</font>', t)
    t = t.replace('◆', DIAMOND).replace('☐', BOX).replace('✋ 📜', 'raised-hand and scroll emoji')
    return t

def P(t, s='body', raw=False):
    return Paragraph(t if raw else md(t), S[s])

def section(md_text, heading):
    i = md_text.index(heading); j = md_text.find('\n#', i + len(heading))
    k = md_text.find('\n---', i)
    ends = [x for x in (j, k) if x != -1]
    return md_text[i + len(heading): min(ends) if ends else len(md_text)]

def md_table(block):
    rows = [l.strip() for l in block.splitlines() if l.strip().startswith('|')]
    out = []
    for r in rows:
        cells = [c.strip() for c in r.strip('|').split('|')]
        if all(re.fullmatch(r':?-{3,}:?', c) for c in cells): continue
        out.append(cells)
    return out

def grid(data, widths, header=True, style='cell', zebra=True, extra=None, minh=None):
    rows = []
    for ri, r in enumerate(data):
        rows.append([c if not isinstance(c, str) else Paragraph(c, S['cellb' if header and ri == 0 else style]) for c in r])
    if minh is not None:
        for r in rows[1:]:
            r[-1] = Spacer(1, minh)
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    cmds = [('GRID', (0, 0), (-1, -1), 0.4, RULE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    if header: cmds.append(('BACKGROUND', (0, 0), (-1, 0), TINT))
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if i % 2 == 0: cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#fafbfc')))
    if extra: cmds += extra
    t.setStyle(TableStyle(cmds)); return t

W = A4[0] - 40 * mm  # usable width
TOTAL_PAGES = None

class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=24 * mm,
                         bottomMargin=20 * mm, title='Aura Palmistry Human Review Package',
                         author='Aura (prepared with AI assistance)', subject=BANNER, **kw)
        f = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='f')
        self.addPageTemplates([PageTemplate('main', [f], onPage=self.decorate)])
        self._seq = 0
    def decorate(self, c, doc):
        c.saveState()
        c.setFillColor(RED); c.setFont('Body-B', 7.6)
        c.drawCentredString(A4[0] / 2, A4[1] - 12 * mm, BANNER)
        c.setStrokeColor(RULE); c.setLineWidth(0.5)
        c.line(20 * mm, A4[1] - 15 * mm, A4[0] - 20 * mm, A4[1] - 15 * mm)
        c.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
        c.setFillColor(MUTED); c.setFont('Body', 7.4)
        c.drawString(20 * mm, 10 * mm, f'Aura Palmistry Human Review Package · {VERSION} · {PREPARED}')
        c.drawRightString(A4[0] - 20 * mm, 10 * mm, f'Page {doc.page} of {TOTAL_PAGES or "?"}')
        c.restoreState()
    def afterFlowable(self, fl):
        if isinstance(fl, Paragraph) and fl.style.name in ('h1', 'h2'):
            lvl = 0 if fl.style.name == 'h1' else 1
            txt = fl.getPlainText(); self._seq += 1; key = f'k{self._seq}'
            self.canv.bookmarkPage(key); self.canv.addOutlineEntry(txt, key, level=lvl, closed=False)
            self.notify('TOCEntry', (lvl, txt, self.page, key))
    def beforeDocument(self):
        self._seq = 0

class NumberedCanvas(rl_canvas.Canvas):
    def __init__(self, *a, **k):
        super().__init__(*a, **k); self._pages = []
    def showPage(self):
        self._pages.append(dict(self.__dict__)); self._startPage()
    def save(self):
        n = len(self._pages)
        for p in self._pages:
            self.__dict__.update(p)
            self.setFillColor(MUTED); self.setFont('Body', 7.4)
            self.drawRightString(A4[0] - 20 * mm, 10 * mm, f'Page {self._pageNumber} of {n}')
            super().showPage()
        super().save()

story = []
H1 = lambda t: story.append(P(t, 'h1'))
H2 = lambda t: story.append(P(t, 'h2'))

def answer_box(label, h=16 * mm):
    t = Table([[Paragraph(label, S['label'])], ['']], colWidths=[W], rowHeights=[None, h])
    t.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.6, RULE), ('LEFTPADDING', (0, 0), (-1, -1), 5),
                           ('TOPPADDING', (0, 0), (-1, -1), 3)]))
    return t

# ---------------------------------------------------------------- 1. Cover
story += [Spacer(1, 28 * mm), P(BANNER, 'banner'), Spacer(1, 16 * mm),
          P('Aura Palmistry', 'title'), P('Human Review Package', 'title'), Spacer(1, 6 * mm),
          P('Educational guide to traditional Indian palmistry: content, sources, open questions, licensing and sign-off', 'subtitle'),
          Spacer(1, 16 * mm)]
cover = [['Document version', VERSION], ['Preparation date', PREPARED],
         ['Content revision', f'{REVISION} (latest audited revision)'],
         ['Review status', 'PENDING HUMAN REVIEW. No scholarly, editorial/cultural or licensing sign-off has been given.'],
         ['Approval record', f'status = {C["review"]["status"]}; approved by = none'],
         ['Publication', 'HOLD. The guide is hidden from all public builds.'],
         ['Distribution', 'Internal draft. Distribution to reviewers needs separate authorization (next gate: PALM-01-G3).'],
         ['Supersedes', 'G2 v1.0 (draft), SHA-256 988533d7…a4353b. v1.1 corrects the governance context in Section 12 only; all review content is unchanged.'],
         ['Prepared by', 'Prepared with AI assistance (Claude Code) for the Aura product owner. AI drafting and AI checks are not expert review.']]
story.append(grid([[f'<b>{esc(a)}</b>', esc(b)] for a, b in cover], [45 * mm, W - 45 * mm], header=False, zebra=False))
story.append(PageBreak())

# ---------------------------------------------------------------- Contents
story.append(Paragraph('Contents', S['h1toc']))
toc = TableOfContents(); toc.levelStyles = [S['toc1'], S['toc2']]; toc.dotsMinLevel = 0
story += [toc, PageBreak()]

# ---------------------------------------------------------------- 2. Instructions
H1('1. Review instructions')
story.append(P('This package lets qualified reviewers assess the Aura Palmistry guide without access to the codebase. Every user-visible sentence is reproduced exactly as it currently stands. The content was researched and drafted with AI assistance and checked by AI reviewers. <b>No human expert has reviewed it, and no licensing clearance has been given.</b>'))
H2('1.1 Scope')
story.append(P('In scope: the guide introduction, four disclosures and notes, four traditional lines, five traditional marks, the claim-by-claim citations, 14 open questions, four proposed wording changes (W1–W4) and eight licensing questions (L1–L8). Out of scope: software behaviour, the app\'s timing features, and any photo or palm-scanning feature (none exists).'))
H2('1.2 Who does what')
roles = [['Reviewer', 'Read', 'Complete'],
         ['Scholarly reviewer', 'Sections 2–5, 6, 7 and 10', 'Section 5.4 (Q1–Q14), Section 6 (W1–W4), Section 7, Section 11'],
         ['Editorial / cultural reviewer', 'Sections 2–4, 6, 8 and 10', 'Section 6 (W1, W3, W4), rows marked ' + DIAMOND + ' in Section 7.2, Section 8, Section 11'],
         ['Licensing reviewer', 'Sections 2, 5.1, 9 and 10 (Screenshot 07)', 'Section 9 (L1–L8), Section 11']]
story.append(grid(roles, [42 * mm, 58 * mm, W - 100 * mm]))
story.append(Spacer(1, 3 * mm))
story.append(P('This PDF presents the PALM-01-G1 human-review package (Parts A–E) and the AURA-PALM-01-I1 content review packet in one document. Items marked ' + DIAMOND + ' also need the editorial/cultural reviewer.', raw=True, s='body'))
H2('1.3 How to record decisions')
story.append(P('Write decisions and comments directly in the boxes provided (on paper, or with a PDF annotation tool). For every correction, give the <b>exact new wording</b>. Where an open question is left unresolved, say so explicitly ("accept as open with current wording").'))
H2('1.4 Limits of approval')
for b in ['Reviewer sign-off does <b>not</b> publish anything. Publication additionally needs a separate, explicit authorization from the product owner.',
          'Corrections are applied by an engineer afterwards; the reviewer then re-confirms the exact changed text before approval is recorded.',
          'Nothing in this document records, implies or anticipates an approval. All decision and signature fields are intentionally blank.',
          'Nothing here is legal advice. Licensing questions are posed, not answered.']:
    story.append(Paragraph('• ' + b, S['body']))
story.append(PageBreak())

# ---------------------------------------------------------------- 3. Feature overview
H1('2. Feature overview')
feat = PACKET[PACKET.index('**Feature.**'):PACKET.index('**Reviewer profile.**')].strip()
for para in feat.split('\n'):
    if not para.strip(): story.append(Spacer(1, 2 * mm)); continue
    story.append(Paragraph(('• ' + md(para[2:])) if para.startswith('- ') else md(para), S['body']))
H2('2.1 Placement: product decision PALM-01-G1-PD1')
story.append(P('Decided 11 November 2026 by the product owner: <b>keep the discovery-report placement.</b> The Palmistry card sits directly on the Explore screen as the fourth card, after Panchang Calendar, Muhurtham Finder and Plan Ahead (Screenshot 01). There is no "Traditional Wisdom" sub-menu for the current MVP. Basis: the discovery report (AURA-PALM-01-D1 §A.3) found that a grouping screen holding a single item adds a step without adding content. The grouping will be revisited only if a second non-timing tradition is approved.', raw=False))
H2('2.2 What the guide does not do')
for b in ['No photo, camera or upload; no reading of the user\'s own hand; no personalisation; no prediction.',
          'It does not feed, and is not fed by, Panchangam, Muhurtham or any ranking or recommendation logic.',
          'It does not ask for, or infer, the user\'s gender or which hand they use.',
          'It is hidden from all public builds until approval is recorded (re-verified on the live site on 11 November 2026).']:
    story.append(Paragraph('• ' + esc(b), S['body']))
story.append(PageBreak())

# ---------------------------------------------------------------- 4. Inventory
H1('3. Content inventory')
story.append(P('Existing content as of ' + REVISION + '. "Attribution confidence" rates confidence in the <i>source attribution</i>, not in the truth of the interpretation.', raw=False))
H2('3.1 Four lines and five marks')
inv = [['#', 'Feature', 'Term (IAST)', 'Type', 'Tradition label', 'Attribution', 'Conf.']]
for i, e in enumerate(C['entries'], 1):
    inv.append([str(i), esc(e['title']), '<i>' + esc(e['traditionalName']) + '</i>', e['category'], esc(e['tradition']),
                esc(C['labels'][e['attributionStatus']]), e['attributionConfidence']])
story.append(grid(inv, [7 * mm, 36 * mm, 26 * mm, 11 * mm, 45 * mm, 27 * mm, W - 152 * mm]))
H2('3.2 Guide text')
it = C['intro']
gt = [['Element', 'Exact current wording (existing content)'],
      ['Explore card', 'Kicker "Palmistry"; title "Learn the lines of the hand"; description "Explore traditional Indian interpretations of palm lines and symbols."; footer "Traditional knowledge · no photo needed"'],
      ['Page subtitle', esc(it['title'])], ['Lead', esc(it['lead'])], ['About: tradition', esc(it['tradition'])],
      ['About: lines and marks', esc(it['linesAndMarks'])], ['About: Indian and Western', esc(it['westernDifference'])],
      ['About: limits', esc(it['limits'])],
      ['Marks note', 'Marks are shown as symbols, not placed on a hand: the sources do not fix one position for each, and no palm is expected to carry them.'],
      ['Sources footnote', 'All descriptions are Aura\'s own paraphrases. No translations or diagrams are reproduced.'],
      ['Review notice (shown until approval)', esc(C['review']['notice'])]]
story.append(grid(gt, [38 * mm, W - 38 * mm]))
H2('3.3 Four disclosures and notes')
dd = C['disclosures']
dt = [['Disclosure', 'Where it appears', 'Exact current wording'],
      ['1. General disclosure', 'Always visible, above the diagram', esc(dd['general'])],
      ['2. Longevity disclosure', 'On the Longevity line entry', esc(dd['longevity'])],
      ['3. Diagram caption', 'Under the hand drawing', esc(dd['diagram'])],
      ['4. Hand-convention note', '"Which hand?" in About', esc(dd['hand'])]]
story.append(grid(dt, [36 * mm, 36 * mm, W - 72 * mm]))
H2('3.4 Safeguards built into the text')
story.append(grid([[md(c) for c in r] for r in md_table(section(PACKET, '## 6. Safeguards built into the text'))], [38 * mm, W - 38 * mm]))
story.append(PageBreak())

# ---------------------------------------------------------------- 5. Interpretations
H1('4. Traditional interpretations (exact current wording)')
story.append(P('Each entry below is <b>existing content</b>, reproduced exactly from the current content source. Source citations appear directly under each interpretation. Proposed changes are not shown here; they are in Section 6.', raw=False))
SRC = {s['id']: s for s in C['sources']}
for i, e in enumerate(C['entries'], 1):
    blk = [P(f'4.{i} {esc(e["title"])} — <i>{esc(e["traditionalName"])}</i>', 'h2', raw=True),
           P(f'Type: {e["category"]} · Tradition: {esc(e["tradition"])} · Attribution: {esc(C["labels"][e["attributionStatus"]])} · Confidence: {e["attributionConfidence"]}', 'muted', raw=True)]
    rows = [['Where', esc(e['description'])], ['In this tradition', esc(e['interpretation'])]]
    if e['id'] == 'ayurlekha': rows.append(['Longevity disclosure', '<b>' + esc(dd['longevity']) + '</b>'])
    rows.append(['Context and uncertainty', esc(e['contextNote'])])
    if e.get('westernComparison'): rows.append(['Western palmistry, for comparison', esc(e['westernComparison'])])
    srcs = '<br/>'.join('• ' + esc(SRC[r['sourceId']]['shortCitation']) + ' — <i>' + esc(r['locator']) + '</i>' for r in e['sources'])
    rows.append(['Sources', srcs])
    t = grid([[f'<b>{a}</b>', b] for a, b in rows], [36 * mm, W - 36 * mm], header=False, zebra=False,
             extra=[('BACKGROUND', (0, 0), (0, -1), EXIST)])
    blk += [t, Spacer(1, 2 * mm), answer_box(f'Reviewer notes on entry {i} (optional; record the decision in Section 7.2, row {i + 6})', 13 * mm), Spacer(1, 3 * mm)]
    story.append(KeepTogether(blk))
story.append(PageBreak())

# ---------------------------------------------------------------- 6. Citations + open questions
H1('5. Claim-by-claim citations and open questions')
H2('5.1 Sources used')
srows = md_table(section(PACKET, '## 1. Sources used'))
story.append(grid([[md(c) for c in r] for r in srows], [24 * mm, 46 * mm, 38 * mm, W - 108 * mm]))
H2('5.2 How to read the citation tags')
story.append(grid([[md(c).replace('Listed in §5', 'Listed in Section 5.4') for c in r] for r in md_table(section(PACKET, '**How to read the ledgers.**'))], [32 * mm, W - 32 * mm]))
H2('5.3 Citation ledger')
story.append(P(section(PACKET, '## 4. Source and citation ledger (claim by claim)').strip().split('\n')[0], 'small'))
story.append(Spacer(1, 2 * mm))
led = md_table(section(PACKET, '## 4. Source and citation ledger (claim by claim)'))
story.append(grid([[md(c) for c in r] for r in led], [22 * mm, 62 * mm, 40 * mm, W - 124 * mm]))
nic = [l for l in section(PACKET, '## 4. Source and citation ledger (claim by claim)').splitlines() if l.startswith('**Not independently checked')]
story.append(Spacer(1, 2 * mm)); story.append(P(nic[0], 'small'))
story.append(PageBreak())
H2('5.4 Open questions for the reviewer (Q1–Q14)')
story.append(P('Answer each question, or state "accept as open with the current wording".'))
QS = re.findall(r'(?m)^(\d+)\. (\*\*.+)$', section(PACKET, '## 5. Open questions for the reviewer'))
for n, q in QS:
    story.append(KeepTogether([P(f'<b>Q{n}.</b> ' + md(q[q.index('**'):]), 'body', raw=True), Spacer(1, 1.5 * mm),
                               answer_box(f'Reviewer response to Q{n}', 15 * mm), Spacer(1, 3.5 * mm)]))
story.append(PageBreak())

# ---------------------------------------------------------------- 7. Wording proposals
H1('6. Proposed wording changes (W1–W4)')
story.append(P('These are <b>proposals only</b>, raised by the PALM-01-G1 audit. None has been applied. Grey = existing text; blue = proposed text. Accept, amend (give exact wording) or reject each.', raw=False))
WROWS = md_table(section(PKG, '### C.1 Proposed wording corrections (proposals only; not applied)'))[1:]
for r in WROWS:
    wid, where, cur, prop, why = r[0], r[1], r[2], r[3], r[4]
    t = Table([[Paragraph('<b>' + md(wid) + '</b> · ' + md(where), S['cellb'])],
               [Paragraph('<font color="#5b6170"><b>EXISTING (current text)</b></font><br/>' + md(cur), S['cell'])],
               [Paragraph('<font color="#2b6cb0"><b>PROPOSED (not applied)</b></font><br/>' + md(prop), S['cell'])],
               [Paragraph('<b>Reason:</b> ' + md(why), S['cell'])],
               [Paragraph(f'<b>Decision:</b>  {BOX} Accept    {BOX} Amend    {BOX} Reject', S['cell'])],
               [Paragraph('<b>Amended wording / comments:</b>', S['cell'])]],
              colWidths=[W], rowHeights=[None, None, None, None, None, 18 * mm])
    t.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.6, RULE), ('LINEBELOW', (0, 0), (-1, -2), 0.3, RULE),
                           ('BACKGROUND', (0, 0), (-1, 0), TINT), ('BACKGROUND', (0, 1), (-1, 1), EXIST),
                           ('BACKGROUND', (0, 2), (-1, 2), PROP), ('LINEBEFORE', (0, 2), (0, 2), 2.5, PROPB),
                           ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 6),
                           ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    story += [KeepTogether([t]), Spacer(1, 4 * mm)]
story.append(PageBreak())

# ---------------------------------------------------------------- 8. Scholarly checklist + 19 rows
H1('7. Scholarly review')
C3 = section(PKG, '### C.3 Overall checklist')
schol = C3.split('Editorial / cultural reviewer')[0]
H2('7.1 Scholarly checklist')
for l in re.findall(r'(?m)^- \[ \] (.+)$', schol):
    l = l.replace('in §3', 'in Section 4').replace('the §4 ledger', 'the Section 5.3 ledger')
    story.append(Paragraph(BOX + '  ' + md(l), S['body']))
story.append(Spacer(1, 2 * mm))
kl = [l for l in C3.splitlines() if l.startswith('**Known research limits')]
story.append(P(kl[0], 'small'))
story.append(answer_box('Must any of these research limits be closed before approval? (scholarly reviewer)', 14 * mm))
H2('7.2 Per-item decisions (19 items)')
story.append(P('Decision codes: A = Approve, AC = Approve with corrections, R = Reject. "Open questions" refers to Section 5.4. Section references in brackets point to where the item appears in this PDF.', 'small'))
story.append(Spacer(1, 2 * mm))
REF = {'§2': 'Sec. 3.2–3.3', '§3.1': 'Sec. 4.1', '§3.2': 'Sec. 4.2', '§3.3': 'Sec. 4.3', '§3.4': 'Sec. 4.4', '§3.5': 'Sec. 4.5',
       '§3.6': 'Sec. 4.6', '§3.7': 'Sec. 4.7', '§3.8': 'Sec. 4.8', '§3.9': 'Sec. 4.9', '§3': 'Sec. 4', '§4': 'Sec. 5.3'}
rows19 = md_table(section(PKG, '### C.2 Per-item decisions'))[1:]
dec = [['#', 'Item', 'Open Qs', 'Decision', 'Corrections required (exact new wording) / comments', 'Initials']]
for r in rows19:
    item = r[1]
    item_pdf = re.sub(r'\((§[\d.]+(?:; [^)]*)?)\)', lambda m: '(' + REF.get(m.group(1).split(';')[0], m.group(1).split(';')[0]) + (';' + m.group(1).split(';', 1)[1] if ';' in m.group(1) else '') + ')', item)
    dec.append([md(r[0]), md(item_pdf), md(r[4]), f'{BOX} A<br/>{BOX} AC<br/>{BOX} R', '', ''])
story.append(grid(dec, [10 * mm, 54 * mm, 16 * mm, 16 * mm, W - 110 * mm, 14 * mm], minh=19 * mm))
story.append(PageBreak())

# ---------------------------------------------------------------- 9. Editorial
H1('8. Editorial and cultural review')
story.append(P('The editorial/cultural reviewer covers items marked ' + DIAMOND + ' in Section 7.2 (items 3, 4, 5, 10 and 11) and proposals W1, W3 and W4 in Section 6, plus the checklist below.', raw=True))
H2('8.1 Editorial and cultural checklist')
ed = C3.split('Editorial / cultural reviewer')[1].split('**Known research limits')[0]
for l in re.findall(r'(?m)^- \[ \] (.+)$', ed):
    story.append(Paragraph(BOX + '  ' + md(l), S['body']))
story.append(Spacer(1, 3 * mm))
story.append(answer_box('Wording, sensitivity or clarity concerns not covered above (cite section and exact text)', 45 * mm))
story.append(PageBreak())

# ---------------------------------------------------------------- 10. Licensing
H1('9. Licensing clearance checklist')
story.append(P('Nothing here is legal advice. <b>No licensing clearance has been given.</b>', raw=False))
H2('9.1 In-app attribution as currently written')
story.append(P('Shown in the guide\'s Sources list (Screenshot 07): "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā. Kenneth G. Zysk. 2025 (scholarly edition). History of Science in South Asia 13 (2025): 240–275. DOI 10.18732/hssa128. Source link © Kenneth G. Zysk, licensed under CC BY-SA 4.0; Aura\'s text paraphrases this work." Below the list: "All descriptions are Aura\'s own paraphrases. No translations or diagrams are reproduced."'))
H2('9.2 Licensing questions L1–L8')
lrows = md_table(section(PKG, '## Part D. Licensing clearance checklist'))[1:]
lic = [['#', 'Question', 'Current position (recorded, not cleared)', 'Decision', 'Notes']]
for r in lrows:
    lic.append([md(r[0]), md(r[1]), md(r[2]), md(r[3]) if r[3] else '', ''])
story.append(grid(lic, [9 * mm, 62 * mm, 42 * mm, 26 * mm, W - 139 * mm], minh=17 * mm))
H2('9.3 Source-level licensing record')
lt = md_table(section(PACKET, '## 7. Licensing and attribution checklist'))
story.append(grid([[md(c) for c in r] for r in lt], [24 * mm, 26 * mm, 22 * mm, 26 * mm, 22 * mm, 26 * mm, W - 146 * mm]))
story.append(PageBreak())

# ---------------------------------------------------------------- 11. Screenshots
H1('10. Review screenshots')
story.append(P('Screenshots 01–05 were captured from a local development build at an earlier revision (aa56547). Their visible wording was compared with the current text on 11 November 2026 and matches. Screenshots 06 and 07 were captured on 11 November 2026 from an isolated local development build of ' + REVISION + ' (test account, temporary local database, no application changes). <b>Where a screenshot and the text in Sections 3–4 disagree, the text is authoritative.</b>', raw=False))
story.append(Spacer(1, 2 * mm))
story.append(P('Screenshot 06 replaces the earlier version, which showed superseded wording ("the middle finger with a general or preceptor"). The superseded image is not included in this PDF.', 'warn'))
IMG = os.path.join(D, 'img')
mob = [('01-explore-fourth-card-mobile.png', 'Screenshot 01. Explore screen (mobile, 375×812 emulated): Palmistry is the fourth card, after Plan Ahead. Placement per decision PD1.'),
       ('02-guide-intro-disclosure-mobile.png', 'Screenshot 02. Guide introduction with the always-visible general disclosure, review notice and Lines/Marks switch.'),
       ('03-line-selected-focus-ring-mobile.png', 'Screenshot 03. Schematic hand with the Longevity line selected; diagram caption visible.'),
       ('04-longevity-entry-disclosure-mobile.png', 'Screenshot 04. Longevity line entry with the longevity disclosure and Western comparison note.'),
       ('05-marks-fish-selected-mobile.png', 'Screenshot 05. Marks shown as symbols (original glyphs), Fish selected, marks note visible.')]
def img(fn, width):
    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(os.path.join(IMG, fn)).getSize()
    return Image(os.path.join(IMG, fn), width=width, height=width * ih / iw)
cw = W / 3
def row(items):
    cells = [[img(f, 50 * mm) for f, _ in items] + [''] * (3 - len(items)),
             [Paragraph(c, S['caption']) for _, c in items] + [''] * (3 - len(items))]
    t = Table(cells, colWidths=[cw] * 3)
    t.setStyle(TableStyle([('ALIGN', (0, 0), (-1, 0), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('LEFTPADDING', (0, 0), (-1, -1), 3), ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                           ('TOPPADDING', (0, 1), (-1, 1), 4), ('BOTTOMPADDING', (0, 1), (-1, 1), 8)]))
    return KeepTogether([t])
story += [row(mob[0:3]), row(mob[3:5])]
for fn, cap in [('06-desktop-upward-line-current.jpg', 'Screenshot 06 (current, captured 11 Nov 2026). Desktop (1280×900 emulated): schematic hand and Upward line entry. Reads "the middle finger with a general", matching Section 4.4.'),
                ('07-desktop-sources-licence-notice.jpg', 'Screenshot 07 (current, captured 11 Nov 2026). About section and Sources list with the CC BY-SA 4.0 licence notice and paraphrase note (Section 9.1). New in G2; no earlier screenshot showed it.')]:
    story += [KeepTogether([img(fn, W), Spacer(1, 2 * mm), Paragraph(cap, S['caption']), Spacer(1, 6 * mm)])]
story.append(PageBreak())

# ---------------------------------------------------------------- 12. Sign-off
H1('11. Reviewer sign-off')
story.append(P('<b>Intentionally blank.</b> To be completed only by the named reviewers themselves. No one else may complete these fields, and an AI system cannot.', raw=False))
for role in ['Primary scholarly reviewer', 'Editorial / cultural reviewer', 'Licensing reviewer']:
    rows = [[Paragraph(f'<b>{role}</b>', S['cellb']), ''], ['Name', ''], ['Qualification / role', ''], ['Date', ''],
            [Paragraph('Decision', S['cell']), Paragraph(f'{BOX} Approve    {BOX} Approve with corrections    {BOX} Reject', S['cell'])],
            ['Conditions or notes', ''], ['Signature', '']]
    t = Table(rows, colWidths=[42 * mm, W - 42 * mm], rowHeights=[None, 9 * mm, 9 * mm, 9 * mm, 9 * mm, 20 * mm, 13 * mm])
    t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, RULE), ('SPAN', (0, 0), (-1, 0)), ('BACKGROUND', (0, 0), (-1, 0), TINT),
                           ('FONT', (0, 1), (0, -1), 'Body', 8.4), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TEXTCOLOR', (0, 1), (0, -1), MUTED)]))
    story += [KeepTogether([t]), Spacer(1, 5 * mm)]
H2('After sign-off')
for b in ['If corrections were requested, an engineer applies them in a new change, and the reviewer re-confirms the exact changed text.',
          'Only after all three sign-offs is the approval record updated, with the real reviewer names and dates, in a reviewed change.',
          '<b>Publication still requires a separate, explicit authorization</b> from the product owner, under the merge and release rules in force at that time.']:
    story.append(Paragraph('• ' + b, S['body']))
story.append(PageBreak())

# ---------------------------------------------------------------- 13. Governance
H1('12. Outstanding governance items')
story.append(P('Context for reviewers and the product owner. These items do not need reviewer action but must be resolved before publication can be authorized.', 'body'))
gov = [['Item', 'Status (11 Nov 2026)', 'Needed'],
       ['Explore placement (PD1)', 'Decided: keep the card directly on Explore', 'None (recorded)'],
       ['MVP product decisions record', 'Open. Palmistry MVP product decisions 2.1–2.7 were documented in the 10 November I1 ticket at approximately 05:57 UTC. These decisions have not yet been incorporated into the repository\'s formal governance records.', 'Incorporate decisions 2.1–2.7 into the repository\'s governance records'],
       ['PR #338 merge authorization', 'Open. The 10 November M2 ticket explicitly authorized a normal GitHub merge at approximately 10:47 UTC. PR #338 merged at approximately 11:00 UTC. The authorization is not recorded in the GitHub PR history.', 'Record the M2 merge authorization in the repository\'s governance records'],
       ['M2 milestone record', 'Open. M2 covered the GitHub merge and Production verification stage. It ended POST-MERGE BLOCKED after automatic deployment failed. M3 subsequently addressed the deployment issue. No M2 milestone report exists.', 'Write the M2 milestone record'],
       ['Scholarly sign-off', 'Not started', 'Sections 5–7 and 11'],
       ['Editorial / cultural sign-off', 'Not started', 'Sections 6, 8 and 11'],
       ['Licensing clearance', 'Not started', 'Sections 9 and 11'],
       ['Publication authorization', 'Not given. Publication HOLD; production merge freeze active.', 'Separate explicit authorization after all sign-offs']]
story.append(grid(gov, [42 * mm, 72 * mm, W - 114 * mm]))
story.append(Spacer(1, 2 * mm))
story.append(P('Evidence: the product owner\'s original ticket records of 10 November 2026 (I1, M2 and M3, with the M2 outcome report) and the GitHub timeline of PR #338. These are <b>historical records, not formal repository approval records</b>. The MVP product decisions, PR #338 merge authorization and M2 milestone items therefore remain open.', 'small'))
H2('Publication sequence')
for n, b in enumerate(['Product owner incorporates the MVP decisions, the merge authorization and the M2 record into the repository\'s governance records.',
                       'Scholarly and editorial/cultural reviewers complete Sections 5–8 and 11.',
                       'Licensing reviewer completes Sections 9 and 11.',
                       'Accepted corrections are applied in a new change; reviewers re-confirm the changed text.',
                       'The approval record is updated with the real reviewers and dates, in a reviewed change.',
                       'Separate merge and publication authorization by the product owner.'], 1):
    story.append(Paragraph(f'{n}. ' + esc(b), S['body']))

# Two passes: the first counts pages, the second prints "Page N of M". Pages are drawn
# directly (no deferred-page canvas), so bookmark and TOC destinations point at the
# real page objects. (v1.0 used a deferred canvas, which orphaned every destination.)
import copy
TOTAL_PAGES = None
_story_copy = copy.deepcopy(story)
probe = Doc(OUT); probe.multiBuild(story)
TOTAL_PAGES = probe.page
doc = Doc(OUT); doc.multiBuild(_story_copy)
print('built', OUT)
