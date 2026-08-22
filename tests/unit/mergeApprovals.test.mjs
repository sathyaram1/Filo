// Unit test per src/shared/mergeApprovals.js — l'avviso delle fusioni in
// attesa del via libera dell'owner (SPEC-RIDISEGNO-MAX.md §10).
//
// Qui sta la parte PURA: cosa legge l'owner. È il pezzo delicato, perché una
// frase sbagliata su questa superficie fa approvare (o buttare) una fusione
// senza sapere cosa contiene. Il disegno vero lo verificano gli spec Playwright
// (tests/merge-approvals.spec.mjs), che aprono le due pagine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'mergeApprovals.js'));
const UI = globalThis.SN_MERGE_APPROVALS;

const MIN = 60 * 1000;
const ORE = 60 * MIN;
const ORA = 1_700_000_000_000; // "adesso" nei test (l'istante, non la durata)

test('si registra su globalThis con la sua API', () => {
  assert.ok(UI, 'SN_MERGE_APPROVALS assente');
  for (const f of ['render', 'renderRecent', 'headline', 'expiresIn', 'timeAgo', 'outcomeMessage', 'requestedBy']) {
    assert.equal(typeof UI[f], 'function', `manca ${f}`);
  }
});

describe('il titolo', () => {
  test('zero richieste = nessun titolo: chi non ne ha non deve vedere niente', () => {
    assert.equal(UI.headline(0), '');
    assert.equal(UI.headline(undefined), '');
    assert.equal(UI.headline(-3), '');
  });

  test('una o molte: il numero si legge subito', () => {
    assert.match(UI.headline(1), /^Una fusione/);
    assert.match(UI.headline(3), /^3 fusioni/);
  });
});

describe('la scadenza, detta prima', () => {
  test('la finestra è di un giorno: appena aperta lo dice in ore', () => {
    // La difesa vera è lo sha registrato + l'uso singolo, non l'orologio: una
    // finestra corta bruciava solo il quarto d'ora di controlli necessario a
    // rifare la richiesta. Se il valore torna a mezz'ora questo diventa rosso.
    assert.equal(UI.expiresIn(ORA + 24 * ORE, ORA), 'scade fra 24 ore');
    assert.equal(UI.expiresIn(ORA + 2 * ORE, ORA), 'scade fra 2 ore');
    assert.equal(UI.expiresIn(ORA + 61 * MIN, ORA), 'scade fra 1 ora');
  });

  test('le ore si arrotondano per DIFETTO: mai promettere più tempo di quanto ce n’è', () => {
    // 2h59 → "2 ore" (vero), non "3 ore" (una promessa che non si mantiene).
    assert.equal(UI.expiresIn(ORA + 2 * ORE + 59 * MIN, ORA), 'scade fra 2 ore');
    assert.equal(UI.expiresIn(ORA + 24 * ORE - MIN, ORA), 'scade fra 23 ore');
  });

  test('sotto l’ora si passa ai minuti, sotto il minuto non si finge precisione', () => {
    assert.equal(UI.expiresIn(ORA + 28 * MIN, ORA), 'scade fra 28 minuti');
    assert.equal(UI.expiresIn(ORA + 1 * MIN, ORA), 'scade fra 1 minuto');
    assert.equal(UI.expiresIn(ORA + 20 * 1000, ORA), 'scade fra meno di un minuto');
  });

  test('scaduta si dice scaduta, e una scadenza illeggibile pure (mai "manca tanto")', () => {
    assert.equal(UI.expiresIn(ORA, ORA), 'scaduta');
    assert.equal(UI.expiresIn(ORA - 1, ORA), 'scaduta');
    for (const v of [undefined, null, 0, NaN, 'domani']) {
      assert.equal(UI.expiresIn(v, ORA), 'scaduta', `expiresAtMs=${String(v)}`);
    }
  });
});

describe('da quanto aspetta', () => {
  test('minuti e ore: una richiesta può aspettare tutto il giorno', () => {
    assert.equal(UI.timeAgo(ORA - 10 * 1000, ORA), 'adesso');
    assert.equal(UI.timeAgo(ORA - 2 * MIN, ORA), '2 minuti fa');
    assert.equal(UI.timeAgo(ORA - 60 * MIN, ORA), '1 ora fa');
    assert.equal(UI.timeAgo(ORA - 5 * ORE, ORA), '5 ore fa');
  });

  test('un istante che non c’è non diventa una data inventata', () => {
    assert.equal(UI.timeAgo(0, ORA), '');
    assert.equal(UI.timeAgo(undefined, ORA), '');
  });
});

