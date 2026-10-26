'use client';
// Bring-your-own-keys, browser side. A visitor's keys live in localStorage on this device only; they
// ride along as headers on this site's own /api calls (the server uses them for that request only:
// lib/keys.ts). The mock-trial flag (sessionStorage) sends the "use no keys at all" header instead.
// One fetch wrapper adds them, so no call site needs to know: installed when this module loads, which
// is before any page effect makes a request.
import { useSyncExternalStore } from 'react';

export type Service = 'elevenlabs' | 'groq' | 'gemini' | 'anthropic';
export type Keys = Partial<Record<Service, string>>;

const KEYS_STORE = 'roulette.keys';
const MOCK_STORE = 'roulette.mock';
const HEADER: Record<Service, string> = {
  elevenlabs: 'x-key-elevenlabs',
  groq: 'x-key-groq',
  gemini: 'x-key-gemini',
  anthropic: 'x-key-anthropic',
};
const MOCK_HEADER = 'x-roulette-mock';

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function read(storage: () => Storage, key: string): string {
  try {
    return storage().getItem(key) ?? '';
  } catch {
    return ''; // private mode / storage blocked
  }
}

export function getKeys(): Keys {
  try {
    return JSON.parse(read(() => localStorage, KEYS_STORE) || '{}') as Keys;
  } catch {
    return {};
  }
}

/** Save (or with an empty value, remove) the visitor's keys on this device. */
export function setKeys(keys: Keys) {
  const clean = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v)) as Keys;
  try {
    if (Object.keys(clean).length) localStorage.setItem(KEYS_STORE, JSON.stringify(clean));
    else localStorage.removeItem(KEYS_STORE);
  } catch {
    // storage blocked: keys can't be kept
  }
  changed();
}

export const forgetKeys = () => setKeys({});

export const mockMode = () => read(() => sessionStorage, MOCK_STORE) === '1';

/** The menu's "mock trial": no API is called at all (this tab only). */
export function setMockMode(on: boolean) {
  try {
    if (on) sessionStorage.setItem(MOCK_STORE, '1');
    else sessionStorage.removeItem(MOCK_STORE);
  } catch {
    // storage blocked
  }
  changed();
}

/** Which services the visitor has a key for (re-renders when they change). */
export function useOwnKeys(): Record<Service, boolean> {
  const raw = useSyncExternalStore(subscribe, () => read(() => localStorage, KEYS_STORE), () => '');
  let keys: Keys = {};
  try {
    keys = JSON.parse(raw || '{}');
  } catch {}
  return { elevenlabs: !!keys.elevenlabs, groq: !!keys.groq, gemini: !!keys.gemini, anthropic: !!keys.anthropic };
}

export const useMockMode = () => useSyncExternalStore(subscribe, mockMode, () => false);

/** Headers for one of this site's /api calls: the mock flag, or the visitor's keys. */
export function byokHeaders(): Record<string, string> {
  if (mockMode()) return { [MOCK_HEADER]: '1' };
  const keys = getKeys();
  return Object.fromEntries((Object.keys(HEADER) as Service[]).filter((s) => keys[s]).map((s) => [HEADER[s], keys[s]!]));
}

const isOwnApi = (url: string) => {
  try {
    const u = new URL(url, location.href);
    return u.origin === location.origin && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

function install() {
  const w = window as Window & { __byokFetch?: boolean };
  if (w.__byokFetch) return;
  w.__byokFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const extra = isOwnApi(url) ? byokHeaders() : {};
    if (!Object.keys(extra).length) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return original(input, { ...init, headers });
  };
}

if (typeof window !== 'undefined') install();
