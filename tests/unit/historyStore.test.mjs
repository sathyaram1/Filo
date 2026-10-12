// La Cronologia AI sta in file suoi e non ha tetti (#1065).
//
// Parte da uno storage.json con la cronologia dentro, come l'ha lasciato la
// versione di prima, e asserisce quello che l'utente deve ritrovare: tutte le
// voci, nello stesso ordine, fuori da storage.json; oltre 5000 voci e oltre
// 4 MB senza che la prima sparisca; una richiesta nuova che costa una riga e
// non riserializza la cronologia; una voce tolta o una chat cancellata che non
// lasciano testo su disco; la pagina che riceve solo l'estratto che mostra;
// l'incognito che tiene le sue voci in RAM.
// Electron è finto (come in archivedTabsStore.test.mjs), il disco è vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs, { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { spiaDiscoSincrono } from '../helpers/spiaDisco.mjs';

const require = createRequire(import.meta.url);
const userData = cartellaTemporanea('filo-cronologia-ai-');
process.env.FILO_USER_DATA = userData;
const electronFinto = {
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};

// Una richiesta come la registra la chat: il payload intero, qualche KB di testo della pagina.
const PAGINA = 'testo della pagina '.repeat(100);
const vecchia = (i) => ({
  id: `vecchia-${i}`,
  timestamp: new Date(Date.UTC(2026, 6, 1) + i * 60_000).toISOString(),
  action: i % 2 ? 'explain_selection' : 'filo_chat',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-pro',
  servedBy: null,
  policyViolation: false,
  input: { selection: `domanda ${i}`, pageText: PAGINA, ...(i === 7 ? { screenshot: 'data:image/png;base64,' + 'A'.repeat(50_000) } : {}) },
  output: `risposta ${i}`,
  origin: 'https://esempio.test/',
  costEur: 0.001,
  usage: { promptTokens: 900, completionTokens: 40 },
  timing: null,
});
// Più del tetto di prima in byte (4 MB), il più recente in testa.
const VECCHIE = 3000;
const cronologiaVecchia = [];
for (let i = VECCHIE - 1; i >= 0; i--) cronologiaVecchia.push(vecchia(i));
writeFileSync(join(userData, 'storage.json'), JSON.stringify({
  settings: { theme: 'light' },
  aiHistory: cronologiaVecchia,
}), 'utf8');
assert.ok(readFileSync(join(userData, 'storage.json')).length > 4 * 1024 * 1024);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
require(join(ROOT, 'src', 'main', 'shim', 'chrome-api.js'));
require(join(ROOT, 'src', 'main', 'services', 'historyStore.js'));
const H = globalThis.SN_HISTORY;
const { creaDeposito } = require(join(ROOT, 'src', 'main', 'services', 'depositoAggiunte.js'));

// Ogni chiave che arriva a storage.json, per tutta la durata del file.
const chiaviScritte = new Set();
const setVero = Disco.set;
Disco.set = (obj) => { for (const k of Object.keys(obj || {})) chiaviScritte.add(k); return setVero(obj); };

function fileSotto(dir = userData) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fileSotto(p));
    else out.push(p);
  }
  return out;
}
const trovaSuDisco = (ago) => fileSotto().filter((f) => readFileSync(f, 'latin1').includes(ago));
const domanda = (testo, extra = {}) => ({
  action: 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
  input: { userMessage: testo, pageText: PAGINA }, output: `risposta a ${testo}`, origin: 'filo:chat', costEur: 0.002,
  ...extra,
});