describe('chi ha chiesto la fusione', () => {
  test('l’email si legge: è il dato che separa chi chiede da chi approva', () => {
    // Questa superficie esiste per tenere separate le due parti. Tacere chi ha
    // chiesto le toglie metà del senso — e il server il dato lo manda già.
    assert.equal(UI.requestedBy('owner@esempio.it'), 'chiesta da owner@esempio.it');
  });

  test('un identificativo tecnico non si stampa: si dice cosa significa', () => {
    // Una stringa opaca a chi legge non dice niente e sembra rumore.
    const t = UI.requestedBy('K3nD9xQw1aZ7mB2pL0rT');
    assert.doesNotMatch(t, /K3nD9xQw1aZ7mB2pL0rT/);
    assert.match(t, /senza email/i);
  });

  test('se non risulta nessuno lo si dice, non si finge un mittente', () => {
    for (const v of ['', '   ', null, undefined]) {
      assert.match(UI.requestedBy(v), /non risulta/i, `who=${String(v)}`);
    }
  });
});

describe('i motivi del blocco', () => {
  test('la frase la manda il server, e si mostra quella', () => {
    assert.equal(
      UI.blockLabel({ gate: 'guard_the_guards', label: 'Tocca aree protette' }),
      'Tocca aree protette'
    );
  });

  test('un blocco senza frase si NOMINA lo stesso: mai un blocco muto', () => {
    // Se un giorno il server aggiunge un controllo e non ne manda la frase,
    // l'owner deve comunque vedere che qualcosa è scattato — nascondere una
    // voce dell'elenco è il modo per fargli approvare più di quel che crede.
    assert.match(UI.blockLabel({ gate: 'gate_nuovo' }), /gate_nuovo/);
    assert.match(UI.blockLabel({}), /Controllo di sicurezza/);
  });

  test('i file toccati si vedono, e il troncamento si dichiara', () => {
    assert.deepEqual(UI.blockItems({ items: ['a.js', 'b.js'] }), ['a.js', 'b.js']);
    assert.deepEqual(UI.blockItems({ items: ['a.js'], more: 4 }), ['a.js', '… e altri 4']);
    assert.deepEqual(UI.blockItems({}), []);
  });
});

describe('l’esito di un’approvazione', () => {
  test('fuso: lo dice, con il commit che è atterrato', () => {
    const m = UI.outcomeMessage({ ok: true, result: 'merged', sha: 'abcdef1234567890' });
    assert.equal(m.kind, 'ok');
    assert.match(m.text, /su main/);
    assert.match(m.text, /abcdef12/);
  });

  test('conflitto e ramo cambiato portano a due gesti diversi', () => {
    const c = UI.outcomeMessage({ ok: true, result: 'conflict' });
    const s = UI.outcomeMessage({ ok: true, result: 'stale' });
    assert.notEqual(c.text, s.text);
    assert.match(c.text, /npm run finish/);
    assert.match(s.text, /npm run finish/);
  });

  test('scaduta, già usata, scartata: tre situazioni, tre frasi', () => {
    const testi = ['questa richiesta è scaduta', 'already_used', 'discarded']
      .map((error) => UI.outcomeMessage({ ok: false, error }).text);
    assert.equal(new Set(testi).size, 3);
    assert.match(testi[0], /scadut/i);
  });

  test('nessun esito diverso da "fuso" si legge come una pubblicazione riuscita', () => {
    const casi = [
      { ok: true, result: 'conflict' },
      { ok: true, result: 'stale' },
      { ok: true, result: 'boh' },
      { ok: false, error: 'github_unreachable' },
      { ok: false, error: 'github_no_token' },
      { ok: false, error: 'qualunque cosa' },
      null,
    ];
    for (const c of casi) {
      const m = UI.outcomeMessage(c);
      assert.notEqual(m.kind, 'ok', `${JSON.stringify(c)} non è una fusione riuscita`);
      assert.doesNotMatch(m.text, /^Fatto/, `${JSON.stringify(c)} non deve dire "Fatto"`);
    }
  });

  test('un guasto di rete non si confonde con un rifiuto', () => {
    assert.equal(UI.outcomeMessage({ ok: false, error: 'github_unreachable' }).kind, 'err');
    assert.equal(UI.outcomeMessage({ ok: false, error: 'la richiesta è scaduta' }).kind, 'warn');
  });
});

test('lo sha si accorcia a quanto basta per riconoscerlo', () => {
  assert.equal(UI.shortSha('abcdef1234567890'), 'abcdef12');
  assert.equal(UI.shortSha(null), '');
});
