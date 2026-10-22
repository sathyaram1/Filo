// Sentinella sulle regole Firestore (#1516): chi non è admin crea solo feedback aperti.
// Un feedback nato 'closed' accendeva la redazione del server alla prima scrittura, una chiamata al modello senza tetto.
// Sentinella sul testo e non sulle regole vere: vedi firestoreRulesPaths.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const senzaCommenti = (s) => s.replace(/\/\/[^\n]*/g, '');

function bloccoFeedback() {
  const inizio = RULES.indexOf('match /feedback/{doc}');
  assert.ok(inizio >= 0, 'manca il match di /feedback');
  return senzaCommenti(RULES.slice(inizio, RULES.indexOf('match /', inizio + 1)));
}

function regola(tipo, filtro) {
  const pezzi = bloccoFeedback().split(`allow ${tipo}:`).slice(1).map((c) => c.slice(0, c.indexOf(';')));
  const trovata = pezzi.find(filtro);
  assert.ok(trovata, `manca la regola ${tipo} cercata in /feedback`);
  return trovata;
}

const createAnonima = () => regola('create', (c) => c.includes('hasOnly') && c.includes("'statusPublic'") && !/^\s*isAdmin\(\)/.test(c));

test('feedback: la create non admin ammette statusPublic solo assente o aperto', () => {
  const create = createAnonima();
  assert.match(create, /request\.resource\.data\.get\('statusPublic',\s*'open'\)\s*==\s*'open'/,
    'statusPublic assente vale aperto, e l\'unico valore ammesso è aperto');
  assert.doesNotMatch(create, /'closed'|'pending-approval'/,
    'chiuso e in attesa di approvazione restano al ramo admin e all\'Admin SDK');
});

test('feedback: il documento che l\'app spedisce resta ammesso', () => {
  assert.match(createAnonima(), /'statusPublic'/, 'la chiave resta fra quelle ammesse alla nascita');
  const app = readFileSync(join(ROOT, 'src', 'shared', 'feedback.js'), 'utf8');
  assert.match(app, /statusPublic:\s*toFsValue\('open'\)/, 'l\'app crea il feedback con statusPublic aperto');
  assert.doesNotMatch(app, /statusPublic:\s*toFsValue\('(closed|pending-approval)'\)/, 'nessuna nascita chiusa dall\'app');
});

test('feedback: l\'admin continua a chiudere', () => {
  const update = regola('update', (c) => /^\s*isAdmin\(\)/.test(c) && c.includes("'statusPublic'"));
  assert.match(update, /get\('statusPublic',\s*'open'\)\s*in\s*\['open',\s*'closed',\s*'pending-approval'\]/,
    'il triage admin scrive ancora chiuso e in attesa di approvazione');
});