test('la migrazione porta tutta la cronologia fuori da storage.json, nello stesso ordine', async () => {
  const lista = await H.list();
  assert.equal(lista.length, VECCHIE);
  assert.deepEqual(lista.map((it) => it.id), cronologiaVecchia.map((it) => it.id));
  const prima = lista.at(-1);
  assert.equal(prima.id, 'vecchia-0');
  assert.equal(prima.input.pageText, PAGINA);
  assert.deepEqual(prima.usage, { promptTokens: 900, completionTokens: 40 });
  assert.equal(lista.find((it) => it.id === 'vecchia-7').input.screenshot, undefined, 'lo screenshot non si porta nei file nuovi');
  await Disco.whenSettled();
  const suDisco = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
  assert.equal(suDisco.aiHistory, undefined);
  assert.equal(suDisco.settings.theme, 'light');
  assert.ok(readFileSync(join(userData, 'storage.json')).length < 10_000);
});

test('nessun tetto: oltre 5000 voci e oltre 4 MB la prima resta', async () => {
  for (let i = 0; i < 2100; i++) await H.append(domanda(`nuova ${i}`));
  const lista = await H.list();
  assert.equal(lista.length, VECCHIE + 2100);
  assert.equal(lista[0].input.userMessage, 'nuova 2099');
  assert.equal(lista.at(-1).id, 'vecchia-0');
  const byte = fileSotto(H.cartella()).reduce((n, f) => n + statSync(f).size, 0);
  assert.ok(byte > 8 * 1024 * 1024, `cronologia su disco: ${byte} byte`);
});

test('una richiesta nuova accoda una riga e serializza solo la sua voce, non la cronologia', async () => {
  const visti = [];
  const stringify = JSON.stringify;
  JSON.stringify = function (...a) { const s = stringify.apply(this, a); visti.push(s ? s.length : 0); return s; };
  let disco;
  try {
    disco = await spiaDiscoSincrono(H.cartella(), () => H.append(domanda('una ancora')));
  } finally {
    JSON.stringify = stringify;
  }
  const voce = stringify((await H.list())[0]).length;
  assert.deepEqual(disco.map(({ n, righe }) => [n, righe]), [['appendFileSync', 1]], stringify(disco));
  assert.ok(Math.max(...visti) < 2 * voce, `serializzazione più lunga: ${Math.max(...visti)} caratteri, la voce ne ha ${voce}`);
  assert.ok(visti.reduce((a, b) => a + b, 0) < 3 * voce);
  assert.ok(!chiaviScritte.has('aiHistory'));
});

test('patch accoda una riga, e il dato c\'è anche dopo un riavvio', async () => {
  const v = await H.append(domanda('dettatura'));
  const visto = await spiaDiscoSincrono(H.cartella(), () => H.patch(v.id, { servedBy: 'DeepInfra', policyViolation: true }));
  assert.deepEqual(visto.map(({ n }) => n), ['appendFileSync']);
  assert.equal((await H.list())[0].servedBy, 'DeepInfra');
  const riaperto = creaDeposito({ cartella: H.cartella(), meseDi: (it) => it.timestamp.slice(0, 7) });
  await riaperto.carica();
  assert.equal(riaperto.prendi(v.id).servedBy, 'DeepInfra');
  assert.equal(riaperto.prendi(v.id).policyViolation, true);
  assert.equal(await H.patch('inesistente', { servedBy: 'x' }), null);
});

test('il disco che rifiuta la riga perde la voce, non la richiesta: append e patch non falliscono', async () => {
  const v = await H.append(domanda('prima del guasto'));
  const prima = (await H.list()).length;
  const vero = fs.appendFileSync;
  const avvisi = console.warn;
  console.warn = () => {};
  fs.appendFileSync = () => { const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e; };
  let nuova;
  let patch;
  try {
    nuova = await H.append(domanda('col disco pieno'));
    patch = await H.patch(v.id, { servedBy: 'DeepInfra' });
  } finally {
    fs.appendFileSync = vero;
    console.warn = avvisi;
  }
  assert.equal(typeof nuova.id, 'string');
  assert.equal(nuova.output, 'risposta a col disco pieno');
  assert.equal(patch, null);
  const dopo = await H.list();
  assert.equal(dopo.length, prima, 'la voce non scritta non compare come salvata');
  // Tornato il disco, la cronologia riprende.
  await H.append(domanda('dopo il guasto'));
  assert.equal((await H.list())[0].input.userMessage, 'dopo il guasto');
});

