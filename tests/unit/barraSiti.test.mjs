// #1803 — la barra dei siti della nuova scheda: voci e mosse (src/shared/barraSiti.js), il servizio del main che le
// scrive per i gesti e per la chat (src/main/services/barraSiti.js), e l'avvio dei programmi solo da una voce salvata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'barraSiti.js'));
require(join(ROOT, 'src', 'shared', 'actionTools.js'));
require(join(ROOT, 'src', 'shared', 'actionLevels.js'));

const B = globalThis.SN_BARRA_SITI;
const nomi = (voci) => voci.map((v) => v.nome).join(',');

let salvato;
function storageFinto() {
  salvato = undefined;
  const attesa = () => new Promise((r) => setTimeout(r, 3));
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) { await attesa(); return { [k]: salvato === undefined ? undefined : JSON.parse(JSON.stringify(salvato)) }; },
        async set(o) { await attesa(); salvato = Object.values(o)[0]; },
      },
    },
  };
}
const Servizio = () => require(join(ROOT, 'src', 'main', 'services', 'barraSiti.js'));

test('un indirizzo scritto a mano diventa un sito; uno che non si apre in una scheda no', () => {
  assert.equal(B.normalizzaIndirizzo('youtube.com'), 'https://youtube.com/');
  assert.equal(B.normalizzaIndirizzo('  https://www.example.org/a?b=1 '), 'https://www.example.org/a?b=1');
  assert.equal(B.normalizzaIndirizzo('localhost:3000'), 'https://localhost:3000/');
  assert.equal(B.normalizzaIndirizzo('http://127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  for (const no of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'ciao', 'due parole.it', 'filo://newtab/']) {
    assert.equal(B.normalizzaIndirizzo(no), '', `«${no}» non è un sito`);
  }
});

test('aggiungi, togli, rinomina e sposta: la barra cambia come chiede la mossa', () => {
  let r = B.applica([], { tipo: 'aggiungi', url: 'youtube.com', nome: 'YouTube' });
  assert.equal(r.cambiato, true);
  r = B.applica(r.voci, { tipo: 'aggiungi', url: 'https://example.org', icona: 'data:image/png;base64,AAA' });
  assert.equal(nomi(r.voci), 'YouTube,example.org', 'senza nome vale il sito');
  assert.equal(r.voci[1].icona, 'data:image/png;base64,AAA');
  const gia = B.applica(r.voci, { tipo: 'aggiungi', url: 'https://youtube.com/' });
  assert.equal(gia.cambiato, false);
  assert.equal(gia.gia, true, 'lo stesso sito due volte non fa due voci');
  r = B.applica(r.voci, { tipo: 'aggiungi', url: 'wikipedia.org', prima: 'YouTube' });
  assert.equal(nomi(r.voci), 'wikipedia.org,YouTube,example.org');
  r = B.applica(r.voci, { tipo: 'sposta', voce: 'wikipedia', verso: 'fondo' });
  assert.equal(nomi(r.voci), 'YouTube,example.org,wikipedia.org');
  r = B.applica(r.voci, { tipo: 'sposta', id: r.voci[2].id, prima: r.voci[0].id });
  assert.equal(nomi(r.voci), 'wikipedia.org,YouTube,example.org');
  r = B.applica(r.voci, { tipo: 'sposta', voce: 'YouTube', prima: null });
  assert.equal(nomi(r.voci), 'wikipedia.org,example.org,YouTube');
  r = B.applica(r.voci, { tipo: 'rinomina', voce: 'example.org', nome: 'Esempio <b>' });
  assert.equal(nomi(r.voci), 'wikipedia.org,Esempio <b>,YouTube', 'il nome resta testo, lo disegna textContent');
  r = B.applica(r.voci, { tipo: 'togli', voce: 'youtube.com' });
  assert.equal(nomi(r.voci), 'wikipedia.org,Esempio <b>');
  const manca = B.applica(r.voci, { tipo: 'togli', voce: 'twitch' });
  assert.match(manca.errore, /non c'è questa voce/);
  assert.match(B.applica([], { tipo: 'aggiungi', url: 'javascript:alert(1)' }).errore, /non è l'indirizzo di un sito/);
  assert.match(B.applica(r.voci, { tipo: 'rinomina', voce: 'Esempio', nome: 'x'.repeat(301) }).errore, /301 caratteri, il massimo è 300/);
});

test('un programma entra col suo percorso intero e il nome del file; un percorso relativo no', () => {
  let r = B.applica([], { tipo: 'aggiungi', percorso: 'C:\\Users\\agenti AI\\Desktop\\Steam.lnk' });
  assert.equal(r.voci[0].tipo, 'app');
  assert.equal(r.voci[0].nome, 'Steam');
  r = B.applica(r.voci, { tipo: 'aggiungi', percorso: '/Applications/Giochi/Factorio.app' });
  assert.equal(nomi(r.voci), 'Steam,Factorio');
  assert.match(B.applica([], { tipo: 'aggiungi', percorso: 'Steam.lnk' }).errore, /percorso intero/);
  assert.deepEqual(B.descrivi(r.voci)[0], { nome: 'Steam', programma: 'C:\\Users\\agenti AI\\Desktop\\Steam.lnk' });
});

test('una barra piena rifiuta col numero invece di perdere voci', () => {
  let voci = [];
  for (let i = 0; i < B.MAX_VOCI; i++) voci = B.applica(voci, { tipo: 'aggiungi', url: `sito${i}.it` }).voci;
  const r = B.applica(voci, { tipo: 'aggiungi', url: 'uno-di-troppo.it' });
  assert.match(r.errore, new RegExp(`già ${B.MAX_VOCI} voci, il massimo è ${B.MAX_VOCI}`));
  assert.equal(r.voci.length, B.MAX_VOCI);
});

test('dati rovinati sul disco: restano solo le voci valide', () => {
  const v = B.normalizza([{ id: 'a', url: 'https://a.it' }, { id: 'a', url: 'https://b.it' }, { url: 'https://c.it' },
    { id: 'd', url: 'javascript:x' }, { id: 'e', tipo: 'app', percorso: 'rel/x.exe' }, null, 'boh', { id: 'f', url: 'g.it', icona: 'https://x/y.png' }]);
  assert.deepEqual(v.map((x) => x.id), ['a', 'f']);
  assert.equal(v[1].icona, '', 'un\'icona che non è un dato d\'immagine non entra');
  assert.deepEqual(B.normalizza('rotta'), []);
});

test('la chat e i gesti passano dallo stesso salvataggio: aggiungi e togli dalla chat si leggono come dalla home', async () => {
  storageFinto();
  const S = Servizio();
  const dalGesto = await S.modifica({ tipo: 'aggiungi', url: 'https://www.wikipedia.org/', nome: 'Wikipedia' });
  assert.equal(dalGesto.cambiato, true);
  const r = await S.daChat({ type: 'BARRA_SITI', operazione: 'metti', elemento: 'youtube.com', nome: 'YouTube' });
  assert.equal(r.executed, true);
  assert.equal(r.output.voce, 'YouTube');
  assert.equal(nomi(r.cambiate), 'Wikipedia,YouTube', 'chi esegue riceve le voci da annunciare alle home');
  assert.equal(nomi(salvato), 'Wikipedia,YouTube', 'scritto dove scrivono i gesti');
  const sposta = await S.daChat({ type: 'BARRA_SITI', operazione: 'sposta', elemento: 'YouTube', verso: 'cima' });
  assert.equal(sposta.executed, true);
  assert.equal(nomi(await S.leggi()), 'YouTube,Wikipedia');
  const rinomina = await S.daChat({ type: 'BARRA_SITI', operazione: 'rinomina', elemento: 'wikipedia.org', nome: 'Enciclopedia' });
  assert.equal(rinomina.output.voce, 'Enciclopedia');
  const tolta = await S.daChat({ type: 'BARRA_SITI', operazione: 'togli', elemento: 'enciclopedia' });
  assert.equal(tolta.executed, true);
  assert.equal(nomi(await S.leggi()), 'YouTube');
  const elenco = await S.daChat({ type: 'BARRA_SITI', operazione: 'elenca' });
  assert.deepEqual(elenco.output.voci, [{ nome: 'YouTube', indirizzo: 'https://youtube.com/' }]);
  assert.equal(elenco.cambiate, undefined);
  const no = await S.daChat({ type: 'BARRA_SITI', operazione: 'togli', elemento: 'twitch' });
  assert.equal(no.executed, false);
  assert.match(no.output.error, /non c'è questa voce/);
  assert.equal((await S.daChat({ type: 'BARRA_SITI', operazione: 'balla' })).output.error, 'operazione sconosciuta');
  // Ripiegare a parole scrive l'impostazione della freccia, e non tocca la barra.
  assert.deepEqual((await S.daChat({ type: 'BARRA_SITI', operazione: 'ripiega' })).impostazioni, { chatRipiegata: true });
  assert.deepEqual((await S.daChat({ type: 'BARRA_SITI', operazione: 'riapri' })).impostazioni, { chatRipiegata: false });
  assert.equal(nomi(await S.leggi()), 'YouTube');
});

test('due mosse quasi insieme non si cancellano: il main le mette in fila', async () => {
  storageFinto();
  const S = Servizio();
  await Promise.all([
    S.modifica({ tipo: 'aggiungi', url: 'a.it' }),
    S.modifica({ tipo: 'aggiungi', url: 'b.it' }),
    S.daChat({ operazione: 'aggiungi', elemento: 'c.it' }),
  ]);
  assert.equal(nomi(await S.leggi()), 'a.it,b.it,c.it');
});

test('un programma parte solo se è una voce della barra, cercata per id: mai un percorso arrivato con la richiesta', async () => {
  storageFinto();
  const S = Servizio();
  const dir = cartellaTemporanea('barra-siti');
  const gioco = join(dir, 'gioco');
  writeFileSync(gioco, '#!/bin/sh\n');
  chmodSync(gioco, 0o755);
  const lanciati = [];
  const lanciatore = async (p) => { lanciati.push(p); return ''; };
  // Un percorso passato al posto dell'id non è una voce: niente parte.
  assert.equal((await S.avvia(gioco, { lanciatore })).ok, false);
  const sito = await S.modifica({ tipo: 'aggiungi', url: 'a.it' });
  assert.equal((await S.avvia(sito.voce.id, { lanciatore })).ok, false, 'un sito non si avvia come programma');
  assert.deepEqual(lanciati, []);
  if (process.platform === 'linux') {
    const app = await S.modifica({ tipo: 'aggiungi', percorso: gioco });
    assert.equal(app.cambiato, true, app.errore);
    const r = await S.avvia(app.voce.id, { lanciatore });
    assert.equal(r.ok, true);
    assert.deepEqual(lanciati, [gioco]);
    const testo = join(dir, 'note.txt');
    writeFileSync(testo, 'ciao');
    assert.match((await S.modifica({ tipo: 'aggiungi', percorso: testo })).errore, /programma/, 'un file qualunque non entra');
  }
  assert.match((await S.modifica({ tipo: 'aggiungi', percorso: join(dir, 'non-c-e.exe') })).errore, /non c'è più/);
});

test('ogni piattaforma ha il suo ramo: Windows vuole .exe/.lnk/.url, Mac un .app, Linux un eseguibile o un .desktop', () => {
  const S = Servizio();
  const dir = cartellaTemporanea('barra-siti-piattaforme');
  const f = (nome, modo = 0o644) => { const p = join(dir, nome); writeFileSync(p, 'x'); chmodSync(p, modo); return p; };
  assert.equal(S.controllaProgramma(f('Steam.lnk'), 'win32').ok, true);
  assert.equal(S.controllaProgramma(f('gioco.exe'), 'win32').ok, true);
  assert.ok(S.controllaProgramma(f('lettera.docx'), 'win32').errore);
  assert.ok(S.controllaProgramma(f('cartella.app'), 'darwin').errore, 'un .app è una cartella');
  assert.equal(S.controllaProgramma(f('gioco.desktop'), 'linux').ok, true);
  if (process.platform !== 'win32') {
    assert.equal(S.controllaProgramma(f('script', 0o755), 'linux').ok, true);
    assert.ok(S.controllaProgramma(f('dati.bin', 0o644), 'linux').errore);
  }
  assert.ok(S.controllaProgramma('relativo/gioco.exe', 'win32').errore);
});

test('dalla chat: un sito costa 1, un programma chiede conferma (costo 3) e si mostra col percorso intero', () => {
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'aggiungi', elemento: 'youtube.com' }), 1);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'togli', elemento: 'YouTube' }), 1);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'ripiega' }), 1);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'elenca' }), 0);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'metti', elemento: 'C:\\Giochi\\x.exe' }), 3);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'aggiungi', elemento: '/usr/games/x' }), 3);
  assert.equal(L.costoFor({ type: 'BARRA_SITI', operazione: 'togli', elemento: 'C:\\Giochi\\x.exe' }), 1, 'togliere un programma si disfa');
  assert.equal(L.campoFor({ type: 'BARRA_SITI', operazione: 'aggiungi', elemento: 'C:\\Giochi\\x.exe' }), 'file');
  assert.match(L.describe({ type: 'BARRA_SITI', operazione: 'aggiungi', elemento: 'C:\\Giochi\\x.exe' }), /programma C:\\Giochi\\x\.exe/);
  const T = globalThis.SN_ACTION_TOOLS;
  const azioni = T.toolCallsToActions([{ id: 'c1', function: { name: 'home', arguments: JSON.stringify({ azione: 'barra_siti', operazione: 'aggiungi', elemento: 'youtube.com' }) } }]);
  assert.equal(azioni[0].type, 'BARRA_SITI');
  assert.equal(azioni[0].elemento, 'youtube.com');
});

test('i canali della barra rispondono solo alle pagine di Filo, e la chiave sta coi dati dell\'utente', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'barraSiti.js'), 'utf8');
  for (const tipo of ['BARRA_SITI_GET', 'BARRA_SITI_MODIFICA', 'BARRA_SITI_AVVIA']) {
    assert.match(src, new RegExp(`on\\(MSG\\.${tipo}, soloFilo\\(`), `${tipo} risponde anche a un sito`);
  }
  assert.match(readFileSync(join(ROOT, 'src', 'main', 'services', 'exportData.js'), 'utf8'), /FILO_BARRA_SITI: 'contenuto'/);
});
