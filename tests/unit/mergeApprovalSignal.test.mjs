// Il campanello delle fusioni in attesa — src/main/services/mergeApprovalSignal.js.
//
// COSA DEVE ESSERE VERO
//   Il guasto che questo pezzo chiude: la prima schermata leggeva l'elenco solo
//   quando la si apriva, quindi l'avviso di cui parla il terminale non compariva
//   mai sotto gli occhi di chi lo stava aspettando. Chi apre la richiesta
//   (`npm run finish`) suona un campanello, il main lo sente e avvisa le pagine.
//
//   Le promesse da tenere, e ognuna qui ha il suo test:
//     · chi NON è il proprietario non paga niente — nessuna lettura, nessun
//       avviso: per lui questa parte dell'app non esiste;
//     · niente traffico quando non succede niente: si legge solo se qualcuno
//       suona (o se l'owner rientra nella finestra, non più di una volta ogni
//       cinque minuti);
//     · una raffica di colpi diventa UNA lettura;
//     · se l'elenco non è cambiato le pagine non si toccano (un avviso che si
//       ridisegna sotto le dita, magari con "Confermi?" già armato, è rumore);
//     · chi suona e chi ascolta devono guardare lo STESSO percorso — se
//       divergessero il campanello non suonerebbe e nessuno se ne accorgerebbe.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const S = require(join(ROOT, 'src', 'main', 'services', 'mergeApprovalSignal.js'));

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

function elenco(ids = [], recent = []) {
  return {
    ok: true,
    ttlMs: 24 * 60 * 60 * 1000,
    pending: ids.map((id) => ({ id, branch: 'claude/x' })),
    recent: recent.map((id) => ({ id, outcome: 'merged' })),
  };
}

/** Un finto main: conta le letture e gli avvisi, e dice chi sei. */
function banco({ admin = true, reply = elenco(['a']) } = {}) {
  const stato = { letture: 0, avvisi: [], admin, reply };
  const poker = S.makePoker({
    isAdmin: () => stato.admin,
    read: async () => { stato.letture++; return typeof stato.reply === 'function' ? stato.reply() : stato.reply; },
    broadcast: (m) => stato.avvisi.push(m),
    type: 'merge_approvals_changed',
    focusMinMs: S.FOCUS_MIN_MS,
  });
  return { stato, poker };
}

// ── Dove vive il campanello ─────────────────────────────────────────────────

