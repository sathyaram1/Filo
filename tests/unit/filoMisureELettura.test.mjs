// #1525 — il filo regge una pagina che scrive troppo e un file che non si legge: indirizzo e titolo hanno una misura
// segnata, il file si legge a righe, un filo illeggibile rifiuta le scritture e lo dice, uno pesante si fa notare.
// Niente Electron: il filo scrive in una cartella temporanea, i toast li raccoglie la prova.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { svuota } from '../helpers/orologio.mjs';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoCoda.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { STORAGE_KEYS: {} };
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { creaFilo } = require('../../src/main/services/ilFilo.js');
const E = globalThis.SN_FILO_EVENTI;

const cartelle = new Set();
after(() => { for (const c of cartelle) togliCartella(c); });

function nuovo(cartella = cartellaTemporanea('filo-misure-')) {
  cartelle.add(cartella);
  const avvisi = [];
  const f = creaFilo({ cartella, avvisa: (testo, opts) => avvisi.push({ testo, ...opts }) });
  return { f, avvisi, cartella, file: join(cartella, 'eventi.jsonl') };
}
const leggi = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

test('un indirizzo di 100.000 caratteri si rilegge a 8192 col segno del taglio, e non si riapre come intero', async () => {
  const { f, cartella } = nuovo();
  const url = 'https://lungo.example/?q=' + 'x'.repeat(100_000);
  const ev = await f.registraVisita({ url, titolo: 'T'.repeat(5000) });
  await f.aggiornaTitolo({ visita: ev.id, titolo: '🙂'.repeat(3000) });
  await f.registraVisita({ url: 'https://corto.example/', titolo: 'Corto' });
  const [lunga, corta] = (await nuovo(cartella).f.pagine()).sort((a, b) => b.url.length - a.url.length);
  assert.equal(lunga.url.length, 8192);
  assert.ok(url.startsWith(lunga.url));
  assert.equal(lunga.urlTagliato, true);
  assert.ok(lunga.titolo.length <= 1024 && lunga.titolo.length >= 1023, `titolo di ${lunga.titolo.length}`);
  assert.ok(!/[\uD800-\uDBFF]$/.test(lunga.titolo), 'il taglio ha spezzato un’emoji');
  assert.equal(lunga.titoloTagliato, true);
  assert.equal(corta.urlTagliato, undefined);
  assert.equal(corta.titoloTagliato, undefined);
  // Riaprirla porta al sito, non a un indirizzo a metà.
  assert.deepEqual(globalThis.SN_FILO_CODA.daAprire(lunga), { url: 'https://lungo.example/', sito: true });
  assert.deepEqual(globalThis.SN_FILO_CODA.daAprire(corta), { url: 'https://corto.example/', sito: false });
});

test('con la lettura che fallisce la scrittura rifiuta, il file non riceve righe e l’utente sa perché; poi riprova', async () => {
  const { f, avvisi, cartella, file } = nuovo();
  await nuovo(cartella).f.registraVisita({ url: 'https://prima.example/', titolo: 'Prima' });
  const prima = leggi(file);
  const originale = fs.createReadStream;
  fs.createReadStream = (p, ...resto) => {
    if (String(p) === file) { const e = new Error('EIO: i/o error, read'); e.code = 'EIO'; throw e; }
    return originale.call(fs, p, ...resto);
  };
  try {
    await assert.rejects(f.registraVisita({ url: 'https://dopo.example/', titolo: 'Dopo' }), (e) => e.code === 'FILO_ILLEGGIBILE');
    await assert.rejects(f.aggiornaTitolo({ visita: 'x', titolo: 'Dopo' }), (e) => e.code === 'FILO_ILLEGGIBILE');
    assert.equal(leggi(file), prima, 'una scrittura è finita in coda a un file che nessuno ha riletto');
    assert.equal(avvisi.length, 1, 'l’avviso torna a ogni richiesta');
    assert.match(avvisi[0].testo, /errore di lettura/);
    // Chi legge soltanto non si rompe: vede il filo vuoto, e l'avviso dice perché.
    assert.deepEqual(await f.pagine(), []);
  } finally { fs.createReadStream = originale; }
  await f.registraVisita({ url: 'https://dopo.example/', titolo: 'Dopo' });
  assert.deepEqual((await f.pagine()).map((p) => p.titolo).sort(), ['Dopo', 'Prima']);
});

test('l’incognito, in memoria, scrive anche se il file non si legge', async () => {
  const { f, file } = nuovo();
  const originale = fs.createReadStream;
  fs.createReadStream = (p, ...resto) => {
    if (String(p) === file) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
    return originale.call(fs, p, ...resto);
  };
  try {
    await f.registraVisita({ url: 'https://segreta.example/', titolo: 'Segreta' }, { incognito: true });
    assert.deepEqual((await f.pagine(null, { incognito: true })).map((p) => p.titolo), ['Segreta']);
  } finally { fs.createReadStream = originale; }
});

test('oltre 256 MB il filo si fa notare una volta per avvio, con la strada per cancellare le pagine', async () => {
  const { f, avvisi, file } = nuovo();
  await f.registraVisita({ url: 'https://a.example/', titolo: 'A' });
  assert.equal(avvisi.length, 0);
  const originale = fsp.stat;
  fsp.stat = async (p, ...resto) => {
    const s = await originale.call(fsp, p, ...resto);
    return String(p) === file ? { ...s, size: 300 * 1024 * 1024 } : s;
  };
  try {
    const altro = creaFilo({ cartella: join(file, '..'), avvisa: (testo, opts) => avvisi.push({ testo, ...opts }) });
    await altro.pagine();
    await svuota();
    await altro.registraVisita({ url: 'https://b.example/', titolo: 'B' });
    await svuota();
  } finally { fsp.stat = originale; }
  assert.equal(avvisi.length, 1);
  assert.match(avvisi[0].testo, /300 MB/);
  assert.deepEqual(avvisi[0].azioni, [{ label: 'Cancella pagine', openUrl: 'filo://security/security.html#cancella-pagine' }]);
});

test('il file si legge a righe: una riga più lunga di un pezzo letto e migliaia di righe tornano intere, e la compattazione le lascia identiche', async () => {
  const { f, cartella, file } = nuovo();
  const lungo = 'parola '.repeat(400_000);
  const scrivi = (eventi) => appendFileSync(file, eventi.map(E.riga).join(''));
  await f.registraVisita({ url: 'https://inizio.example/', titolo: 'Inizio' });
  scrivi([E.crea(E.TIPI.MESSAGGIO, { chat: 'lunga', msg: { role: 'user', text: lungo } }, { dispositivo: 'prova' })]);
  const tante = [];
  for (let i = 0; i < 3000; i++) tante.push(E.crea(E.TIPI.MESSAGGIO, { chat: `c${i}`, msg: { role: 'user', text: `messaggio ${i} `.repeat(30) } }, { dispositivo: 'prova' }));
  scrivi(tante);
  scrivi([E.crea(E.TIPI.CANCELLAZIONE, { chat: 'c7' }, { dispositivo: 'prova' })]);
  const attese = leggi(file).split('\n').filter((r) => r && !r.includes('"chat":"c7"') || r.includes('"tipo":"cancellazione"'));
  const g = nuovo(cartella).f;
  assert.equal((await g.chat('lunga')).messages[0].text, lungo);
  assert.equal((await g.chats()).length, 3000);
  assert.equal(await g.chat('c7'), null);
  assert.deepEqual(leggi(file).split('\n').filter(Boolean), attese.filter(Boolean));
});
