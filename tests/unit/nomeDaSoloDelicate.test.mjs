// #1274.1 — il nome automatico dei file scaricati non manda al modello un file nato su una pagina delicata o della rete
// di casa: conta la pagina della scheda, non solo l'indirizzo del file, e per uno screenshot la sua impronta. Il servizio
// vero di downloads.js col disco vero; finti il modello e l'impronta dei pixel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
globalThis.self = globalThis;
for (const m of ['contenutoEsterno', 'nomiFile', 'urlNav', 'pagineDelicate']) require(join(SRC, 'shared', `${m}.js`));
let impostazioni = {};
globalThis.SN_STORAGE = { getRaw: async (_k, d) => d, setRaw: async () => {}, getSettings: async () => impostazioni };
require(join(SRC, 'main', 'services', 'pagineDelicate.js'));
const DL = require(join(SRC, 'main', 'services', 'downloads.js'));
const Nomi = require(join(SRC, 'main', 'services', 'nomiFile.js'));
const Immagini = require(join(SRC, 'main', 'services', 'immaginiDelicate.js'));

// I byte di uno screenshot fatto su una pagina delicata, che #1274 ha già segnato. L'impronta vera decodifica i pixel con
// Electron: qui basta quella dei byte.
const SCREENSHOT_SEGNATO = 'PIXEL-DEL-CONTO';
const improntaFinta = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex');
let istanza = null;
Immagini.perFilo = () => istanza;

async function scarica({ nome, contenuto, url, pagina = '', apertaDa = '', primo = url, settings = {} }) {
  const dir = cartellaTemporanea('filo-nome-delicate-');
  try {
    impostazioni = settings;
    const chiamate = [];
    Nomi.collega({ chiamaModello: async (m) => { chiamate.push(m); return 'Estratto conto marzo'; } });
    istanza = Immagini.crea({
      impronta: improntaFinta,
      storage: () => ({ getRaw: async (_k, d) => d, setRaw: async () => {} }),
      appunti: async () => null,
    });
    await istanza.segna(Buffer.from(SCREENSHOT_SEGNATO));
    const savePath = join(dir, nome);
    writeFileSync(savePath, contenuto);
    const rec = { id: `r-${Math.random()}`, filename: nome, url, _primo: primo, _pagina: pagina, _apertaDa: apertaDa, savePath, state: 'completed', _scope: '' };
    DL._records.set(rec.id, rec);
    await DL._nominaDaSolo(rec);
    DL._records.delete(rec.id);
    return { chiamate, file: readdirSync(dir) };
  } finally {
    Nomi.collega({ chiamaModello: null });
    togliCartella(dir);
  }
}

const SALDO = 'Saldo 12.345,67 IBAN IT60X0542811101000000123456';

test('un documento dal nome vuoto scaricato da una pagina della banca non va al modello e tiene il suo nome', async () => {
  // Il file lo serve un altro dominio: conta la pagina della scheda.
  const { chiamate, file } = await scarica({
    nome: 'documento.txt', contenuto: SALDO, url: 'https://cdn.esempio-file.net/x/123', pagina: 'https://www.intesasanpaolo.com/conto/estratti',
  });
  assert.equal(chiamate.length, 0, 'il contenuto del file è partito verso il modello dei nomi');
  assert.deepEqual(file, ['documento.txt']);
});

test('anche quando è l\'indirizzo del file, o il primo della catena, a essere della banca o della posta', async () => {
  for (const r of [
    { url: 'https://www.intesasanpaolo.com/doc/download.txt' },
    { url: 'https://cdn.esempio-file.net/x', primo: 'https://mail.google.com/mail/u/0/?attid=0.1' },
    { url: 'blob:https://mail.google.com/0d6c3e', pagina: '' },
  ]) {
    const { chiamate } = await scarica({ nome: 'download.txt', contenuto: SALDO, ...r });
    assert.equal(chiamate.length, 0, JSON.stringify(r));
  }
});

// #1823 — il link della banca che apre il file in una scheda nuova: la scheda-ponte non ha una pagina sua.
test('un file aperto dalla banca in una scheda nuova, servito da un altro dominio, non va al modello', async () => {
  const { chiamate, file } = await scarica({
    nome: 'documento.txt', contenuto: SALDO, url: 'https://cdn.esempio-file.net/x/123', pagina: '', apertaDa: 'https://www.intesasanpaolo.com/conto/estratti',
  });
  assert.equal(chiamate.length, 0, 'il contenuto del file è partito verso il modello dei nomi');
  assert.deepEqual(file, ['documento.txt']);
});

test('un file scaricato dalla rete di casa non va al modello', async () => {
  const { chiamate } = await scarica({ nome: 'download.txt', contenuto: 'config', url: 'http://192.168.1.1/backup.txt', pagina: 'http://192.168.1.1/' });
  assert.equal(chiamate.length, 0);
});

test('uno screenshot con l\'impronta di una pagina delicata non va al modello, anche salvato da un altro sito', async () => {
  const { chiamate, file } = await scarica({
    nome: 'screenshot-2026-11-05.png', contenuto: SCREENSHOT_SEGNATO, url: 'data:image/png;base64,AA', pagina: 'https://it.wikipedia.org/wiki/Torino',
  });
  assert.equal(chiamate.length, 0);
  assert.deepEqual(file, ['screenshot-2026-11-05.png']);
});

test('da una pagina normale la chiamata parte e il file prende il nome', async () => {
  const { chiamate, file } = await scarica({
    nome: 'documento.txt', contenuto: 'Verbale della riunione di condominio', url: 'https://esempio.it/f/1', pagina: 'https://esempio.it/condominio',
  });
  assert.equal(chiamate.length, 1);
  assert.deepEqual(file, ['Estratto conto marzo.txt']);
  // Partito da una pagina di Filo (la home, la pagina Download): non è la rete di casa.
  const daFilo = await scarica({ nome: 'documento.txt', contenuto: 'Verbale', url: 'https://esempio.it/f/2', pagina: 'filo://downloads/downloads.html' });
  assert.equal(daFilo.chiamate.length, 1);
});

test('con le pagine delicate spente resta tutto come prima: la chiamata parte anche dalla banca', async () => {
  const settings = { security: { pagineDelicate: { enabled: false } } };
  const { chiamate } = await scarica({ settings, nome: 'documento.txt', contenuto: SALDO, url: 'https://www.intesasanpaolo.com/doc/1', pagina: 'https://www.intesasanpaolo.com/conto' });
  assert.equal(chiamate.length, 1);
});
