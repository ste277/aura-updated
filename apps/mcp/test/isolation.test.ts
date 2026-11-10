import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DIST_ROOT, SERVER_ENTRY, minimalEnv } from './helpers';

/**
 * Security/isolation evidence, two ways:
 *  1. Runtime: load the real server entry graph in a child process with
 *     Module._load instrumented, and record every module actually loaded.
 *  2. Static: walk every compiled relative require() reachable from the
 *     entry point and list the external packages it names.
 */

const FORBIDDEN_PACKAGES = /^(pg|pg-.*|@prisma\/.*|prisma|next|next\/.*|express|hono|@hono\/.*|undici|node-fetch|axios|web-push|nodemailer|@vercel\/.*)$/;
const FORBIDDEN_BUILTINS = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'cluster', 'child_process', 'worker_threads']);

function runtimeLoadedModules(): { requests: string[]; files: string[] } {
  const probe = `
    const Module = require('module');
    const requests = new Set();
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) { requests.add(request); return origLoad.apply(this, arguments); };
    // Load the server module graph (createServer + tool + schemas + pipeline + SDK stdio).
    require(${JSON.stringify(path.join(path.dirname(SERVER_ENTRY), 'server.js'))});
    require('@modelcontextprotocol/sdk/server/stdio.js');
    const { createServer } = require(${JSON.stringify(path.join(path.dirname(SERVER_ENTRY), 'server.js'))});
    createServer();
    process.stdout.write(JSON.stringify({ requests: [...requests], files: Object.keys(require.cache) }));
  `;
  const out = spawnSync(process.execPath, ['-e', probe], { env: minimalEnv(), cwd: path.dirname(SERVER_ENTRY), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test('runtime: no database, HTTP framework, network or process-spawning module is loaded', () => {
  const { requests, files } = runtimeLoadedModules();
  const bare = requests.map((r) => r.replace(/^node:/, ''));
  // Sanity: the instrumentation really observed the graph.
  assert.ok(bare.includes('zod') && bare.includes('astronomy-engine'), 'probe observed module loads');
  assert.ok(files.some((f) => f.endsWith(path.join('packages', 'recommendation', 'src', 'timingSearch.js'))), 'pipeline was loaded');
  const builtins = bare.filter((r) => FORBIDDEN_BUILTINS.has(r));
  assert.deepEqual(builtins, [], `forbidden builtins loaded: ${builtins}`);
  const pkgs = bare.filter((r) => !r.startsWith('.') && !r.startsWith('/')).map((r) => (r.startsWith('@') ? r.split('/').slice(0, 2).join('/') : r.split('/')[0]));
  const forbidden = pkgs.filter((p) => FORBIDDEN_PACKAGES.test(p));
  assert.deepEqual(forbidden, [], `forbidden packages loaded: ${forbidden}`);
  const forbiddenFiles = files.filter((f) => /node_modules[\\/](pg|@prisma|next|express|hono|@hono)[\\/]/.test(f) || /[\\/]apps[\\/]web[\\/]lib[\\/](db|prisma|prisma-db|session|auth|productEvents|push.*|reminder.*)\.js$/.test(f));
  assert.deepEqual(forbiddenFiles, [], `forbidden files loaded: ${forbiddenFiles}`);
});

function staticExternals(entry: string): { files: string[]; externals: string[] } {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\("([^"]+)"\)/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), spec.endsWith('.js') ? spec : `${spec}.js`);
        walk(fs.existsSync(resolved) ? resolved : path.resolve(path.dirname(file), spec, 'index.js'));
      } else {
        externals.add(spec);
      }
    }
  };
  walk(entry);
  return { files: [...seen].map((f) => path.relative(DIST_ROOT, f)).sort(), externals: [...externals].sort() };
}

test('static: compiled server graph names only the SDK, zod and astronomy-engine', () => {
  const { files, externals } = staticExternals(SERVER_ENTRY);
  assert.deepEqual(externals, ['@modelcontextprotocol/sdk/server/mcp.js', '@modelcontextprotocol/sdk/server/stdio.js', 'astronomy-engine', 'zod']);
  for (const f of files) {
    assert.match(f, /^(apps\/mcp\/src|apps\/web\/lib|packages)\//, `unexpected file in graph: ${f}`);
  }
  const webLib = files.filter((f) => f.startsWith('apps/web/lib/'));
  for (const f of webLib) {
    assert.doesNotMatch(f, /\/(db|prisma|prisma-db|session|auth|productEvents)\.js$/, `user-data module reachable: ${f}`);
  }
});

test('static: compiled server graph reads no environment variables and writes nothing to stdout', () => {
  const { files } = staticExternals(SERVER_ENTRY);
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIST_ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /process\.env/, `${f} reads process.env`);
    assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)\(|process\.stdout\.write/, `${f} writes to the console/stdout`);
    assert.doesNotMatch(src, /\bfetch\(|\.listen\(/, `${f} performs network I/O or listens`);
  }
});

test('read-only: the server registers no tool other than find_best_time', () => {
  const src = fs.readFileSync(path.join(path.dirname(SERVER_ENTRY), 'server.js'), 'utf8');
  const registrations = [...src.matchAll(/\.(registerTool|tool|registerResource|resource|registerPrompt|prompt)\(/g)].map((m) => m[1]);
  assert.deepEqual(registrations, ['registerTool']);
});
