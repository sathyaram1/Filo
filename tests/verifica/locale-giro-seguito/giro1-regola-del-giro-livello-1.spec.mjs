// Prove del giro 1 (verifica locale) sul lavoro «seguito del giro»,
// punto B: un rilievo di livello 1 si corregge nello stesso giro in cui si
// corregge un livello 2, anche a cap1 finito, e non consuma cap1 (il giro lo
// paga il livello più alto); da soli gli 1 seguono cap1 come prima; un 1 con
// la domanda (`[1i?]`) resta derivato. Aggiornate alla sede obbligatoria e ai
// bilanci separati per livello (cap3 dal 2026-09-23: il 2 a bilancio finito
// non ferma più, esce a parte).
//
// La regola vive in un modulo condiviso che il server incorpora al deploy:
// si prova la copia pubblica e, se sul disco c'è anche una copia incorporata
// nel repo del server DELLA STESSA GENERAZIONE (stessi nomi dei bilanci), pure
// quella (devono rispondere uguale).

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

function caricaPubblico() {
  require(join(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
  require(join(ROOT, 'src', 'shared', 'verifierRound.js'));
  return globalThis.SN_VERIFIER_ROUND;
}
const PUBBLICO = caricaPubblico();

/**
 * Una copia incorporata nel repo del server, se sta accanto (il checkout
 * principale o una cartella di lavoro `filo-security*`), scegliendo quella
 * coi bilanci di questa generazione: una copia di prima della separazione
 * risponde a un'altra regola, e confrontarla sarebbe un rosso finto.
 */
function copiaServer() {
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    let voci = [];
    try { voci = readdirSync(dir).filter((n) => n.startsWith('filo-security')); } catch (_) { voci = []; }
    for (const n of voci) {
      const p = join(dir, n, 'functions', 'src', 'routine', 'verifierRound.js');
      if (!existsSync(p)) continue;
      try {
        const mod = require(p);
        if (JSON.stringify(mod.CAP_KEYS) === JSON.stringify(PUBBLICO.CAP_KEYS)) return p;
      } catch (_) { /* una copia che non si carica non si confronta */ }
    }
    dir = dirname(dir);
  }
  return '';
}
const COPIA_SERVER = copiaServer();

function rilievi(ROUND, testo) {
  return ROUND.parseFindings(`riassunto di cosa funziona\n${testo}`).findings;
}
const CAPS = (cap2, cap1, cap0, cap3 = 10) => ({ cap3, cap2, cap1, cap0 });

function provaRegola(nome, ROUND) {
  test.describe(nome, () => {
    test('un 1 insieme a un 2 entra nel giro anche a cap1 = 0, e il conto del giro va a cap2', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[2i] non salva\n[1i] bordo freddo'), caps: CAPS(10, 0, 0), counts: {} });
      expect(d.stop).toBe(false);
      expect(d.fix.map((f) => f.level)).toEqual([2, 1]);
      expect(d.derived).toEqual([]);
      expect(d.consume).toBe('cap2');
      expect(d.counts.count2).toBe(1);
      expect(d.counts.count1).toBe(0);
      expect(d.budgets.cap1.used).toBe(0);
    });

    test('lo stesso a cap1 già consumato (cap1 = 1, un giro già speso)', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[2] non salva\n[1] bordo freddo'), caps: { cap2: 10, cap1: 1, cap0: 0 }, counts: { count1: 1 } });
      expect(d.fix.map((f) => f.level)).toEqual([2, 1]);
      expect(d.consume).toBe('cap2');
      expect(d.counts.count1).toBe(1);
    });

    test('un 3 con un 1: entrano tutti e due, e il conto va al bilancio del 3 (che è cap2)', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[3] si scrive nelle chiavi SSH\n[1] bordo freddo'), caps: { cap2: 10, cap1: 0, cap0: 0 }, counts: {} });
      expect(d.fix.map((f) => f.level)).toEqual([3, 1]);
      expect(d.consume).toBe('cap2');
    });

    test('un 1 da solo a cap1 = 0 va nel derivato e non paga niente', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[1] bordo freddo'), caps: { cap2: 10, cap1: 0, cap0: 0 }, counts: {} });
      expect(d.stop).toBe(false);
      expect(d.fix).toEqual([]);
      expect(d.derived.map((f) => f.level)).toEqual([1]);
      expect(d.consume).toBe(null);
    });

    test('un 1 da solo a cap1 = 1 entra nel giro e il conto va a cap1, come prima', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[1] bordo freddo'), caps: { cap2: 10, cap1: 1, cap0: 0 }, counts: {} });
      expect(d.fix.map((f) => f.level)).toEqual([1]);
      expect(d.consume).toBe('cap1');
      expect(d.counts.count1).toBe(1);
      expect(d.counts.count2).toBe(0);
    });

    test('un 1 con la domanda resta derivato anche accanto a un 2 che entra nel giro', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[2] non salva\n[1?] bordo freddo: caldo come il resto?'), caps: { cap2: 10, cap1: 5, cap0: 0 }, counts: {} });
      expect(d.stop).toBe(false);
      expect(d.fix.map((f) => f.level)).toEqual([2]);
      expect(d.derived.map((f) => f.level)).toEqual([1]);
      expect(d.derived[0].decision).toBeTruthy();
    });

    test('a cap2 finito il 2 ferma il lavoro e l\'1 non entra da solo per la strada del 2', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[2] non salva\n[1] bordo freddo'), caps: { cap2: 1, cap1: 0, cap0: 0 }, counts: { count2: 1 } });
      expect(d.stop).toBe(true);
      expect(d.blocking.map((f) => f.level)).toEqual([2]);
      expect(d.fix).toEqual([]);
      expect(d.consume).toBe(null);
    });

    test('un 2 con la domanda ferma il lavoro: nemmeno l\'1 entra nel giro', () => {
      const d = ROUND.decideRound({ findings: rilievi(ROUND, '[2?] scelta di prodotto\n[1] bordo freddo'), caps: { cap2: 10, cap1: 5, cap0: 0 }, counts: {} });
      expect(d.stop).toBe(true);
      expect(d.fix).toEqual([]);
    });

    test('con un 2 si correggono anche 1 e 0, sempre da cap2; un 0 da solo resta derivato', () => {
      let d = ROUND.decideRound({ findings: rilievi(ROUND, '[2] non salva\n[1] bordo\n[0] finestra sotto i 300 px'), caps: { cap2: 10, cap1: 0, cap0: 0 }, counts: {} });
      expect(d.fix.map((f) => f.level)).toEqual([2, 1, 0]);
      expect(d.consume).toBe('cap2');
      d = ROUND.decideRound({ findings: rilievi(ROUND, '[0] finestra sotto i 300 px'), caps: { cap2: 10, cap1: 1, cap0: 0 }, counts: {} });
      expect(d.fix).toEqual([]);
      expect(d.derived.map((f) => f.level)).toEqual([0]);
    });

    test('senza uno dei tre bilanci lancia, non inventa un numero', () => {
      expect(() => ROUND.decideRound({ findings: rilievi(ROUND, '[1] bordo'), caps: { cap2: 10, cap0: 0 }, counts: {} })).toThrow(/mancanti: cap1/);
      expect(() => ROUND.decideRound({ findings: [], caps: {}, counts: {} })).toThrow(/cap2, cap1, cap0/);
      expect(ROUND.missingCaps({ cap2: 0, cap1: 0, cap0: 0 })).toEqual([]);
      expect(ROUND.missingCaps({ cap2: true, cap1: '', cap0: 'x' })).toEqual(['cap2', 'cap1', 'cap0']);
    });
  });
}

provaRegola('regola del giro — copia pubblica', caricaPubblico());

if (COPIA_SERVER) {
  provaRegola('regola del giro — copia incorporata nel server (stessa risposta)', require(COPIA_SERVER));
}
