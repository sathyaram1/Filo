// Prova del giro 5 (verifica locale #1156), rilievo 1: il rinnovo settimanale di ciascun account è scritto nel
// codice in ora di Roma e non segue quello che portano le letture della barra. Col cambio dell'ora del 25/10, se il
// rinnovo vero resta alla stessa ora assoluta, nell'ora fra il rinnovo vero e quello scritto una lettura vera di A
// viene rifiutata. Non apre Filo: è il codice del server (repo filo-security accanto a questo), funzioni pure.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Dal checkout principale il server è `../filo-security`; da un worktree `.claude/worktrees/<nome>` sono tre livelli
// in più, e il ramo del server sta nel worktree omonimo di filo-security.
const SICUREZZA = [resolve(ROOT, '..', 'filo-security'), resolve(ROOT, '..', '..', '..', '..', 'filo-security')];
const CREDITI = [
  process.env.FILO_SECURITY_DIR || '',
  ...SICUREZZA.map((d) => resolve(d, '.claude', 'worktrees', basename(ROOT))),
  ...SICUREZZA,
].filter(Boolean).map((d) => resolve(d, 'functions', 'src', 'routine', 'crediti.js')).find((f) => existsSync(f)) || '';

test.skip(!CREDITI, 'repo del server con i crediti assente su questa macchina');

test('r1 dopo il cambio dell\'ora una lettura vera di A presa dopo il rinnovo vero conta su A', () => {
  const C = require(CREDITI);
  // Settimana prima del cambio: il rinnovo di A cade martedì 20/10 alle 17:00 UTC (19 di Roma, ora legale).
  const prima = C.letturaLocale({ pct7d: 92, reset7dAtS: Date.parse('2026-10-20T17:00:00Z') / 1000, letturaAtMs: Date.parse('2026-10-20T16:00:00Z') }, Date.parse('2026-10-20T16:00:10Z'));
  expect(prima.ok && prima.account).toBe('A');
  // Una settimana dopo, alla stessa ora assoluta, è il 27/10 alle 17:00 UTC: alle 17:30 la barra di A dice 0,5% e il
  // rinnovo successivo il 3/11 alle 17:00 UTC.
  const at = Date.parse('2026-10-27T17:30:00Z');
  const dopo = C.letturaLocale({ pct7d: 0.5, reset7dAtS: Date.parse('2026-11-03T17:00:00Z') / 1000, letturaAtMs: at }, at + 10_000);
  expect(dopo.ok ? dopo.account : dopo.reason).toBe('A');
});