test('una voce tolta dalla Cronologia non resta in nessun file della cartella dati', async () => {
  const v = await H.append(domanda('IBAN-privato-1065'));
  await H.patch(v.id, { servedBy: 'Fornitore' });
  assert.ok(trovaSuDisco('IBAN-privato-1065').length > 0);
  const n = (await H.list()).length;
  const resto = await H.remove(v.id);
  assert.equal(resto.length, n - 1);
  assert.ok(!resto.some((it) => it.id === v.id));
  assert.deepEqual(trovaSuDisco('IBAN-privato-1065'), []);
});

test('cancellata una chat, il suo testo sparisce dalle voci e dal disco; costi e tempi restano', async () => {
  const v = await H.append(domanda('diagnosi PRIVATO-866', { costEur: 0.0123, timing: { totalMs: 900 } }));
  await H.append(domanda('Epicuro TIENIMI-866'));
  const cambiate = await H.redigi((it) => (JSON.stringify(it).includes('PRIVATO-866')
    ? { ...it, input: { userMessage: '[chat cancellata]' }, output: '[chat cancellata]' } : it));
  assert.equal(cambiate, 1);
  assert.deepEqual(trovaSuDisco('PRIVATO-866'), []);
  assert.ok(trovaSuDisco('TIENIMI-866').length > 0);
  const dopo = (await H.list()).find((it) => it.id === v.id);
  assert.equal(dopo.output, '[chat cancellata]');
  assert.equal(dopo.costEur, 0.0123);
  assert.deepEqual(dopo.timing, { totalMs: 900 });
});

test('la pagina riceve un estratto dell\'ingresso, non il testo della pagina', async () => {
  const lunga = 'x'.repeat(5000);
  const v = await H.append(domanda(lunga));
  const vista = H.vistaPagina((await H.list()).find((it) => it.id === v.id));
  assert.equal(vista.input.pageText, undefined);
  assert.equal(vista.input.userMessage.length, 1000);
  assert.equal(vista.output, v.output);
  assert.equal(H.vistaPagina({ id: 's', input: 'y'.repeat(3000) }).input.length, 1000);
  assert.deepEqual(H.vistaPagina({ id: 'v', input: { selection: 'ciao', messages: [{ content: lunga }] } }).input, { selection: 'ciao' });
  await H.remove(v.id);
});

test('la pagina riceve la domanda anche quando la richiesta la tiene fra i messaggi (chat, voci già salvate)', () => {
  const domandaVista = (input) => H.vistaPagina({ id: 'd', input }).input.userMessage;
  const giro = [
    { role: 'user', content: 'domanda di prima' },
    { role: 'assistant', content: 'risposta di prima' },
    { role: 'user', content: 'A che ora apre il museo?' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'user', content: 'sollecito interno' },
  ];
  assert.equal(domandaVista({ threadMessages: giro, indiceDomanda: 2, profilo: 'x'.repeat(5000) }), 'A che ora apre il museo?');
  assert.equal(domandaVista({ threadMessages: giro.slice(0, 3) }), 'A che ora apre il museo?');
  assert.equal(domandaVista({ threadMessages: [{ role: 'user', content: [{ type: 'text', text: 'cos\'è?' }, { type: 'image_url', image_url: { url: 'data:x' } }] }], indiceDomanda: 0 }), 'cos\'è?');
  assert.equal(domandaVista({ messages: [{ role: 'system', content: 'regole' }, { role: 'user', content: 'mazzo rosso?' }] }), 'mazzo rosso?');
  assert.equal(domandaVista({ original: 'testo', instruction: 'più formale' }), 'più formale');
  assert.equal(domandaVista({ userMessage: 'scritta', threadMessages: giro, indiceDomanda: 0 }), 'scritta');
  assert.equal(domandaVista({ threadMessages: [{ role: 'user', content: 'y'.repeat(3000) }] }).length, 1000);
  assert.equal(domandaVista({ lang: 'it', seconds: 3 }), undefined);
});

