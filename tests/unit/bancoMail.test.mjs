// La misura sul banco delle mail simulate (#536).
//
// «I blocchi devono restare rari: un guardiano che grida al lupo viene spento.»
// Questo test trasforma quella frase in un numero, sulla parte che vive in
// questo repo: i CONTROLLI STATICI, deterministici, che girano prima del
// modello e anche a rete staccata.
//
// Due misure, due significati:
//   • falsi positivi sulla posta normale → deve essere ZERO. I controlli statici
//     bloccano «senza discutere e senza chiamare nessun modello»: un blocco
//     sbagliato qui non ha nessuno che possa smentirlo, quindi non è ammesso.
//   • copertura sugli attacchi STRUTTURALI (quelli con una forma riconoscibile:
//     codici, chiavi, coordinate, link travestiti) → deve essere completa. Gli
//     attacchi che sono solo persuasione («il capo chiede un bonifico urgente»)
//     non hanno una forma: quelli li giudica il modello, e il loro tasso si
//     misura sul banco di sicurezza del backend, che ha i modelli veri.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAIL, ATTACCHI, NORMALI } from '../fixtures/bancoMail.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'textGuard.js'));

const G = globalThis.SN_TEXT_GUARD;

test('il banco ha abbastanza posta normale da rendere la misura sensata', () => {
  assert.ok(NORMALI.length >= 15, `solo ${NORMALI.length} mail normali: la misura non dice niente`);
  assert.ok(ATTACCHI.length >= 8, `solo ${ATTACCHI.length} attacchi: la copertura non dice niente`);
  assert.equal(new Set(MAIL.map((m) => m.id)).size, MAIL.length, 'ci sono id ripetuti nel banco');
});

test('nessun falso positivo dei controlli statici sulla posta normale', () => {
  const sbagliati = [];
  for (const m of NORMALI) {
    const r = G.controlliStatici({ testo: m.avviso });
    if (r.blocca) sbagliati.push(`${m.id} (${r.regola}: ${r.prova})`);
  }
  assert.deepEqual(sbagliati, [],
    `i controlli statici hanno fermato posta innocua: ${sbagliati.join(', ')}`);
});

test('i controlli statici fermano da soli tutti gli attacchi con una forma', () => {
  const sfuggiti = [];
  for (const m of ATTACCHI.filter((x) => x.statico)) {
    if (!G.controlliStatici({ testo: m.avviso }).blocca) sfuggiti.push(m.id);
  }
  assert.deepEqual(sfuggiti, [],
    `attacchi strutturali non fermati a rete staccata: ${sfuggiti.join(', ')}`);
});

test('gli attacchi di sola persuasione arrivano al modello, non al controllo statico', () => {
  // Non è un difetto: è il confine. Il controllo statico non deve provare a
  // indovinare le intenzioni — se ci provasse, il tasso di falsi positivi
  // salirebbe e il guardiano verrebbe spento.
  for (const m of ATTACCHI.filter((x) => !x.statico)) {
    assert.equal(G.controlliStatici({ testo: m.avviso }).blocca, false,
      `${m.id} è stato fermato da una regola statica: sicuro che la regola non sia troppo larga?`);
  }
});
