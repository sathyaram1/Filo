// Auto-approvazione per mittente (#446): con l'automatica accesa, l'owner sceglie
// QUALI categorie di mittente entrano in coda da sole.
//
// Questa è la copia lato Filo (serve alla dashboard per mostrare gli
// interruttori); la decisione vera la prende il backend di sicurezza, che ha la
// sua copia in filo-security/functions/src/autoApprove.js. I due file devono
// dire la stessa cosa: gli assert qui sotto sono gli stessi di là.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;

test('il gruppo si ricava dal prefisso del clientId', () => {
  assert.equal(TH.autoApproveGroup('owner:caf22093-385f'), 'owner');
  assert.equal(TH.autoApproveGroup('filo:qualcosa'), 'filo');
  assert.equal(TH.autoApproveGroup('auto:qualcosa'), 'filo');
  assert.equal(TH.autoApproveGroup('routine:prober'), 'claude');
  assert.equal(TH.autoApproveGroup('routine:new-work'), 'claude');
  assert.equal(TH.autoApproveGroup('routine:verifier'), 'claude');
  assert.equal(TH.autoApproveGroup('agent:gemini'), 'claude');
  assert.equal(TH.autoApproveGroup('a1b2c3'), 'user');
  assert.equal(TH.autoApproveGroup(''), 'user');
  assert.equal(TH.autoApproveGroup(undefined), 'user');
});

test('Filo-per-conto-di-un-utente non finisce nel gruppo delle automazioni', () => {
  // Se finissero insieme, spegnere "altri utenti" non basterebbe: contenuto
  // scritto da un utente entrerebbe in coda passando da Filo.
  assert.notEqual(TH.autoApproveGroup('filo:x'), TH.autoApproveGroup('routine:prober'));
});

test('le tre istanze di Claude sono un gruppo solo', () => {
  const g = TH.autoApproveGroup('routine:prober');
  assert.equal(TH.autoApproveGroup('routine:fixer'), g);
  assert.equal(TH.autoApproveGroup('routine:secaudit'), g);
});

// ── La decisione sulla sessione locale, presa apposta ────────────────────────
// Un feedback aperto da una sessione locale ENTRA IN CODA DA SOLO (quando
// l'automatica è accesa e l'interruttore "Claude" è su). È accettabile perché
// il giudizio dei giudici gira comunque — l'auto-approvazione salta
// l'approvazione manuale dell'owner, non i controlli — e perché è una manopola
// che l'owner spegne dalla dashboard quando vuole: un default comodo e
// revocabile, non un privilegio.
//
// Se un giorno la decisione cambia, questo test deve cambiare INSIEME alla
// scelta, non sparire in silenzio. Gemello del test in filo-security
// (functions/test/autoApprove.test.js).
test('sessione locale: entra in coda da sola — DECISIONE, non inerzia', () => {
  assert.equal(TH.autoApproveGroup('local:claude'), 'claude');
  const acceso = { enabled: true, autoApprove: { owner: true, filo: true, claude: true, user: false } };
  assert.equal(TH.autoApproveAllowed('local:claude', acceso), true);
  // …e la manopola che la revoca esiste: è l'interruttore "Claude".
  const spento = { enabled: true, autoApprove: { owner: true, filo: true, claude: false, user: true } };
  assert.equal(TH.autoApproveAllowed('local:claude', spento), false,
    'spegnere il gruppo claude deve fermare anche la sessione locale');
  // E il master spegne tutto, sessione locale compresa.
  assert.equal(TH.autoApproveAllowed('local:claude', { enabled: false, autoApprove: { claude: true } }), false);
});

test('interruttore master spento: nessuno entra in coda da solo', () => {
  const cfg = { enabled: false, autoApprove: { owner: true, filo: true, claude: true, user: true } };
  for (const id of ['owner:x', 'filo:x', 'routine:prober', 'tester']) {
    assert.equal(TH.autoApproveAllowed(id, cfg), false, id);
  }
  assert.equal(TH.autoApproveAllowed('owner:x', undefined), false);
  assert.equal(TH.autoApproveAllowed('owner:x', {}), false);
});

test("l'esempio dell'owner: Filo e Claude sì, utenti no", () => {
  const cfg = { enabled: true, autoApprove: { owner: true, filo: true, claude: true, user: false } };
  assert.equal(TH.autoApproveAllowed('filo:x', cfg), true);
  assert.equal(TH.autoApproveAllowed('routine:new-work', cfg), true);
  assert.equal(TH.autoApproveAllowed('owner:x', cfg), true);
  assert.equal(TH.autoApproveAllowed('un-alpha-tester', cfg), false);
});

test('ogni gruppo si spegne per conto suo senza toccare gli altri', () => {
  const sample = { owner: 'owner:x', filo: 'filo:x', claude: 'routine:fixer', user: 'tester' };
  for (const off of TH.AUTO_APPROVE_GROUPS) {
    const map = {};
    for (const g of TH.AUTO_APPROVE_GROUPS) map[g] = g !== off;
    const cfg = { enabled: true, autoApprove: map };
    for (const g of TH.AUTO_APPROVE_GROUPS) {
      assert.equal(TH.autoApproveAllowed(sample[g], cfg), g !== off, `${g} con ${off} spento`);
    }
  }
});

test('config vecchia senza la mappa: master acceso = tutti ammessi (come prima)', () => {
  const cfg = { enabled: true };
  for (const id of ['owner:x', 'filo:x', 'routine:prober', 'tester']) {
    assert.equal(TH.autoApproveAllowed(id, cfg), true, id);
  }
});