describe('il percorso: chi suona e chi ascolta devono guardare lo stesso punto', () => {
  test('con una base esplicita il percorso è deterministico', () => {
    const base = join(tmpdir(), 'base-finta');
    assert.equal(S.signalDir(base), join(base, S.DIR_NAME));
    assert.equal(S.signalFile(base), join(base, S.DIR_NAME, S.FILE_NAME));
  });

  test('senza base vince FILO_USER_DATA (i test non si suonano a vicenda)', () => {
    const prima = process.env.FILO_USER_DATA;
    process.env.FILO_USER_DATA = join(tmpdir(), 'userdata-finta');
    try {
      assert.equal(S.signalDir(), join(tmpdir(), 'userdata-finta', S.DIR_NAME));
    } finally {
      if (prima === undefined) delete process.env.FILO_USER_DATA;
      else process.env.FILO_USER_DATA = prima;
    }
  });

  test('fuori dai test è la cartella temporanea: la sola che main e terminale calcolano uguale', () => {
    const prima = process.env.FILO_USER_DATA;
    delete process.env.FILO_USER_DATA;
    try {
      // Elettron e uno script Node lanciato dal terminale non si accordano su
      // "come si chiama l'applicazione", ma su questa sì. Se un giorno qualcuno
      // ci mette una cartella dell'app, il campanello smette di suonare senza
      // che nessuno se ne accorga.
      assert.equal(S.signalDir(), join(tmpdir(), S.DIR_NAME));
    } finally {
      if (prima !== undefined) process.env.FILO_USER_DATA = prima;
    }
  });

  test('suonare scrive, e chi legge ritrova la richiesta', () => {
    const base = mkdtempSync(join(tmpdir(), 'filo-mac-'));
    try {
      assert.equal(S.note('ab12cd34ef56ab12cd34ef56', base), true);
      assert.ok(existsSync(S.signalFile(base)));
      assert.equal(S.readNote(base).id, 'ab12cd34ef56ab12cd34ef56');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('un campanello che non si riesce a scrivere non fa fallire chi lo suona', () => {
    // `npm run finish` non deve morire perché una cartella non è scrivibile:
    // l'avviso si vedrà comunque al rientro nella finestra o riaprendo. Qui la
    // base è un FILE, non una cartella: mkdir non può riuscire.
    const base = mkdtempSync(join(tmpdir(), 'filo-mac-'));
    const finto = join(base, 'non-e-una-cartella');
    try {
      writeFileSync(finto, 'x');
      assert.equal(S.note('ab12cd34ef56ab12cd34ef56', finto), false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ── Chi non è il proprietario non paga niente ───────────────────────────────

describe('per chi non è il proprietario non cambia NIENTE', () => {
  test('nessuna lettura e nessun avviso, nemmeno una chiamata', async () => {
    const { stato, poker } = banco({ admin: false });
    assert.equal(await poker.poke('signal'), 'not_owner');
    assert.equal(await poker.poke('focus'), 'not_owner');
    assert.equal(stato.letture, 0, 'non deve partire nessuna lettura');
    assert.equal(stato.avvisi.length, 0);
  });
});

// ── Quando invece c'è qualcosa ──────────────────────────────────────────────

describe('il campanello suona', () => {
  test('si legge una volta e le pagine ricevono l’elenco già pronto', async () => {
    const { stato, poker } = banco();
    assert.equal(await poker.poke('signal'), 'sent');
    assert.equal(stato.letture, 1);
    assert.equal(stato.avvisi.length, 1);
    // Il dato viaggia col messaggio: dieci schede aperte = una lettura sola,
    // non una per scheda.
    assert.equal(stato.avvisi[0].type, 'merge_approvals_changed');
    assert.equal(stato.avvisi[0].pending.length, 1);
    assert.equal(stato.avvisi[0].ttlMs, 24 * 60 * 60 * 1000);
  });

  test('se l’elenco è identico le pagine non si toccano', async () => {
    const { stato, poker } = banco();
    await poker.poke('signal');
    assert.equal(await poker.poke('signal'), 'unchanged');
    assert.equal(stato.avvisi.length, 1, 'un secondo avviso identico ridisegnerebbe sotto le dita');
  });

  test('quando l’elenco cambia davvero l’avviso riparte', async () => {
    const { stato, poker } = banco();
    await poker.poke('signal');
    stato.reply = elenco(['a', 'b']);
    assert.equal(await poker.poke('signal'), 'sent');
    assert.equal(stato.avvisi.length, 2);
  });

  test('una raffica di colpi diventa una lettura, non dieci', async () => {
    const { stato, poker } = banco();
    await Promise.all([poker.poke('signal'), poker.poke('signal'), poker.poke('signal')]);
    // Uno parte subito, gli altri si fondono in una sola rilettura di coda.
    assert.ok(stato.letture <= 2, `letture=${stato.letture}`);
    assert.equal(stato.avvisi.length, 1);
  });

  test('un server che non risponde non spegne l’avviso e non lancia', async () => {
    const { stato, poker } = banco({ reply: () => { throw new Error('rete giù'); } });
    assert.equal(await poker.poke('signal'), 'unreadable');
    assert.equal(stato.avvisi.length, 0);
  });
});

// ── Il rientro in finestra: rete di sicurezza, non polling ──────────────────

describe('il rientro nella finestra', () => {
  test('è una rete, non un orologio: rilegge di rado', async () => {
    // Il caso vero lo copre il campanello, che non aspetta niente. Questo
    // raccoglie solo ciò che il campanello ha mancato, quindi non deve costare:
    // una giornata di lavoro dentro Filo è piena di rientri nella finestra.
    assert.ok(S.FOCUS_MIN_MS >= 5 * 60 * 1000, 'una rete che costa a ogni rientro non è una rete');
    const { stato, poker } = banco();
    assert.equal(await poker.poke('focus'), 'sent');
    assert.equal(await poker.poke('focus'), 'skipped');
    assert.equal(stato.letture, 1);
  });

  test('il campanello NON aspetta il minuto: è un fatto, non un sospetto', async () => {
    const { stato, poker } = banco();
    await poker.poke('focus');
    stato.reply = elenco(['a', 'b']);
    assert.equal(await poker.poke('signal'), 'sent');
    assert.equal(stato.letture, 2);
  });

  test('senza nessuno che suona o rientra, non parte NIENTE da sola', async () => {
    // Niente orologi: l'owner tiene la home aperta per ore e in quelle ore non
    // deve partire una sola chiamata.
    const { stato } = banco();
    await attendi(60);
    assert.equal(stato.letture, 0);
  });
});

// ── L'ascolto vero, su file veri ────────────────────────────────────────────

test('chi ascolta sente chi suona (file veri, processi diversi)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'filo-mac-'));
  let colpi = 0;
  const stop = S.watchSignal(() => { colpi++; }, { base, debounceMs: 30 });
  try {
    await attendi(80);
    S.note('ab12cd34ef56ab12cd34ef56', base);
    for (let i = 0; i < 60 && colpi === 0; i++) await attendi(50);
    assert.ok(colpi >= 1, 'il campanello non è stato sentito');
  } finally {
    stop();
    rmSync(base, { recursive: true, force: true });
  }
});
