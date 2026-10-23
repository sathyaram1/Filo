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
  // La Bacheca segue il suo interruttore (#1592); in pausa, al suo posto, le segnalazioni che l'utente ha mandato.
  assert.match(perTutti, /inPausaVisibili\.bacheca\s*\?\s*\{ label: 'Bacheca'[^}]*\}\s*:\s*\{ label: 'Le tue segnalazioni'[^}]*#segnalazioni/,
    'con la Bacheca in pausa le segnalazioni mandate devono restare raggiungibili dal menu App');
  assert.match(perTutti, /inPausaVisibili\.mazzi\s*\?\s*\[\{ label: 'Deck builder MTG'/,
    'il Deck builder segue il suo interruttore');
});

test('l\'icona «Feedback» della barra laterale esiste solo per l\'owner', () => {
  // Le icone stanno nella barra (#1246): la disegna e la esegue il main, che sa chi è l'owner.
  const disp = leggi('src', 'shared', 'disposizioneIcone.js');
  assert.match(disp, /feedbackApp: \{[^}]*soloOwner: true/, 'feedbackApp deve dichiararsi del solo owner');
  const barra = leggi('src', 'main', 'barraLaterale.js');
  assert.match(barra, /_icone\(\) \{[\s\S]{0,900}?if \(!d \|\| \(d\.soloOwner && !owner\)\) continue;/,
    'la barra non deve disegnare un\'icona del solo owner a chi non lo è');
  assert.match(barra, /esegui\(id[^\n]*\{\n[\s\S]{0,400}?if \(d\.soloOwner && !this\._owner\(\)\) return;/,
    'né eseguirla: un clic arrivato lo stesso non apre la posta delle segnalazioni');
  assert.match(barra, /_owner\(\) \{\s*try \{ return !!require\('\.\/auth\/google-auth'\)\.isAdmin\(\); \} catch \(_\) \{ return false; \}/,
    'lo stato di owner lo dice l\'accesso, e nel dubbio è «non owner»');
});

test('il comando /feedback della home è riservato all\'owner e dice l\'altra strada', () => {
  // I comandi con lo slash vivono accanto alla home, in dashboard-comandi.js.
  const dash = leggi('src', 'pages', 'dashboard', 'dashboard-comandi.js');
  const handler = dash.match(/'\/feedback':\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n    \},/)?.[1];
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

// #1414: le pagine dell'owner si raggiungono da Gestione e basta. Un'altra voce di menu che porta lì è un secondo
// ingresso, e il vecchio indirizzo scritto in un menu è una strada che passa dal rimando invece di dire dov'è la cosa.
test('Modelli predefiniti e Inviti e utenti non hanno ingressi fuori da Gestione', () => {
  const shell = leggi('src', 'renderer', 'shell.js');
  const impostazioni = shell.match(/function buildSettings\(\)\s*\{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(impostazioni, 'non trovo buildSettings() in shell.js');
  assert.ok(!/isAdmin/.test(impostazioni), 'il menu Impostazioni torna a distinguere l\'owner: le sue voci stanno in Gestione');
  const vecchi = /filo:\/\/admin-defaults\/|filo:\/\/credits\/owner\.html/;
  for (const file of [['src', 'renderer', 'shell.js'], ['src', 'main', 'menu.js'], ['src', 'main', 'barraLaterale.js'],
    ['src', 'pages', 'dashboard', 'dashboard.js'], ['src', 'shared', 'wallet.js'], ['src', 'pages', 'credits', 'credits.html']]) {
    assert.ok(!vecchi.test(leggi(...file)), `${file.join('/')} porta ancora al vecchio indirizzo di una pagina dell'owner`);
  }
});
