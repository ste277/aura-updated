import csv, sys, os
S = sys.argv[1]; OUT = sys.argv[2]
def tsv(name):
    with open(os.path.join(S, name)) as f:
        return list(csv.DictReader(f, delimiter='\t'))
git = {r['name']: r for r in tsv('git.tsv')}
sto = {r['name']: r for r in tsv('storage.tsv')}
om = {}
for line in open(os.path.join(S, 'originmain.tsv')):
    n, a, c = line.rstrip('\n').split('\t'); om[n] = (a, int(c))
pr = {}
for line in open(os.path.join(S, 'prmap.tsv')):
    n, p = line.rstrip('\n').split('\t'); pr[n] = p
act = {}
for line in open(os.path.join(S, 'activity.tsv')):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 4: act[p[0]] = (p[2], p[3])
unt_unique = {}
for line in open(os.path.join(S, 'untracked.tsv')):
    n, f, h, m = line.rstrip('\n').split('\t')
    if m == 'no': unt_unique.setdefault(n, []).append(f)
ign_unique = {'insights-v1-pr7-product-completion-corrections': ['apps/web/.env.local (differs from main)'],
              'vigilant-robinson-e14d9c': ['apps/web/.env.local, .env.local (differ from main)', 'playwright-report/', 'test-results/']}

PROTECTED = {'MAIN', 'hpg2-goal-linked-plans', 'palm-g4a-scan', 'gov02-i0c-pr1', 'aura-palm-01-i1', 'aura-mcp-02-i1-5-b'}
PROCESS = {'hpg2-goal-linked-plans': 'adb server cwd in apps/web/android (Android validation, up ~2d23h)',
           'agitated-swanson-bb3539': 'login zsh spawned by Claude desktop app 2026-11-14 15:39',
           'amazing-sanderson-11618a': 'login zsh spawned by Claude desktop app 2026-11-14 15:39'}
SESSION = {'agitated-swanson-bb3539': 'Claude session local_85455df8 (PR #291 merged), not archived',
           'vigilant-spence-87b096': 'Claude session local_fada46de (PR #193 closed), not archived',
           'vigilant-robinson-e14d9c': 'Claude sessions local_09ed0698, local_73cd3257, not archived',
           'loving-bardeen-cfbf42': 'Claude session local_b40b630c, not archived',
           'amazing-sanderson-11618a': 'Claude session local_ea0026b3, not archived',
           'objective-albattani-f959a3': 'Claude session local_b22d0b88, not archived',
           'objective-raman-6bdc56': 'Claude session local_ca8ce9e9, not archived'}
SYMLINK_TARGET = {'hpg2-goal-linked-plans': 'agent-aef69a94f416506e4/node_modules symlinks into it'}
PALM = {'palm-p1-verify'}
HPG_CURRENT = {'agent-a7a5f4de137862e18': 'detached at tip of worktree-hpg4-2-ci-functional-hardening (HPG4-2, 2 local-only commits)'}
PANCH_KEYS = ('PANCH', 'PA-', 'PCE', 'Panch', 'Muhurtham', 'solar', 'Tithi', 'Lahiri', 'astronomy', 'Sidereal', 'sidereal')
RECENT = '2026-11-07'

