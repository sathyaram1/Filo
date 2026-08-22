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

// Un mittente d'esempio per ogni gruppo: serve ai test che li esercitano tutti.
const SAMPLE = {
  owner:    'owner:caf22093-385f',
  user:     'un-alpha-tester',
  local:    'local:claude',
  worker:   'routine:new-work',
  verifier: 'routine:verifier',
  residuo:  'routine:residuo',
  prober:   'routine:prober',
  claude:   'agent:gemini',
  filo:     'filo:qualcosa',
};

test('il gruppo si ricava dal prefisso e dal ruolo del clientId', () => {
  assert.equal(TH.autoApproveGroup('owner:caf22093-385f'), 'owner');
  assert.equal(TH.autoApproveGroup('filo:qualcosa'), 'filo');
  assert.equal(TH.autoApproveGroup('auto:qualcosa'), 'filo');
  assert.equal(TH.autoApproveGroup('routine:prober'), 'prober');
  assert.equal(TH.autoApproveGroup('routine:new-work'), 'worker');
  assert.equal(TH.autoApproveGroup('routine:fixer'), 'worker');
  assert.equal(TH.autoApproveGroup('routine:verifier'), 'verifier');
  assert.equal(TH.autoApproveGroup('routine:secaudit'), 'verifier');
  assert.equal(TH.autoApproveGroup('routine:residuo'), 'residuo');
  assert.equal(TH.autoApproveGroup('local:claude'), 'local');
  // Ruolo non dichiarato (automazioni storiche): gruppo suo, non uno degli altri.
  assert.equal(TH.autoApproveGroup('agent:gemini'), 'claude');
  assert.equal(TH.autoApproveGroup('routine:'), 'claude');
  assert.equal(TH.autoApproveGroup('a1b2c3'), 'user');
  assert.equal(TH.autoApproveGroup(''), 'user');
  assert.equal(TH.autoApproveGroup(undefined), 'user');
});

test('il gruppo di fiducia è la stessa categoria che la dashboard mostra come icona', () => {
  // I due assi coincidono: se la coda distingue cinque istanze di Claude con
  // cinque icone, l'owner le deve poter regolare separatamente.
  for (const id of Object.values(SAMPLE)) {
    assert.equal(TH.autoApproveGroup(id), TH.authorKind(id), id);
  }
});

test('Filo-per-conto-di-un-utente non finisce nel gruppo delle automazioni', () => {
  // Se finissero insieme, spegnere "altri utenti" non basterebbe: contenuto
  // scritto da un utente entrerebbe in coda passando da Filo.
  assert.notEqual(TH.autoApproveGroup('filo:x'), TH.autoApproveGroup('routine:prober'));
});

test('ogni istanza di Claude ha il suo interruttore', () => {
  const gruppi = new Set([
    TH.autoApproveGroup('local:claude'),
    TH.autoApproveGroup('routine:fixer'),
    TH.autoApproveGroup('routine:secaudit'),
    TH.autoApproveGroup('routine:residuo'),
    TH.autoApproveGroup('routine:prober'),
  ]);
  assert.equal(gruppi.size, 5, 'cinque istanze distinte, cinque gruppi distinti');
});

// ── La sessione locale ha una manopola sua ───────────────────────────────────
// Un feedback aperto da una sessione locale ENTRA IN CODA DA SOLO quando
// l'automatica è accesa e il suo interruttore è su: il giudizio dei giudici gira
// comunque — l'auto-approvazione salta l'approvazione manuale dell'owner, non i
// controlli — ed è una manopola revocabile, non un privilegio.
// Gemello del test in filo-security (functions/test/autoApprove.test.js).
test('sessione locale: interruttore proprio, indipendente dalle automazioni in cloud', () => {
  const acceso = { enabled: true, autoApprove: { local: true, prober: false } };
  assert.equal(TH.autoApproveAllowed('local:claude', acceso), true);
  assert.equal(TH.autoApproveAllowed('routine:prober', acceso), false,
    "spegnere l'esploratore non deve toccare la sessione locale");

  const spento = { enabled: true, autoApprove: { local: false, prober: true } };
  assert.equal(TH.autoApproveAllowed('local:claude', spento), false);
  assert.equal(TH.autoApproveAllowed('routine:prober', spento), true);

  // E il master spegne tutto, sessione locale compresa.
  assert.equal(TH.autoApproveAllowed('local:claude', { enabled: false, autoApprove: { local: true } }), false);
});

