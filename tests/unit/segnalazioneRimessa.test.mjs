// Il testo di una segnalazione buttata dalla coda perché non si può cifrare torna al riquadro dei feedback (#602.1), e
// chi allega più file di fila legge quali sono saliti e quali no. Logica pura, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../src/main/services/segnalazioneRimessa.js');
require('../../src/shared/filoUi.js');
require('../../src/shared/feedback.js');
const UI = globalThis.SN_FILO_UI;
const F = globalThis.SN_FEEDBACK;

function chiaveNellaPagina(url) {
  const prima = globalThis.location;
  try {
    const u = new URL(url);
    globalThis.location = { protocol: u.protocol, origin: u.protocol === 'filo:' ? `filo://${u.host}` : u.origin };
    return UI.chiaveDiBozza(R.CHIAVE);
  } finally {
    globalThis.location = prima;
  }
}

test('la chiave scritta dal main è quella che il riquadro di quel sito legge', () => {
  for (const url of ['https://sito.example/a/b?c=1', 'http://localhost:8080/x', 'filo://newtab/', 'filo://board/board.html']) {
    assert.equal(R.chiaveRimessa(url), chiaveNellaPagina(url), url);
  }
  assert.equal(R.chiaveRimessa('https://sito.example/x'), 'sn_feedback_rimessa@https://sito.example');
  for (const senza of ['data:text/html,x', 'about:blank', '', null, 'non un indirizzo']) assert.equal(R.chiaveRimessa(senza), null, String(senza));
});

test('il testo si accoda una volta sola, e la bozza che c\'era resta', () => {
  assert.equal(R.accoda('', 'il tasto non va'), 'il tasto non va');
  assert.equal(R.accoda('altra cosa', 'il tasto non va'), 'altra cosa\n\nil tasto non va');
  assert.equal(R.accoda('altra cosa\n\nil tasto non va', 'il tasto non va'), 'altra cosa\n\nil tasto non va');
  assert.equal(R.accoda('x', '   '), 'x');
});

test('rimetti scrive dove il riquadro guarda, senza doppioni a ogni nuovo avviso', async () => {
  const dati = {};
  const storage = { get: async (k) => Object.fromEntries(k.map((x) => [x, dati[x]])), set: async (o) => Object.assign(dati, o) };
  const payload = { text: 'Il menu si chiude da solo 😕 <b>sempre</b>', url: 'https://sito.example/p', images: [{ name: 'a.png' }] };
  assert.equal(await R.rimetti(payload, storage), true);
  assert.equal(await R.rimetti(payload, storage), true);
  assert.deepEqual(dati, { 'sn_feedback_rimessa@https://sito.example': payload.text });
  assert.equal(await R.rimetti({ text: '  ', url: 'https://sito.example/p' }, storage), false);
  assert.equal(await R.rimetti({ text: 'x', url: 'data:text/html,x' }, storage), false);
  assert.equal(await R.rimetti(null, storage), false);
});

test('l\'avviso dice dove ritrovare il testo, e che gli allegati vanno rimessi', () => {
  assert.equal(R.fraseRimessa({ text: 'x', url: 'https://sito.example/p' }),
    'Quello che avevi scritto è di nuovo nel riquadro dei feedback su sito.example, pronto da rimandare.');
  assert.match(R.fraseRimessa({ text: 'x', url: 'filo://newtab/', files: [{}] }), /riquadro dei feedback, pronto da rimandare\. Gli allegati vanno rimessi\.$/);
  assert.equal(R.fraseRimessa({ text: '', url: 'https://sito.example/p' }), '');
  assert.equal(R.fraseRimessa({ text: 'x', url: 'about:blank' }), '');
});

test('più file di fila: la frase nomina i file che mancano e quelli allegati', () => {
  assert.equal(F.encryptionBlockedForFiles('manca la chiave con cui si cifra', ['b.png', 'c.pdf'], ['a.png']),
    'Non ho allegato «b.png» e «c.pdf»: manca la chiave con cui si cifra. Senza cifratura quel contenuto lo può leggere chiunque. «a.png» invece è allegato.');
  assert.match(F.encryptionBlockedForFiles('x', ['c.png'], ['a.png', 'b.png']), /«a\.png» e «b\.png» invece sono allegati\.$/);
  assert.doesNotMatch(F.encryptionBlockedForFiles('x', ['a.png'], []), /invece|niente/);
});

test('l\'errore di cifratura porta il motivo da solo, e la frase di sempre', async () => {
  const prima = globalThis.SN_FEEDBACK_CRYPTO;
  globalThis.SN_FEEDBACK_CRYPTO = { isEnabled: () => true, hasPublicKey: () => false };
  try {
    const e = await F.uploadAttachment(new Blob(['x'], { type: 'image/png' }), 'a.png').then(() => null, (err) => err);
    assert.ok(e, 'doveva rifiutare');
    assert.equal(F.isEncryptionError(e), true);
    assert.equal(e.motivo, 'manca la chiave con cui si cifra');
    assert.equal(e.message, F.encryptionBlockedMessage('manca la chiave con cui si cifra'));
  } finally {
    globalThis.SN_FEEDBACK_CRYPTO = prima;
  }
});

// #1337 giro 7: la regola dell'accodare vive in SN_FEEDBACK, e il main e il riquadro la usano tutti e due.
test('il main e il riquadro accodano con la stessa regola', async () => {
  for (const [prima, testo] of [['', 'a'], ['b', 'a'], ['b\n\na', 'a'], ['x', '  '], [null, 'a']]) {
    assert.equal(R.accoda(prima, testo), F.accodaTesto(prima, testo), `${prima} + ${testo}`);
  }
  const { readFileSync } = await import('node:fs');
  const riquadro = readFileSync(new URL('../../src/content/feedback.js', import.meta.url), 'utf8');
  assert.match(riquadro, /Feedback\.accodaTesto\(/, 'il riquadro accoda con una regola sua');
});

test('dopo un giorno di tentativi l\'avviso dice che non è partita e dove ritrovare il testo', async () => {
  assert.equal(R.fraseScaduta({ text: 'x', url: 'https://sito.example/p' }),
    'La tua segnalazione non è partita: per un giorno Filo non è riuscito a mandarla. Quello che avevi scritto è di nuovo nel riquadro dei feedback su sito.example, pronto da rimandare.');
  assert.equal(R.fraseScaduta({ text: '', url: 'about:blank' }), 'La tua segnalazione non è partita: per un giorno Filo non è riuscito a mandarla.');
  const { readFileSync } = await import('node:fs');
  const misc = readFileSync(new URL('../../src/main/services/handlers/misc.js', import.meta.url), 'utf8');
  const blocco = /onScaduta:\s*\(item\)\s*=>\s*\{([\s\S]*?)\n {6}\},/.exec(misc);
  assert.ok(blocco, 'onScaduta non trovato');
  assert.match(blocco[1], /Rimessa\.rimetti\(item\?\.payload\)/, 'il testo scaduto non torna nel riquadro');
  assert.match(blocco[1], /avvisoNellaFinestra\(Rimessa\.fraseScaduta\(item\?\.payload\)/, 'nessun avviso dice dove ritrovarlo');
});