rows = []
for n, g in git.items():
    s = sto.get(n, {})
    reasons_p, reasons_r = [], []
    mod, stg, con = int(g['modified']), int(g['staged']), int(g['conflicts'])
    det = g['branch'] == '(detached)'
    in_om, ahead_om = om[n]
    prs = pr.get(n, 'none')
    merged = 'MERGED' in prs
    lc = g['last_commit_iso'][:10]
    idx, reflog = act.get(n, ('', ''))
    panch = any(k in g['last_commit_subject'] for k in PANCH_KEYS) or any(k in g['branch'] for k in ('pa2', 'pa3', 'pce', 'panch', 'pa-3c', 'pr292', 'pr-292', 'pr-310'))
    if n in PROTECTED: reasons_p.append('protected by ticket')
    if mod or stg or con: reasons_p.append(f'uncommitted tracked changes (modified={mod}, staged={stg})')
    if n in PROCESS: reasons_p.append('active process: ' + PROCESS[n])
    if n in SYMLINK_TARGET: reasons_p.append('dependency target: ' + SYMLINK_TARGET[n])
    if 'OPEN' in prs: reasons_p.append('open PR ' + prs)
    if n in unt_unique and any(f.startswith('AURA_') for f in unt_unique[n]):
        reasons_p.append('untracked evidence not found in Git or main: ' + ', '.join(f for f in unt_unique[n] if f.startswith('AURA_')))
    if n in PALM: reasons_p.append('PALM-01-I1 review worktree (PALM security work)')
    if n in HPG_CURRENT: reasons_p.append('current HPG work: ' + HPG_CURRENT[n])
    if panch and in_om == 'no' and not merged: reasons_p.append('Panchangam engineering/review with HEAD not in origin/main and no merged PR for this HEAD')
    if int(g['unique_not_other_local']) > 0 and int(g['unique_not_remote']) > 0: reasons_p.append('commits held only by this worktree')
    if n in SESSION: reasons_p.append('ownership: ' + SESSION[n] + ' (independent review P2-3)')
    if 'HPG4' in g['last_commit_subject'] or 'hpg4' in g['branch']: reasons_p.append('HPG4 work, protected as current HPG per ticket (independent review P2-4; origin/main has HPG4 closure #277 - owner may downgrade)')
    # REVIEW triggers
    if det: reasons_r.append('detached HEAD')
    if int(g['unique_not_remote']) > 0: reasons_r.append(f"{g['unique_not_remote']} commit(s) not on any remote ref (held by other local branches)")
    if in_om == 'no' and not merged: reasons_r.append(f'HEAD not in origin/main ({ahead_om} ahead) and no merged PR for this HEAD/branch ({prs})')
    if n in SESSION: reasons_r.append(SESSION[n])
    if n in unt_unique and not any(f.startswith('AURA_') for f in unt_unique[n]): reasons_r.append('untracked helper script(s) not in Git: ' + ', '.join(unt_unique[n]))
    if n in ign_unique: reasons_r.append('ignored files not reproducible from main: ' + '; '.join(ign_unique[n]))
    if lc >= RECENT or reflog[:10] >= RECENT: reasons_r.append(f'recent activity (last commit {lc}, reflog {reflog[:10]})')
    if panch: reasons_r.append('Panchangam-related (owner to confirm review is closed)')
    if 'HPG4' in g['last_commit_subject'] or 'hpg4' in g['branch']: reasons_r.append('HPG4 = current HPG track (owner to confirm agent worktree is finished)')
    if reasons_p: cls = 'PRESERVE'
    elif reasons_r: cls = 'REVIEW'
    else: cls = 'REMOVAL CANDIDATE'
    tot = int(s.get('total_kb', 0))
    rows.append(dict(name=n, path=g['path'], classification=cls,
        rationale='; '.join(reasons_p or reasons_r or [('clean; HEAD in origin/main;' if in_om=='yes' else f'clean; HEAD not in origin/main but squash-equivalent to merged PR {prs} (zero diff verified by independent review) and held by origin branch;') + ' no unique untracked/ignored content; no process or session; inactive since ' + max(lc, reflog[:10])]),
        branch=g['branch'], head=g['head'], detached='yes' if det else 'no', total_mib=round(tot/1024, 1),
        node_modules_mib=round(int(s.get('node_modules_real_kb', 0))/1024, 1), next_build_mib=round(int(s.get('next_build_kb', 0))/1024, 1),
        other_ignored_mib=round(int(s.get('other_ignored_kb', 0))/1024, 1), untracked_mib=round(int(s.get('untracked_kb', 0))/1024, 1),
        source_mib=round(int(s.get('source_kb', 0))/1024, 1),
        modified=mod, staged=stg, untracked=g['untracked'], ignored_entries=g['ignored_entries'],
        head_in_local_main=g['head_in_main'], head_in_origin_main=in_om, ahead_local_main=g['ahead_main'], ahead_origin_main=ahead_om,
        unique_not_other_local=g['unique_not_other_local'], unique_not_remote=g['unique_not_remote'],
        upstream=g['upstream'], upstream_track=g['upstream_track'], pr=prs, last_commit=g['last_commit_iso'],
        last_reflog=reflog, index_mtime=idx, locked=g['locked'], prunable=g['prunable'],
        process=PROCESS.get(n, 'none found'), session=SESSION.get(n, 'none found'),
        nm_symlinks=s.get('nm_symlinks', ''), subject=g['last_commit_subject']))
order = {'PRESERVE': 0, 'REVIEW': 1, 'REMOVAL CANDIDATE': 2}
rows.sort(key=lambda r: (order[r['classification']], -r['total_mib']))
with open(OUT, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
from collections import Counter
c = Counter(r['classification'] for r in rows); print(c)
for k in order:
    print(k, round(sum(r['total_mib'] for r in rows if r['classification'] == k)/1024, 2), 'GiB')