test('interruttore master spento: nessuno entra in coda da solo', () => {
  const map = {};
  for (const g of TH.AUTO_APPROVE_GROUPS) map[g] = true;
  const cfg = { enabled: false, autoApprove: map };
  for (const id of Object.values(SAMPLE)) {
    assert.equal(TH.autoApproveAllowed(id, cfg), false, id);
  }
  assert.equal(TH.autoApproveAllowed('owner:x', undefined), false);
  assert.equal(TH.autoApproveAllowed('owner:x', {}), false);
});

test('ogni gruppo si spegne per conto suo senza toccare gli altri', () => {
  for (const off of TH.AUTO_APPROVE_GROUPS) {
    const map = {};
    for (const g of TH.AUTO_APPROVE_GROUPS) map[g] = g !== off;
    const cfg = { enabled: true, autoApprove: map };
    for (const g of TH.AUTO_APPROVE_GROUPS) {
      assert.equal(TH.autoApproveAllowed(SAMPLE[g], cfg), g !== off, `${g} con ${off} spento`);
    }
  }
});

test('config vecchia senza la mappa: master acceso = tutti ammessi (come prima)', () => {
  const cfg = { enabled: true };
  for (const id of Object.values(SAMPLE)) {
    assert.equal(TH.autoApproveAllowed(id, cfg), true, id);
  }
});

// ── Il ripiego sul vecchio interruttore unico ────────────────────────────────
// Prima di oggi le istanze di Claude stavano dietro un interruttore solo. Un
// documento salvato allora ha il solo `claude`: se quel "no" non venisse
// ereditato, sdoppiare gli interruttori riaprirebbe da solo cinque porte che
// l'owner aveva chiuso.
test('mappa vecchia con Claude spento: restano spente tutte le sue istanze', () => {
  const cfg = { enabled: true, autoApprove: { owner: true, filo: true, claude: false, user: true } };
  for (const g of TH.CLAUDE_GROUPS) {
    assert.equal(TH.autoApproveAllowed(SAMPLE[g], cfg), false, `${g} deve ereditare il vecchio "no"`);
  }
  // …e non trascina con sé chi non è un'automazione.
  assert.equal(TH.autoApproveAllowed('owner:x', cfg), true);
  assert.equal(TH.autoApproveAllowed('filo:x', cfg), true);
  assert.equal(TH.autoApproveAllowed('un-alpha-tester', cfg), true);
});

test('mappa vecchia con Claude acceso: tutte le istanze ammesse', () => {
  const cfg = { enabled: true, autoApprove: { owner: true, filo: true, claude: true, user: false } };
  for (const g of TH.CLAUDE_GROUPS) {
    assert.equal(TH.autoApproveAllowed(SAMPLE[g], cfg), true, g);
  }
  assert.equal(TH.autoApproveAllowed('un-alpha-tester', cfg), false);
});

test('una scelta esplicita batte il ripiego sul vecchio interruttore', () => {
  const cfg = { enabled: true, autoApprove: { claude: false, local: true } };
  assert.equal(TH.autoApproveAllowed('local:claude', cfg), true);
  assert.equal(TH.autoApproveAllowed('routine:prober', cfg), false);
});

test('resolveAutoApprove riempie tutti i gruppi, e senza mappa non inventa niente', () => {
  const piena = TH.resolveAutoApprove({ claude: false });
  assert.deepEqual(Object.keys(piena).sort(), [...TH.AUTO_APPROVE_GROUPS].sort());
  assert.equal(TH.resolveAutoApprove(null), null);
  assert.equal(TH.resolveAutoApprove(undefined), null);
});
