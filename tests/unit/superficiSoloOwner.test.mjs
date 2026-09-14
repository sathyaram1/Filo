// Le superfici dell'OWNER non si annunciano a chi non le può aprire (#583).
//
// Da quando i feedback li legge solo chi li gestisce, «Feedback» (la posta
// delle segnalazioni) e «Gestione» aprono, per chiunque altro, una pagina che
// non ha niente da mostrare e un invito ad accedere come amministratore che non
// porta da nessuna parte: amministratori non si diventa accedendo, l'elenco lo
// tiene la console. Prima del giro di verifica erano annunciate a tutti da tre
// strade — il menu App della home, l'icona del menu del tasto destro, il
// comando /feedback in chat — e tutte e tre finivano lì.
//
// Questa è una sentinella sul CODICE, come quella del manifesto delle capacità
// accanto: gira in millisecondi e diventa rossa se una delle tre porte torna
// aperta a tutti. Le prove del comportamento stanno in
// tests/feedback-superfici-owner.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('il menu App mostra Feedback e Gestione solo all\'owner', () => {
  const shell = leggi('src', 'renderer', 'shell.js');
  const corpo = shell.match(/function buildApps\(\)\s*\{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(corpo, 'non trovo buildApps() in shell.js: il menu App è tornato una lista fissa?');

  const taglio = corpo.indexOf('if (isAdmin)');
  assert.ok(taglio > 0, 'buildApps() non distingue più l\'owner: le voci riservate sarebbero visibili a tutti');
  const perTutti = corpo.slice(0, taglio);

  for (const riservata of ['Feedback', 'Gestione']) {
    assert.ok(!new RegExp(`label: '${riservata}'`).test(perTutti),
      `«${riservata}» apre una pagina che solo l'owner può leggere: non va nel ramo visibile a tutti`);
  }
  // E la bacheca, che invece è di tutti, deve restarci.
  assert.match(perTutti, /label: 'Bacheca'/,
    'la bacheca è la superficie pubblica dei miglioramenti: non va nascosta');
});

test('l\'icona «Feedback» del menu del tasto destro esiste solo per l\'owner', () => {
  const icons = leggi('src', 'content', 'menuIcons.js');
  assert.match(icons, /if \(isOwner\)\s*\{[\s\S]{0,400}?registry\.feedbackApp/,
    'feedbackApp deve entrare nel registro solo con isOwner: un id assente dal registro '
    + 'sparisce anche dai layout che l\'utente si era salvato');
  assert.match(icons, /MSG\.AUTH_STATUS/,
    'lo stato di owner va CHIESTO al main: senza, resterebbe un valore inventato in pagina');
  assert.match(icons, /let isOwner = false;/,
    'deve partire da "non owner": sbagliare per difetto costa un\'icona a una persona, '
    + 'sbagliare per eccesso manda tutti gli altri in un vicolo cieco');
});

test('il comando /feedback della home è riservato all\'owner e dice l\'altra strada', () => {
  const dash = leggi('src', 'pages', 'dashboard', 'dashboard.js');
  const handler = dash.match(/'\/feedback':\s*\(\)\s*=>\s*\{([\s\S]*?)\n    \},/)?.[1];
  assert.ok(handler, 'non trovo il comando /feedback nella home');
  assert.match(handler, /if \(!isOwner\)/, '/feedback aprirebbe la posta a chiunque');
  assert.match(handler, /Invia feedback/,
    'a chi non la può aprire va detta la strada che funziona: mandare un feedback si può sempre');
  // L'elenco di /help non promette il comando a chi non lo ha.
  const help = dash.match(/'\/help':[\s\S]*?\n    \},/)?.[0] || '';
  const taglio = help.indexOf('if (isOwner)');
  assert.ok(taglio > 0, '/help non distingue più l\'owner');
  assert.ok(!help.slice(0, taglio).includes('/feedback —'),
    '/help elenca /feedback a tutti: è una promessa che per quasi tutti non si avvera');
});

test('mandare un feedback resta una strada di tutti', () => {
  // La correzione toglie le superfici di LETTURA, non l\'invio: se sparisse
  // anche quello, l'alpha smetterebbe di ricevere segnalazioni.
  const content = leggi('src', 'content', 'content.js');
  assert.match(content, /label: 'Invia feedback'/,
    'la voce «Invia feedback» del menu del tasto destro è l\'unica strada per mandarne uno');
  assert.ok(!/isOwner|isAdmin/.test(content.match(/function buildFeedbackItem\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || ''),
    '«Invia feedback» non deve dipendere da chi sei: l\'invio è anonimo per scelta');

  const cap = leggi('src', 'shared', 'capabilities.js');
  const voce = cap.match(/id: 'feedback',[\s\S]*?\n    \},/)?.[0] || '';
  assert.ok(voce, 'non trovo la capacità "feedback" nel manifesto');
  assert.match(voce, /Invia feedback/,
    'il manifesto deve indicare la strada che funziona per un utente qualunque');
  assert.ok(!voce.includes('filo://feedback/feedback.html'),
    'il manifesto mandava l\'utente alla posta dell\'owner, che lui non può aprire');
});
