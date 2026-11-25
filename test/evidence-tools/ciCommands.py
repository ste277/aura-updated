#!/usr/bin/env python3
"""AURA-ANDROID-REL-04 R4 evidence tool: lists the test commands of .github/workflows/ci.yml
(job, step name, step env, command) as JSON lines. Minimal parser for this workflow's layout
(2-space jobs, '- name:' steps, single-line or '|' run blocks, step-level env maps)."""
import json, re, sys
lines = open(sys.argv[1] if len(sys.argv) > 1 else '.github/workflows/ci.yml').read().split('\n')
job = None; in_jobs = False; step = None; out = []
i = 0
def flush():
    if step and step.get('run'): out.append(step)
while i < len(lines):
    l = lines[i]
    if l.startswith('jobs:'): in_jobs = True; i += 1; continue
    m = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', l)
    if in_jobs and m: flush(); step = None; job = m.group(1); i += 1; continue
    m = re.match(r'^      - (name|uses|run):\s*(.*)$', l)
    if job and m:
        flush(); step = {'job': job, 'name': m.group(2) if m.group(1) == 'name' else '', 'env': {}, 'run': None}
        if m.group(1) == 'run': step['run'] = m.group(2)
        i += 1; continue
    if step is not None:
        m = re.match(r'^        run:\s*(.*)$', l)
        if m:
            v = m.group(1)
            if v.strip() in ('|', '>'):
                block = []; i += 1
                while i < len(lines) and (lines[i].startswith('          ') or lines[i].strip() == ''):
                    block.append(lines[i][10:]); i += 1
                step['run'] = '\n'.join(block).strip(); continue
            step['run'] = v; i += 1; continue
        if re.match(r'^        env:\s*$', l):
            i += 1
            while i < len(lines) and lines[i].startswith('          ') and ':' in lines[i]:
                k, v = lines[i].strip().split(':', 1); step['env'][k.strip()] = v.strip().strip("'\""); i += 1
            continue
    i += 1
flush()
for s in out: print(json.dumps(s))
