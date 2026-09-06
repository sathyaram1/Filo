// Unit test per #422 — il contesto FISSO dei prompt lunghi deve stare PER PRIMO,
// così i fornitori riconoscono che l'inizio della richiesta è identico a una
// precedente e non lo ri-elaborano né lo rifatturano (prompt caching).
//
// Il riuso vale SOLO sul prefisso: basta una riga variabile in testa (il nome
// del modello che esegue, l'ora dentro STATO) perché tutto il blocco di
// istruzioni venga ricalcolato a ogni messaggio. Prima del fix il prefisso
// condiviso fra due richieste della chat era di ~150 caratteri su ~26.000
// (0,6%): l'intero manuale di istruzioni veniva ripagato ogni volta.
//
// Invarianti verificati qui (niente Electron, niente rete):
//   1. due richieste con contesto DIVERSO condividono un prefisso lungo — cioè
//      la parte immutabile è davvero in testa;
//   2. la parte statica non contiene NULLA di variabile (nome del modello,
//      profilo, stato, pagina, mazzo): se ci finisse, il riuso morirebbe;
//   3. il contenuto non è andato perso nel riordino: tutte le sezioni ci sono
//      ancora e i dati variabili sono comunque nel prompt completo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));

const C = globalThis.SN_CONST;
const CAPS = globalThis.SN_CAPABILITIES.renderIndexForPrompt();

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// --- Chat della home (FILO_CHAT) --------------------------------------------

const chatA = {
  capacita: CAPS,
  modelName: 'gemini-3.1-flash-lite',
  profilo: 'Si chiama Mario, sviluppatore.',
  preferenze: 'Risposte brevi.',
  lezioni: 'Preferisce il tema scuro.',
  stato: 'TEMPO: 10:04 di martedì. SCHEDE: 3 aperte.',
  files: '[f-1] Appunti: spesa e idee',
};
const chatB = {
  capacita: CAPS,
  // Il modello cambia davvero fra una richiesta e l'altra quando scatta il
  // ripiego sul fornitore di scorta: se resta in testa, rompe il riuso.
  modelName: 'google/gemini-2.0-flash-001',
  profilo: 'Si chiama Anna, insegnante.',
  preferenze: '(vuoto)',
  stato: 'TEMPO: 23:41 di sabato. SCHEDE: 27 aperte.',
  files: '(nessuno)',
};

test('chat della home: due richieste diverse condividono tutto il blocco di istruzioni', () => {
  const a = C.PROMPTS.filoChat(chatA);
  const b = C.PROMPTS.filoChat(chatB);
  const shared = commonPrefixLen(a, b);
  // La parte statica è davvero il PREFISSO di entrambe le richieste (il pezzo
  // condiviso può essere anche più lungo: le prime lettere del contesto a volte
  // coincidono, ed è un di più).
  const staticLen = C.PROMPTS.filoChatStatic(chatA).length;
  assert.ok(a.startsWith(C.PROMPTS.filoChatStatic(chatA)), 'la parte fissa non apre il prompt');
  assert.ok(b.startsWith(C.PROMPTS.filoChatStatic(chatB)), 'la parte fissa non apre il prompt');
  assert.ok(shared >= staticLen, `condiviso ${shared} < parte fissa ${staticLen}`);
  // …che è la stragrande maggioranza del prompt (prima del fix: 0,6%).
  assert.ok(shared / a.length > 0.85, `prefisso condiviso troppo corto: ${(100 * shared / a.length).toFixed(1)}%`);
  assert.ok(shared > 5000, `prefisso condiviso di soli ${shared} caratteri`);
});

test('chat della home: nella parte fissa non finisce nulla di variabile', () => {
  const s = C.PROMPTS.filoChatStatic(chatA);
  for (const leak of ['gemini-3.1-flash-lite', 'Mario', 'Risposte brevi', '10:04', 'f-1']) {
    assert.ok(!s.includes(leak), `la parte fissa contiene un dato variabile: ${leak}`);
  }
  // La parte fissa è il manuale: istruzioni, capacità, come si lavora con le
  // azioni (che sono strumenti nativi, non più un JSON nel testo), tono.
  for (const section of ['COME RISPONDI', 'CLASSIFICAZIONE INTENTO', 'COSA SA FARE FILO', 'COME LAVORI', 'TONO E STILE']) {
    assert.ok(s.includes(section), `manca dalla parte fissa: ${section}`);
  }
  for (const gone of ['FORMATO OUTPUT', '"actions"', 'AZIONI DISPONIBILI']) {
    assert.ok(!s.includes(gone), `il prompt descrive ancora il formato JSON: ${gone}`);
  }
});

