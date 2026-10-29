import json,re,sys,unicodedata
from pypdf import PdfReader
r=PdfReader(sys.argv[1]); pages=[p.extract_text() for p in r.pages]
N=lambda t: re.sub(r'\s+',' ',unicodedata.normalize('NFC',t)).strip()
full=N(' '.join(pages)); nospace=re.sub(r'\s','',full)
def has(t): t=N(t); return t in full or re.sub(r'\s','',t) in nospace
C=json.load(open('content.json')); PK=open('packet.md').read(); PG=open('package.md').read()
res={}
# 1. 49 strings (same definition as G1 check)
s=[]
for e in C['entries']: s+= [e[k] for k in ('description','interpretation','contextNote','westernComparison','tradition') if e.get(k)]
s+= [C['intro'][k] for k in ('lead','tradition','linesAndMarks','westernDifference','limits')]
s+= list(C['disclosures'].values())
miss=[x for x in s if not has(x)]; res['1 content strings']=f'{len(s)-len(miss)}/{len(s)}'; [print('  MISS',m[:90]) for m in miss]
extra=[C['intro']['title'],C['review']['notice'],'Learn the lines of the hand','Explore traditional Indian interpretations of palm lines and symbols.','Traditional knowledge · no photo needed','Marks are shown as symbols, not placed on a hand: the sources do not fix one position for each, and no palm is expected to carry them.',"All descriptions are Aura's own paraphrases. No translations or diagrams are reproduced."]
res['1b other UI strings']=f'{sum(has(x) for x in extra)}/{len(extra)}'
# source citations per entry
sc={x['id']:x['shortCitation'] for x in C['sources']}
cit=[(sc[ref['sourceId']]+' — '+ref['locator']) for e in C['entries'] for ref in e['sources']]
res['1c entry citations']=f'{sum(has(c) for c in cit)}/{len(cit)}'
strip=lambda t: re.sub(r'`([^`]*)`',r'\1',re.sub(r'\*\*?([^*]+?)\*\*?',r'\1',t))
# 2. questions
qs=re.findall(r'(?m)^\d+\. (\*\*.+)$', PK[PK.index('## 5. Open'):PK.index('\n## 6.')])
qm=[q for q in qs if not has(strip(q))]; res['2 open questions (full text)']=f'{len(qs)-len(qm)}/{len(qs)}'; [print('  QMISS',m[:80]) for m in qm]
res['2b response boxes']=sum(f'Reviewer response to Q{i}' in full for i in range(1,15))
# 3. 19 rows
rows=[l for l in PG[PG.index('### C.2'):PG.index('### C.3')].splitlines() if re.match(r'^\| \d+',l)]
res['3 decision rows in source']=len(rows)
txt19=full[full.rindex('7.2 Per-item decisions'):full.rindex('8. Editorial and cultural review')]
res['3b A/AC/R blocks in PDF table']=len(re.findall(r'☐ ?A ?☐ ?AC ?☐ ?R',txt19))
# 4. W and L
for w in ['W1','W2','W3','W4']: res[f'4 {w}']=has(w) 
wr=[l for l in PG[PG.index('### C.1'):PG.index('### C.2')].splitlines() if re.match(r'^\| W\d',l)]
wtext=[c.strip() for l in wr for c in l.strip('|').split('|')[2:5]]
res['4b W current/proposed/reason verbatim']=f'{sum(has(strip(t)) for t in wtext)}/{len(wtext)}'
lr=[l for l in PG[PG.index('## Part D'):PG.index('## Part E')].splitlines() if re.match(r'^\| L\d',l)]
lt=[c.strip() for l in lr for c in l.strip('|').split('|')[1:3]]
res['4c L1-L8 question+position verbatim']=f'{sum(has(strip(t).replace("✋ 📜","raised-hand and scroll emoji")) for t in lt)}/{len(lt)} (rows {len(lr)})'
# ledger + tables completeness
led=[l for l in PK[PK.index('## 4. Source'):PK.index('## 5. Open')].splitlines() if l.startswith('| ') and not l.startswith('| Entry') ]
cells=[strip(c.strip()) for l in led for c in l.strip('|').split('|')]
lm=[c for c in cells if c and not has(c)]; res['6 ledger cells verbatim']=f'{len(cells)-len(lm)}/{len(cells)}'; [print('  LMISS',m[:80]) for m in lm]
for sec,a,b in [('6 sources table','## 1. Sources used','\n## 2.'),('6 safeguards table','## 6. Safeguards','\n## 7.'),('6 licensing record table','## 7. Licensing','\n## 8.')]:
    ls=[l for l in PK[PK.index(a):PK.index(b)].splitlines() if l.startswith('| ') and not re.match(r'^\| (ID|Safeguard|Source) \|',l)]
    cs=[strip(c.strip()) for l in ls for c in l.strip('|').split('|')]; m=[c for c in cs if c and not has(c)]
    res[sec]=f'{len(cs)-len(m)}/{len(cs)}'; [print('  TMISS',sec,x[:80]) for x in m]
# 8 sign-off blank
so=full[full.rindex('11. Reviewer sign-off'):full.rindex('After sign-off')]
allowed='11. Reviewer sign-off Intentionally blank. To be completed only by the named reviewers themselves. No one else may complete these fields, and an AI system cannot.'
leftover=so.replace(allowed,'')
for w in ['Primary scholarly reviewer','Editorial / cultural reviewer','Licensing reviewer','Name','Qualification / role','Date','Decision','☐ Approve ☐ Approve with corrections ☐ Reject','Conditions or notes','Signature']: leftover=leftover.replace(w,'')
leftover=re.sub(r'DRAFT — HUMAN REVIEW REQUIRED — NOT APPROVED FOR PUBLICATION|Aura Palmistry Human Review Package · G[23] v1\.[01] \(draft\) · 11 November 2026|Page \d+ of \d+','',leftover)
res['8 sign-off residual text']=repr(leftover.strip())
# 9 sensitive
pats=['@','neon','vercel','dpl_','postgres','localhost','token','secret','password','DATABASE','http','.app','ste277','Stephen','steve','Chennai','example.test','api/']
res['9 sensitive hits']={p:full.lower().count(p.lower()) for p in pats if full.lower().count(p.lower())}
res['banner on every page']=all('DRAFT — HUMAN REVIEW REQUIRED — NOT APPROVED FOR PUBLICATION' in N(p) for p in pages)
res['page numbers']=all(re.search(rf'Page {i+1} of {len(pages)}',N(p)) for i,p in enumerate(pages))
res['pages']=len(pages); res['outline entries']=len(r.outline)
links=sum(1 for p in r.pages[:3] for a in (p.get('/Annots') or []) if a.get_object().get('/Subtype')=='/Link'); res['TOC link annotations']=links
for k,v in res.items(): print(f'{k}: {v}')