test('l\'incognito tiene le sue voci in RAM: non vede la cronologia e non scrive su disco', async () => {
  const prima = (await H.list()).length;
  const dentro = await Disco.runIncognito(async () => {
    const vuota = await H.list();
    const v = await H.append(domanda('privata-incognito-1065'));
    await H.patch(v.id, { servedBy: 'Fornitore' });
    const altra = await H.append(domanda('altra-incognito-1065'));
    const dopoRimozione = await H.remove(altra.id);
    return { vuota, lista: await H.list(), dopoRimozione, id: v.id };
  });
  assert.deepEqual(dentro.vuota, []);
  assert.deepEqual(dentro.lista.map((it) => it.input.userMessage), ['privata-incognito-1065']);
  assert.equal(dentro.lista[0].servedBy, 'Fornitore');
  assert.equal(dentro.dopoRimozione.length, 1);
  assert.equal((await H.list()).length, prima);
  assert.deepEqual(trovaSuDisco('incognito-1065'), []);
  // Il «chi ha servito» che arriva dopo trova la voce anche fuori dal contesto della finestra.
  assert.equal((await H.patch(dentro.id, { servedBy: 'Tardi' })).servedBy, 'Tardi');
  await Disco.runIncognito(async () => { await H.clear(); });
  assert.equal((await H.list()).length, prima, 'svuotare dall\'incognito non tocca la cronologia');
  await Disco.runIncognito(() => H.append(domanda('ancora-incognito')));
  H.resetIncognito();
  assert.deepEqual(await Disco.runIncognito(() => H.list()), []);
});

test('importa: entrano solo le voci che mancano, dietro alle presenti', async () => {
  const presenti = await H.list();
  const entrate = await H.importa([presenti[0], { ...vecchia(1), id: 'dal-backup-1', input: { selection: 's', screenshot: 'data:x' } }, null, 'no']);
  assert.equal(entrate, 1);
  const dopo = await H.list();
  assert.equal(dopo.length, presenti.length + 1);
  assert.equal(dopo.at(-1).id, 'dal-backup-1');
  assert.equal(dopo.at(-1).input.screenshot, undefined);
  assert.equal(await H.importa([presenti[0]]), 0);
});

test('«cancella tutti i dati» svuota anche la cronologia, dal disco', async () => {
  await globalThis.chrome.storage.local.clear();
  assert.deepEqual(await H.list(), []);
  await Disco.whenSettled();
  assert.deepEqual(trovaSuDisco('nuova 3'), []);
  assert.deepEqual(trovaSuDisco('vecchia-3'), []);
  assert.ok(!chiaviScritte.has('aiHistory'), 'la cronologia non è mai passata da storage.json');
});

// Sentinella: nessun modulo rimette la cronologia in storage.json scrivendone la chiave.
test('nessuna scrittura di storage.json usa la chiave della cronologia AI', () => {
  const sorgenti = [];
  const giu = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) giu(p);
      else if (/\.(m?js|html)$/.test(nome)) sorgenti.push(p);
    }
  };
  giu(join(ROOT, 'src'));
  const chiave = /\[\s*(?:[\w$]+\.)*(?:STORAGE_KEYS\.HISTORY|HISTORY_KEY)\s*\]\s*:/;
  const scrittura = /\b(?:set|setRaw|setSync)\(\s*(?:[\w$]+\.)*(?:STORAGE_KEYS\.HISTORY|HISTORY_KEY)\b/;
  const fuori = [];
  for (const f of sorgenti) {
    const testo = readFileSync(f, 'utf8');
    const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (chiave.test(testo) || scrittura.test(testo)) fuori.push(rel);
    if (/['"`]aiHistory['"`]|\baiHistory\s*:/.test(testo) && rel !== 'src/shared/constants.js') fuori.push(rel);
  }
  assert.deepEqual(fuori, []);
});
