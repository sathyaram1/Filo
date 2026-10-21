// I dizionari del correttore nativo viaggiano con Filo (#1084): si copiano dove Chromium li cerca, e lo scaricamento
// da Google punta a un indirizzo file:// per ogni sessione. Il dizionario italiano è GPL: sorgenti e licenza accanto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const D = require('../../src/main/services/dizionari.js');

function finta(dati) {
  const app = new EventEmitter();
  app.getPath = (n) => { assert.equal(n, 'sessionData'); return dati; };
  return app;
}
function sessione() {
  const ses = new EventEmitter();
  ses.url = [];
  ses.setSpellCheckerDictionaryDownloadURL = (u) => ses.url.push(u);
  return ses;
}

test('Filo porta con sé italiano e inglese, file .bdic interi', () => {
  assert.deepEqual(D.lingue(), ['en-GB', 'en-US', 'it-IT']);
  for (const f of D.inclusi()) {
    const b = readFileSync(join(D.CARTELLA, f));
    assert.equal(b.subarray(0, 4).toString('latin1'), 'BDic', `${f} non è un dizionario di Chromium`);
    assert.ok(b.length > 100_000, `${f} è troppo piccolo per essere intero`);
  }
});

test('il dizionario italiano è GPL: le sue sorgenti e il testo della licenza viaggiano con lui', () => {
  for (const f of ['it_IT.dic', 'it_IT.aff', 'it_IT.dic_delta', 'README_it_IT.txt']) {
    assert.ok(existsSync(join(D.CARTELLA, 'sorgenti', f)), `manca sorgenti/${f}`);
  }
  assert.match(readFileSync(join(D.CARTELLA, 'COPYING'), 'latin1'), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.match(readFileSync(join(D.CARTELLA, 'sorgenti', 'README_it_IT.txt'), 'latin1'), /GNU General Public License \(GPL\) version 2\.0 or above/);
});

test('all\'avvio i dizionari inclusi sono già dove Chromium li cerca, e ogni sessione scarica solo da file://', () => {
  const dati = cartellaTemporanea('filo-dizionari-');
  const app = finta(dati);
  assert.equal(D.prepara(app, { piattaforma: 'linux' }), true);
  const dove = join(dati, 'Dictionaries');
  assert.deepEqual(readdirSync(dove).sort(), D.inclusi());
  for (const f of D.inclusi()) assert.equal(statSync(join(dove, f)).size, statSync(join(D.CARTELLA, f)).size);

  const predefinita = sessione();
  const altra = sessione();
  app.emit('session-created', predefinita);
  app.emit('session-created', altra);
  for (const s of [predefinita, altra]) {
    assert.equal(s.url.length, 1);
    assert.equal(new URL(s.url[0]).protocol, 'file:');
    assert.ok(s.url[0].endsWith('/'), 'è la base a cui Chromium attacca il nome del file');
  }
  app.emit('session-created', predefinita);
  assert.equal(predefinita.url.length, 1, 'una sessione si aggancia una volta');

  predefinita.emit('spellcheck-dictionary-initialized', {}, 'it-IT');
  altra.emit('spellcheck-dictionary-download-begin', {}, 'de-DE');
  assert.deepEqual(D.stato(), { inizializzati: ['it-IT'], chiesti: ['de-DE'] });
});

test('un dizionario rovinato o mancante torna all\'avvio dopo; uno intero non si riscrive', () => {
  const dati = cartellaTemporanea('filo-dizionari-');
  const dove = join(dati, 'Dictionaries');
  assert.deepEqual(D.copia(dove), D.inclusi());
  assert.deepEqual(D.copia(dove), []);
  writeFileSync(join(dove, 'it-IT-3-0.bdic'), 'rotto');
  assert.deepEqual(D.copia(dove), ['it-IT-3-0.bdic']);
  assert.equal(statSync(join(dove, 'it-IT-3-0.bdic')).size, statSync(join(D.CARTELLA, 'it-IT-3-0.bdic')).size);
});

test('su Mac il correttore è del sistema: niente copie e niente aggancio', () => {
  const dati = cartellaTemporanea('filo-dizionari-');
  const app = finta(dati);
  assert.equal(D.prepara(app, { piattaforma: 'darwin' }), false);
  assert.equal(existsSync(join(dati, 'Dictionaries')), false);
  assert.equal(app.listenerCount('session-created'), 0);
});
