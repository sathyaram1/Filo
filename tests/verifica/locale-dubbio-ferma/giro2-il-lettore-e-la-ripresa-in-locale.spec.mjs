// Verifica locale, giro 2 (ramo claude/dubbio-ferma): le forme storte che il
// lettore deve respingere a voce, i confini dei bilanci, e la strada locale
// di un lavoro fermo su una scelta — logica pura, senza aprire Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { withRequest, withCritique, withFixed, checkVerdict, historyFromRounds } from '../../../scripts/verify-local.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackTransitions.js');
require('../../../src/shared/verifierRound.js');
const V = globalThis.SN_VERIFIER_ROUND;

const CAPS = { cap3: 10, cap2: 10, cap1: 1, cap0: 0 };
const F = (s) => V.parseFindings(s).findings;
const decide = (s, counts = {}) => V.decideRound({ findings: F(s), caps: CAPS, counts });
const sigla = (f) => `${f.level}${f.sede}${f.decision ? '?' : ''}`;

test('una sede sconosciuta, un livello fuori scala o due lettere non finiscono nel riassunto: la riga viene respinta', () => {
  for (const riga of ['[2x] testo', '[4i] testo', '[2ie] testo', '[2] testo']) {
    expect(V.unparsedLevelLines(`ok\n${riga}`), riga).toEqual(expect.arrayContaining([expect.stringContaining(riga)]));
    expect(F(`ok\n${riga}`), riga).toHaveLength(0);
  }
  // E la registrazione locale le respinge con l'elenco, invece di passare.
  const r = withCritique({}, 'claude/prova', { critique: 'ok\n[2x] il salvataggio non parte', sha: 'a1', caps: CAPS });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/\[2x\] il salvataggio non parte/);
});

test('le forme che uno scrive davvero si leggono: spazi dentro le quadre, a capo di Windows, sede maiuscola, tabulazione', () => {
  expect(F('[2 i ?] testo').map(sigla)).toEqual(['2i?']);
  const crlf = V.parseFindings('riassunto\r\n[2i] testo\r\n  passi uno\r\n[1E] altro');
  expect(crlf.summary).toBe('riassunto');
  expect(crlf.findings.map((f) => [sigla(f), f.text])).toEqual([['2i', 'testo\npassi uno'], ['1e', 'altro']]);
  expect(F('[2i]\ttesto').map((f) => f.text)).toEqual(['testo']);
  expect(V.unparsedLevelLines('[2i] 🔥 il pulsante brucia\n[0e] Premi [OK] e poi Salva')).toEqual([]);
});

test('allo stop restano davanti a chi riprende anche i 2 correggibili; un esterno col segno esce comunque, con la sua priorità', () => {
  const d = decide('[2i?] a\n[2i] b\n[1i?] c\n[1i] d\n[0i] e\n[3e?] f');
  expect(d.stop).toBe(true);
  expect(d.blocking.map((f) => f.text)).toEqual(['a']);
  expect(d.sospesi.map((f) => f.text)).toEqual(['b', 'c', 'd', 'e']);
  expect(d.derived).toEqual([]);
  expect(d.external.map((f) => [sigla(f), f.priority])).toEqual([['3e?', 3]]);
  expect(d.consume).toBeNull();
});

test('i confini dei bilanci: il 3 paga col 2, due 1 pagano un giro solo, il decimo 2 passa e l’undicesimo ferma', () => {
  expect(decide('[3i] a', { count2: 10 }).stop).toBe(true);
  const due = decide('[1i] a\n[1i] b');
  expect(due.fix.map((f) => f.text)).toEqual(['a', 'b']);
  expect(due.consume).toBe('cap1');
  expect(due.counts.count1).toBe(1);
  const nono = decide('[2i] a', { count2: 9 });
  expect(nono.stop).toBe(false);
  expect(nono.counts.count2).toBe(10);
  expect(decide('[2i] b', nono.counts).stop).toBe(true);
  // Un esterno col segno non ferma, nemmeno a bilanci esauriti.
  const est = decide('[2e?] a', { count2: 10 });
  expect(est.stop).toBe(false);
  expect(est.external.map((f) => f.priority)).toEqual([2]);
});

test('in locale un lavoro fermo su una scelta non pubblica, non si consegna a metà, e riparte da start con la storia intera', () => {
  const branch = 'claude/prova';
  const s = withRequest({}, branch, { request: 'Fai X.', sha: 'a1', at: '2026-09-23T10:00:00Z' });
  const critica = 'Provato tutto.\n[2i?] Il nome del file: dal sito o chiesto ogni volta? Scelta di prodotto.\n[1i] Il bordo è grigio.\n[3e] Le chiavi si scrivono con un solo OK: c’era già su main.';
  const r = withCritique(s, branch, { critique: critica, sha: 'a1', at: '2026-09-23T10:05:00Z', caps: CAPS });
  expect(r.ok).toBe(true);
  expect(r.outcome).toBe('stop');
  const e = r.state[branch];
  // Fermo: non si pubblica, e l'elenco dice cosa aspetta l'owner (compreso il sospeso).
  const gate = checkVerdict(e, 'a1');
  expect(gate.ok).toBe(false);
  expect(gate.reason).toContain('[2i?] Il nome del file');
  expect(gate.reason).toContain('[1i] Il bordo è grigio');
  // L'esterno esce a parte con la sua priorità; i bilanci si azzerano.
  expect(e.derived.map((f) => [sigla(f), f.priority])).toEqual([['3e', 3]]);
  expect(e.counts).toEqual({});
  // Una consegna «corretto» senza un giro aperto non passa: si riparte da start.
  expect(withFixed(r.state, branch, { report: 'fatto', sha: 'a2' }).ok).toBe(false);
  const s2 = withRequest(r.state, branch, { request: 'Fai X.', sha: 'a2' });
  const h = historyFromRounds(s2[branch].rounds);
  expect(h).toHaveLength(1);
  expect(h[0].critique).toContain('[2i?] Il nome del file');
  expect(h[0].critique).toContain('[1i] Il bordo è grigio');
  expect(h[0].critique).toMatch(/esito del giro: stop/);
  expect(s2[branch].derived.map(sigla)).toEqual(['3e']);
});
