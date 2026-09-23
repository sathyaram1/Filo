// Verifica locale, giro 1 (ramo claude/dubbio-ferma): la sede dei rilievi e i
// bilanci del giro, provati sul modulo condiviso e sugli strumenti che lo
// usano — logica pura, senza aprire Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { buildVerifierBrief } from '../../../scripts/verify-local.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackTransitions.js');
require('../../../src/shared/verifierRound.js');
const V = globalThis.SN_VERIFIER_ROUND;

const CAPS = { cap2: 10, cap1: 1, cap0: 0 };
const F = (s) => V.parseFindings(s).findings;
const decide = (s, counts = {}) => V.decideRound({ findings: F(s), caps: CAPS, counts });
const sigla = (f) => `${f.level}${f.sede}${f.decision ? '?' : ''}`;

test('una riga col solo livello non prende una sede in silenzio: viene respinta con la spiegazione', () => {
  const p = V.parseFindings('ok\n[2] il pulsante non salva\n[1?] il bordo');
  expect(p.findings).toHaveLength(0);
  expect(p.rifiutati).toHaveLength(2);
  expect(p.rifiutati[0]).toMatch(/sede/);
  expect(V.unparsedLevelLines('ok\n[2] il pulsante non salva')).toHaveLength(1);
});

test('livello, sede e segno si leggono in tutte le forme che uno scrive davvero', () => {
  const testo = '[2i] a\n[2e] b\n[1i?] c\n[1?i] d\n[2I] e\n[ 2 e ] f\n- [3e] g\n**[0i]** h\n1. [2i] i';
  expect(V.unparsedLevelLines(testo)).toEqual([]);
  expect(F(testo).map(sigla)).toEqual(['2i', '2e', '1i?', '1i?', '2i', '2e', '3e', '0i', '2i']);
});

test('un livello fra quadre nel riassunto o nei passi, o due sulla stessa riga, fermano la registrazione', () => {
  expect(V.unparsedLevelLines('funziona X [2i] Y\n[1i] vero')).toHaveLength(1);
  expect(V.unparsedLevelLines('[2i] rilievo\n  Passi: apri e vedi [3i] boom')).toHaveLength(1);
  expect(V.unparsedLevelLines('[2i] primo [1e] secondo')).toHaveLength(1);
  expect(V.unparsedLevelLines('[2i]\n[1e] x')).toEqual(['[2i] (rilievo senza testo)']);
});

test('gli esterni non contano per il giro: il lavoro passa e ognuno diventa un feedback con priorità uguale al livello', () => {
  const d = decide('[2e] a\n[3e] b\n[0e] c');
  expect(d.stop).toBe(false);
  expect(d.fix).toEqual([]);
  expect(d.consume).toBeNull();
  expect(d.external.map((f) => f.priority)).toEqual([2, 3, 0]);
  // Anche a bilancio del 2 esaurito: un esterno non ferma niente.
  const d2 = decide('[3e] a', { count2: 10 });
  expect(d2.stop).toBe(false);
  expect(d2.external.map((f) => f.priority)).toEqual([3]);
});

test('un 2/3 interno col segno ferma per una decisione; un 1 o uno 0 col segno diventano un feedback loro', () => {
  const d = decide('[2i?] a');
  expect(d.stop).toBe(true);
  expect(d.blocking.map(sigla)).toEqual(['2i?']);
  const d1 = decide('[1i?] b\n[0i?] c');
  expect(d1.stop).toBe(false);
  expect(d1.fix).toEqual([]);
  expect(d1.derived.map((f) => [sigla(f), f.priority])).toEqual([['1i?', 1], ['0i?', 0]]);
});

test('un 1 o uno 0 interno oltre il bilancio non si perde: diventa un feedback suo con priorità uguale al livello', () => {
  const d1 = decide('[1i] a', { count1: 1 });
  expect(d1.fix).toEqual([]);
  expect(d1.derived.map((f) => [sigla(f), f.priority])).toEqual([['1i', 1]]);
  const d0 = decide('[0i] a');
  expect(d0.derived.map((f) => [sigla(f), f.priority])).toEqual([['0i', 0]]);
  // Con un 2 da correggere nello stesso giro si correggono anche loro, e si paga un giro solo.
  const d = decide('[2i] a\n[1i] b\n[0i] c', { count1: 1 });
  expect(d.fix.map(sigla)).toEqual(['2i', '1i', '0i']);
  expect(d.consume).toBe('cap2');
  expect(d.counts).toEqual({ count2: 1, count1: 1, count0: 0 });
});

test('allo stop gli altri rilievi interni della stessa critica non si perdono: o restano davanti a chi riprende, o diventano feedback loro', () => {
  // «Davanti a chi riprende» = nel segnalibro: quello che ha fermato più i sospesi.
  const tenutiDa = (d) => d.blocking.concat(d.sospesi || [], d.derived).map((f) => f.text);
  const d = decide('[2i?] a\n[1i] b\n[0i] c');
  expect(d.stop).toBe(true);
  expect(tenutiDa(d)).toContain('b');
  expect(tenutiDa(d)).toContain('c');
  // Lo stesso quando a fermare è il bilancio del 2 esaurito.
  const d2 = decide('[2i] a\n[1i] b', { count2: 10 });
  expect(d2.stop).toBe(true);
  expect(tenutiDa(d2)).toContain('b');
});

test('il compito stampato in locale insegna il formato che il lettore accetta: i suoi esempi passano la registrazione', () => {
  const brief = buildVerifierBrief({ request: 'Prova.', branch: 'claude/prova', recipe: '', history: [], scope: 'pieno', perimetro: [] });
  const esempi = brief.split('\n').filter((l) => /^\s*\[\d/.test(l));
  expect(esempi.length).toBeGreaterThan(0);
  for (const riga of esempi) {
    expect(V.unparsedLevelLines(riga), riga).toEqual([]);
    expect(V.parseFindings(riga).findings, riga).toHaveLength(1);
  }
  // E il segno del trade-off si spiega con la sede accanto, non da solo.
  expect(brief).not.toMatch(/`\[1\?\]`/);
});
