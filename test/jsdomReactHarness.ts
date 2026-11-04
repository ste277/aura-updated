/**
 * HOME-INTENT-1 P2-4 -- minimal, shared jsdom + React 18 mounting harness.
 *
 * This repo has no jest/testing-library; every other test file runs as a
 * plain ts-node script. Real component-level tests (the one genuine gap
 * the independent review of PR #284 found -- every existing test only
 * exercised extracted pure functions or source-text regex, never the
 * actual mounted React components/effects) need an actual DOM, which
 * ts-node's default (root tsconfig, no `jsx`, no browser globals) does not
 * provide. Rather than pull in a full test framework, this file does the
 * smallest amount of real work needed to mount a real component with real
 * React 18 (`react-dom/client`), dispatch real DOM events against it, and
 * unmount it -- nothing more.
 *
 * Any test file using this harness MUST be run with the sibling
 * `tsconfig.jsdom-tests.json` (adds `"jsx": "react"` on top of the root
 * config -- needed because the production files this harness imports,
 * e.g. AskAuraView.tsx, contain real JSX):
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/<file>.test.ts
 *
 * React/ReactDOM are required from apps/web's own node_modules (not the
 * repo root's) by explicit relative path -- a plain `require('react')`
 * from a file under /test would walk up to the repo root's node_modules,
 * which does not have React installed (it only lives under apps/web,
 * where the Next.js app itself depends on it).
 */

import { JSDOM } from 'jsdom';

/** Installs jsdom's window/document/navigator onto Node's `global`, plus
 * two small, well-known jsdom-gap polyfills every real-world jsdom setup
 * needs (jsdom implements no layout at all, so `scrollIntoView` doesn't
 * exist; React 18's `act()` checks a specific global flag to know it's
 * running in a test-like environment).
 *
 * CRITICAL ORDERING NOTE, the actual cause of a very confusing crash
 * while building this harness: react-dom computes and CACHES its own
 * `canUseDOM`/`isInputEventSupported` feature-detection as module-level
 * constants the very first time it is `require`d. If that first require
 * happens before jsdom's globals exist, react-dom permanently decides
 * (for this whole process) that it's in a DOM-less environment, and its
 * ChangeEventPlugin falls back to an IE-only `attachEvent` code path
 * jsdom never implements -- crashing on the FIRST real `input`/keydown
 * event dispatched at any mounted component, with an error that has
 * nothing to do with the test itself. This is why this function runs,
 * synchronously, before react/react-dom are required anywhere below --
 * module order, not call order, is what matters here.
 */
function installJsdomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  (dom.window as any).HTMLElement.prototype.scrollIntoView = () => {};
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  (global as any).KeyboardEvent = dom.window.KeyboardEvent;
  (global as any).Event = dom.window.Event;
  (global as any).MouseEvent = dom.window.MouseEvent;
}
installJsdomGlobals();

// Real React/ReactDOM from apps/web's own dependency tree -- see the
// module doc comment above for why the path is explicit. Required only
// AFTER installJsdomGlobals() above has already run (see that function's
// own doc comment for why this order is load-bearing).
export const React = require('../apps/web/node_modules/react');
export const { createRoot } = require('../apps/web/node_modules/react-dom/client');
export const { act } = React;

export interface MountedHarness {
  readonly container: HTMLElement;
  readonly root: ReturnType<typeof createRoot>;
  rerender(element: unknown): Promise<void>;
  unmount(): Promise<void>;
}

/** Mounts `element` (a React.createElement(...) result -- this harness
 * intentionally never uses JSX itself, only imports production files
 * that do) into a fresh container appended to jsdom's real <body>, inside
 * a real act() so effects flush before this resolves. */
export async function mount(element: unknown): Promise<MountedHarness> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element as any);
  });
  return {
    container,
    root,
    async rerender(next: unknown) {
      await act(async () => {
        root.render(next as any);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Sets a real `<input>`'s value via the native setter (bypassing React's
 * own value-tracking shim) and fires a real `input` event, exactly as a
 * browser does when a user types -- then lets effects flush. */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Dispatches a real keydown event (e.g. Enter) at `target`, then flushes
 * one microtask turn so any resulting state updates/effects settle. */
export async function pressKey(target: EventTarget, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Dispatches a real click event at `target`. */
export async function click(target: EventTarget): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Flushes pending microtasks/timers under act() so in-flight promise
 * resolutions (e.g. a deferred fetch mock being resolved by the test)
 * have their resulting state updates committed before assertions run. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A controllable fetch mock: the test decides exactly when each call's
 * promise resolves (deferred-promise pattern, matching this session's own
 * established convention in test/dr4f2bAsyncRaceConditions.test.ts) --
 * never real network timing. */
export interface ControllableFetch {
  readonly fetchFn: typeof fetch;
  readonly calls: Array<{ url: string; body: unknown }>;
  resolve(callIndex: number, response: { ok: boolean; json: () => Promise<unknown> }): void;
  reject(callIndex: number, error: unknown): void;
}

export function createControllableFetch(): ControllableFetch {
  const calls: Array<{ url: string; body: unknown }> = [];
  const pending: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

  const fetchFn = ((url: string, opts?: any) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : undefined });
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  }) as unknown as typeof fetch;

  return {
    fetchFn,
    calls,
    resolve(callIndex, response) {
      pending[callIndex]!.resolve(response);
    },
    reject(callIndex, error) {
      pending[callIndex]!.reject(error);
    },
  };
}