test('chat della home: il riordino non ha perso informazioni', () => {
  const p = C.PROMPTS.filoChat(chatA);
  for (const data of ['gemini-3.1-flash-lite', 'Si chiama Mario', 'Risposte brevi', 'TEMPO: 10:04', '[f-1] Appunti']) {
    assert.ok(p.includes(data), `il prompt completo non contiene più: ${data}`);
  }
  for (const section of ['PROFILO UTENTE:', 'PREFERENZE:', 'LEZIONI RECENTI:', 'STATO:', "FILE DELL'EDITOR"]) {
    assert.ok(p.includes(section), `manca la sezione: ${section}`);
  }
  // I rimandi interni non devono più mandare il modello a cercare "sopra" un
  // blocco che ora sta sotto.
  assert.ok(!/STATO sopra/.test(p), 'rimando posizionale rimasto indietro: "STATO sopra"');
  assert.ok(!/PREFERENZE qui sopra/.test(p), 'rimando posizionale rimasto indietro: "qui sopra"');
});

// --- Agente Aiuto (HELP) -----------------------------------------------------

const helpA = { url: 'https://esempio.it/ordini', title: 'Ordini', outline: '✓ bottone "Vedi ordini"', viewport: { scrollY: 0, maxScrollY: 900, width: 1280, height: 800, docHeight: 1700 } };
const helpB = { url: 'https://altro.it/account', title: 'Account', outline: '✓ link "Impostazioni"', siteKnowledge: 'llms.txt del sito' };

test('agente Aiuto: il protocollo sta in testa, la pagina in fondo', () => {
  const a = C.PROMPTS.help(helpA);
  const b = C.PROMPTS.help(helpB);
  const shared = commonPrefixLen(a, b);
  assert.ok(a.startsWith(C.PROMPTS.helpStatic()), 'la parte fissa non apre il prompt');
  assert.ok(shared >= C.PROMPTS.helpStatic().length);
  assert.ok(shared / a.length > 0.85, `prefisso condiviso troppo corto: ${(100 * shared / a.length).toFixed(1)}%`);

  const s = C.PROMPTS.helpStatic();
  for (const leak of ['esempio.it', 'Ordini', 'Vedi ordini', 'scroll=0']) {
    assert.ok(!s.includes(leak), `la parte fissa contiene un dato della pagina: ${leak}`);
  }
  // E il contenuto c'è ancora tutto nel prompt completo.
  for (const data of ['https://esempio.it/ordini', 'Ordini', 'Vedi ordini', 'scroll=0/900px']) {
    assert.ok(a.includes(data), `il prompt completo non contiene più: ${data}`);
  }
  assert.ok(a.includes('Protocollo di risposta'), 'manca il protocollo');
  // La regola anti prompt-injection resta, e viene richiamata DOPO il contenuto
  // del sito (che ora sta in fondo).
  assert.ok(a.includes('prompt injection'), 'persa la regola di sicurezza');
  assert.ok(a.lastIndexOf('non ordini') > a.indexOf('Outline interattivo'), 'manca il richiamo dopo il contenuto del sito');
});

// --- Chat del deck builder ---------------------------------------------------

test('deck builder: le regole stanno in testa, il mazzo in fondo', () => {
  // Nomi che NON compaiono negli esempi delle regole, così un "leak" nella
  // parte fissa sarebbe davvero un dato del mazzo e non un esempio.
  const a = C.PROMPTS.decksChat({ deckName: 'Mazzo blu di prova', commanderName: 'Talrand, Sky Summoner', identity: 'U', deckCards: 'Counterspell — controllo' });
  const b = C.PROMPTS.decksChat({ deckName: 'Mazzo verde', commanderName: 'Azusa, Lost but Seeking', identity: 'G', deckCards: 'Cultivate — ramp' });
  const shared = commonPrefixLen(a, b);
  assert.ok(a.startsWith(C.PROMPTS.decksChatStatic()), 'la parte fissa non apre il prompt');
  assert.ok(shared >= C.PROMPTS.decksChatStatic().length);
  assert.ok(shared / a.length > 0.7, `prefisso condiviso troppo corto: ${(100 * shared / a.length).toFixed(1)}%`);

  const s = C.PROMPTS.decksChatStatic();
  for (const leak of ['Talrand', 'Counterspell', 'Mazzo blu di prova']) {
    assert.ok(!s.includes(leak), `la parte fissa contiene un dato del mazzo: ${leak}`);
  }
  for (const data of ['MAZZO CORRENTE: "Mazzo blu di prova"', 'Talrand, Sky Summoner', 'Counterspell — controllo']) {
    assert.ok(a.includes(data), `il prompt completo non contiene più: ${data}`);
  }
});
