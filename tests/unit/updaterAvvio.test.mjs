// L'installazione di un aggiornamento su Windows (#1039), col disco vero e l'installatore finto: all'apertura parte
// solo l'installatore che electron-updater ha verificato, visibile e col riavvio; un fallimento si conta, e al
// secondo l'utente lo legge fra le notifiche col link. Niente Electron: lancio e uscita sono registrati.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));

let dati;
let cache;
let installatore;
let notifiche;

function memoriaFinta() {
  notifiche = [];
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => notifiche.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: String(notifiche.length + 1), dismissed: false }; notifiche.unshift(e); return e; },
    dismissNotification: async (id) => { const n = notifiche.find((x) => x.id === id); if (n) n.dismissed = true; return notifiche; },
  };
}

function preparaCache(contenuto = 'MZ installatore finto di Filo 0.2.234') {
  dati = cartellaTemporanea('filo-agg-dati-');
  cache = join(cartellaTemporanea('filo-agg-cache-'), 'pending');
  mkdirSync(cache, { recursive: true });
  installatore = join(cache, 'Filo-Setup.exe');
  writeFileSync(installatore, contenuto);
  const sha = createHash('sha512').update(contenuto).digest('base64');
  writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: sha, isAdminRightsRequired: false }));
  return sha;
}

const ricordo = () => (existsSync(join(dati, 'aggiornamento-pronto.json')) ? JSON.parse(readFileSync(join(dati, 'aggiornamento-pronto.json'), 'utf8')) : null);
const aspetta = (ms) => new Promise((r) => setTimeout(r, ms));

function scaricato(prova, versione = '0.2.234') {
  prova.finto.emit('update-downloaded', { version: versione, downloadedFile: installatore });
}

beforeEach(() => memoriaFinta());

test('scaricato l\'aggiornamento, all\'apertura dopo parte l\'installatore visibile che riapre Filo', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prova);
  assert.equal(ricordo().versione, '0.2.234', 'la versione scaricata non è stata ricordata: all\'avvio non si saprebbe cosa c\'è');
  assert.equal(prova.registro.avvisi.length, 1, 'nessun avviso discreto con «Riavvia e aggiorna»');
  assert.match(prova.registro.avvisi[0], /0\.2\.234/);
  assert.equal(prova.registro.lanciati.length, 0, 'l\'installatore è partito subito, senza che l\'utente lo chiedesse');

  const partito = await U.installaAllAvvioSeServe({}, { forza: true });
  assert.equal(partito, true);
  assert.deepEqual(prova.registro.lanciati, [{ cmd: installatore, argv: ['--updated', '--force-run'] }],
    'senza /S l\'installatore mostra la barra; senza --force-run Filo non si riapre');
  assert.equal(prova.registro.uscite, 1, 'Filo non è uscito: l\'installatore lo chiuderebbe a forza');
  assert.equal(ricordo().tentativi, 1);
});

test('alla chiusura normale, su Windows, electron-updater non installa niente; chi sceglie la chiusura sì', () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  assert.equal(prova.finto.autoInstallOnAppQuit, false);
  U.seguiImpostazioni({ aggiornamenti: { installa: 'chiusura' } });
  assert.equal(prova.finto.autoInstallOnAppQuit, true, 'la scelta delle Preferenze non arriva all\'installazione');
  U.seguiImpostazioni({ aggiornamenti: { installa: 'avvio' } });
  assert.equal(prova.finto.autoInstallOnAppQuit, false);
});

test('con l\'installazione alla chiusura scelta, all\'avvio non parte niente', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  assert.equal(await U.installaAllAvvioSeServe({ aggiornamenti: { installa: 'chiusura' } }, { forza: true }), false);
  assert.equal(prova.registro.lanciati.length, 0);
});

test('un installatore manomesso, sparito o di un\'altra versione non parte: Filo si apre normalmente', async () => {
  for (const guasta of [
    () => writeFileSync(installatore, 'MZ un altro programma'),
    () => writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Altro.exe', sha512: 'x' })),
    () => writeFileSync(join(cache, 'update-info.json'), '{non è json'),
    () => require('node:fs').rmSync(installatore),
  ]) {
    preparaCache();
    const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
    scaricato(prova);
    guasta();
    assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
    assert.equal(prova.registro.lanciati.length, 0, 'è partito un installatore non verificato');
    assert.equal(prova.registro.uscite, 0);
    assert.equal(ricordo(), null, 'il ricordo di un installatore non valido resta e si riprova a ogni avvio');
  }
});

test('due installazioni fallite: Filo si apre fra l\'una e l\'altra, poi lo dice col link, e smette', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prova);
  const esiti = [];
  for (let i = 0; i < 6; i++) esiti.push(await U.installaAllAvvioSeServe({}, { forza: true }));
  assert.deepEqual(esiti, [true, false, true, false, false, false]);
  assert.equal(prova.registro.lanciati.length, 2, 'si ritentava a ogni avvio');
  await aspetta(20);
  const avvisi = notifiche.filter((n) => n.action?.tipo === 'aggiornamento-windows');
  assert.equal(avvisi.length, 1, 'al secondo fallimento l\'utente non lo legge fra le notifiche, o lo legge due volte');
  assert.match(avvisi[0].text, /0\.2\.234/);
  assert.match(avvisi[0].text, /filo\.red/, 'l\'avviso non dice dove scaricare Filo a mano');
  assert.equal(avvisi[0].kind, 'alert');
});

test('un installatore che non parte non chiude Filo', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  prova.registro.lanciaFallisce = true;
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
  assert.equal(prova.registro.uscite, 0, 'Filo è uscito senza un installatore che lo rimettesse');
});

test('installata la versione, il ricordo se ne va e l\'avviso che mandava a scaricarla anche', async () => {
  preparaCache();
  let prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prova);
  await U.avvisaInstallazioneFallita('0.2.234');
  prova = U.perProva({ piattaforma: 'win32', versione: '0.2.234', cartella: dati, avvisoVero: false });
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
  assert.equal(ricordo(), null);
  await aspetta(20);
  assert.equal(notifiche.filter((n) => !n.dismissed).length, 0, 'resta un avviso che manda a scaricare la versione che c\'è già');
});

test('chi ha bisogno dei permessi di amministratore passa da elevate.exe, come fa electron-updater', async () => {
  const contenuto = 'MZ installatore per tutti gli utenti';
  preparaCache(contenuto);
  const sha = createHash('sha512').update(contenuto).digest('base64');
  writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: sha, isAdminRightsRequired: true }));
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), true);
  const l = prova.registro.lanciati[0];
  assert.match(l.cmd, /elevate\.exe$/);
  assert.equal(l.argv[0], installatore);
});

test('«Riavvia e aggiorna» su Windows: installatore visibile, poi Filo si chiude; se non parte, resta aperto', async () => {
  preparaCache();
  let prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  prova.registro.lanciaFallisce = true;
  const no = await U.riavviaEAggiorna();
  assert.equal(no.ok, false);
  assert.match(no.frase, /filo\.red/);
  assert.equal(prova.registro.chiusure, 0);
  assert.equal(ricordo().tentativi, 0, 'un tentativo mai partito contava come fallito');
  assert.equal(prova.finto.autoInstallOnAppQuit, false);

  prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  const si = await U.riavviaEAggiorna();
  assert.equal(si.ok, true);
  assert.deepEqual(prova.registro.lanciati[0].argv, ['--updated', '--force-run']);
  assert.equal(prova.registro.chiusure, 1);
  assert.equal(ricordo().tentativi, 1, 'il pulsante non conta il tentativo: un fallimento non si vedrebbe all\'avvio');
});

test('senza un aggiornamento pronto il pulsante non fa niente', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  const r = await U.riavviaEAggiorna();
  assert.equal(r.ok, false);
  assert.equal(prova.registro.lanciati.length + prova.registro.chiusure, 0);
});

test('su Linux il pulsante c\'è solo con l\'AppImage riscrivibile, e Filo si riapre a processo chiuso', async () => {
  preparaCache();
  const appImage = join(cartellaTemporanea('filo-agg-appimage-'), 'Filo-Linux.AppImage');
  writeFileSync(appImage, 'appimage');
  const prova = U.perProva({ piattaforma: 'linux', cartella: dati, appImage, avvisoVero: false });
  scaricato(prova);
  assert.equal(prova.registro.avvisi.length, 1);
  assert.match(prova.registro.avvisi[0], /quando chiudi/);
  const r = await U.riavviaEAggiorna();
  assert.equal(r.ok, true);
  assert.equal(prova.registro.installazioni, 1);
  assert.deepEqual(prova.registro.riaperture, [appImage], 'dopo l\'aggiornamento Filo non si riapre');
  assert.equal(prova.registro.chiusure, 1);

  const senza = U.perProva({ piattaforma: 'linux', cartella: dati, appImage: null, avvisoVero: false });
  scaricato(senza);
  assert.equal(senza.registro.avvisi.length, 0, 'un pulsante che non può riuscire');
});

test('su Mac nessun pulsante: resta l\'avviso che c\'è già', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'darwin', cartella: dati, avvisoVero: false });
  scaricato(prova);
  assert.equal(prova.registro.avvisi.length, 0);
  assert.equal((await U.riavviaEAggiorna()).ok, false);
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
  assert.equal(prova.registro.lanciati.length, 0);
});

test('«aggiornati» a Filo: con una versione pronta riavvia; senza, controlla e dice com\'è', async () => {
  preparaCache();
  let prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  prova.registro.risposta = { evento: 'update-not-available', dati: {} };
  let r = await U.aggiornaDaChat();
  assert.equal(r.esito, 'aggiornato');
  assert.match(r.frase, /aggiornato/);
  assert.match(r.frase, /0\.2\.233/);
  assert.equal(prova.registro.controlli, 1, '«aggiornati» non ha nemmeno controllato');

  prova.registro.risposta = { evento: 'update-available', dati: { version: '0.2.240' } };
  r = await U.aggiornaDaChat();
  assert.match(r.frase, /0\.2\.240/);
  assert.match(r.frase, /scaricando/);
  r = await U.aggiornaDaChat();
  assert.match(r.frase, /già scaricando/, 'un secondo «aggiornati» durante lo scaricamento ricomincia da capo');

  prova = U.perProva({ piattaforma: 'linux', versione: '0.2.233', cartella: dati, avvisoVero: false });
  prova.registro.inattivo = true;
  const t0 = Date.now();
  r = await U.aggiornaDaChat();
  assert.ok(Date.now() - t0 < 5000, 'un updater che non gira faceva aspettare il tetto intero');
  assert.match(r.frase, /filo\.red/);

  prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prova);
  assert.equal((await U.statoAggiornamento()).riavvio, true);
  r = await U.aggiornaDaChat();
  assert.equal(r.eseguito, true);
  assert.equal(prova.registro.chiusure, 1);
  assert.equal(prova.registro.lanciati.length, 1);
});

test('il pulsante premuto due volte, o pulsante e chat insieme, lanciano un installatore solo', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  await Promise.all([U.riavviaEAggiorna(), U.riavviaEAggiorna(), U.aggiornaDaChat()]);
  assert.equal(prova.registro.lanciati.length, 1, 'due installatori insieme sulla stessa cartella');
  assert.equal(ricordo().tentativi, 1);
});

test('chi apre Filo da un collegamento d\'invito entra subito: l\'aggiornamento aspetta l\'apertura dopo', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', cartella: dati, avvisoVero: false });
  scaricato(prova);
  prova.registro.argv = ['Filo.exe', 'filo://invito/ABCD-EFGH'];
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
  assert.equal(prova.registro.lanciati.length, 0);
  assert.equal(ricordo().tentativi, 0, 'un avvio saltato contava come tentativo fallito');
  prova.registro.argv = ['Filo.exe', '--updated'];
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), true);
});

const aspettaCarte = () => aspetta(30);
const carteAttive = (tipo) => notifiche.filter((n) => !n.dismissed && n.action?.tipo === tipo);

test('scaricata una versione, la carta con «Riavvia e aggiorna» resta nella home finché la versione non è installata', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prova);
  await aspettaCarte();
  assert.equal(carteAttive('aggiornamento-pronto').length, 1, 'passato l\'avviso a tempo, nella home non resta niente per installarla');
  assert.equal(carteAttive('aggiornamento-pronto')[0].action.versione, '0.2.234');
  scaricato(prova);
  await aspettaCarte();
  assert.equal(carteAttive('aggiornamento-pronto').length, 1, 'la stessa versione scaricata di nuovo ha fatto una seconda carta');
  // Una versione più nuova prende il posto di quella prima.
  scaricato(prova, '0.2.235');
  await aspettaCarte();
  assert.deepEqual(carteAttive('aggiornamento-pronto').map((n) => n.action.versione), ['0.2.235']);
  // Installata, all'apertura dopo la carta se ne va: anche se Filo si apre da un collegamento d'invito.
  U.perProva({ piattaforma: 'win32', versione: '0.2.235', cartella: dati, avvisoVero: false }).registro.argv = ['Filo.exe', 'filo://invito/ABCD'];
  await U.installaAllAvvioSeServe({}, { forza: true });
  await aspettaCarte();
  assert.equal(carteAttive('aggiornamento-pronto').length, 0, 'la carta di una versione già installata è rimasta');
});

test('la carta dell\'apertura prima funziona anche prima che electron-updater ridica «scaricato», o senza rete', async () => {
  preparaCache();
  const prima = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prima);
  // Due installazioni fallite: all'apertura Filo non ci riprova più da solo, la carta resta.
  writeFileSync(join(dati, 'aggiornamento-pronto.json'), JSON.stringify({ ...ricordo(), tentativi: 2, falliti: 2 }));
  const dopo = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  const r = await U.riavviaDallaHome();
  assert.equal(r.ok, true, 'il pulsante della carta risponde che non c\'è niente di pronto');
  assert.equal(dopo.registro.lanciati.length, 1);
  assert.deepEqual(dopo.registro.lanciati[0].argv, ['--updated', '--force-run']);
  assert.equal(dopo.registro.chiusure, 1);
  assert.equal(ricordo().tentativi, 3);
});

test('dopo un riavvio «aggiornati» installa la versione pronta come la carta: senza rete, e mentre il controllo gira', async () => {
  for (const risposta of [
    { evento: 'error', dati: new Error('net::ERR_INTERNET_DISCONNECTED') },
    { evento: 'update-available', dati: { version: '0.2.234' } },
  ]) {
    preparaCache();
    const prima = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
    scaricato(prima);
    writeFileSync(join(dati, 'aggiornamento-pronto.json'), JSON.stringify({ ...ricordo(), tentativi: 2, falliti: 2 }));
    const dopo = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
    dopo.registro.risposta = risposta;
    const st = await U.statoAggiornamento();
    assert.equal(st.riavvio, true, `${risposta.evento}: la chat non chiederebbe la conferma del riavvio`);
    assert.equal(st.versione, '0.2.234');
    const r = await U.aggiornaDaChat({ riavvio: true });
    assert.equal(r.esito, 'riavvio', `${risposta.evento}: ${r.frase}`);
    assert.equal(dopo.registro.lanciati.length, 1);
    assert.equal(dopo.registro.chiusure, 1);
  }
});

test('mentre si scarica, «aggiornati» promette «Riavvia e aggiorna» solo dove il pulsante arriverà', async () => {
  for (const [piattaforma, attesa] of [['darwin', false], ['linux', false], ['win32', true]]) {
    const dati2 = cartellaTemporanea('filo-agg-scarica-');
    const prova = U.perProva({ piattaforma, versione: '0.2.233', cartella: dati2, avvisoVero: false });
    prova.finto.emit('update-available', { version: '0.2.234' });
    const r = await U.aggiornaDaChat({ riavvio: true });
    assert.equal(/Riavvia e aggiorna/.test(r.frase), attesa, `${piattaforma}: ${r.frase}`);
    assert.match(r.frase, /0\.2\.234/);
  }
});

test('dalla carta, un installatore manomesso non parte e Filo resta aperto', async () => {
  preparaCache();
  const prima = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  scaricato(prima);
  writeFileSync(installatore, 'MZ manomesso');
  const dopo = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  const r = await U.riavviaDallaHome();
  assert.equal(r.ok, false);
  assert.equal(dopo.registro.lanciati.length + dopo.registro.chiusure, 0);
});

test('la conferma di «aggiornati» promette la barra solo dove c\'è', () => {
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const descrivi = (a) => globalThis.SN_ACTION_LEVELS.describe({ type: 'INSTALLA_AGGIORNAMENTO', ...a });
  const win = descrivi({ _riavvio: true, _versione: '0.2.234', _conBarra: true });
  const lin = descrivi({ _riavvio: true, _versione: '0.2.234', _conBarra: false });
  assert.match(win, /barra di avanzamento/);
  assert.doesNotMatch(lin, /barra/, 'su Linux la conferma promette una barra che non c\'è');
  assert.match(lin, /si riapre da solo/);
});

test('fuori da Windows la scelta di quando installare, chiesta o letta a parole, dice che lì non vale', () => {
  for (const m of ['preferences', 'cambi', 'vociImpostazioni']) require(join(ROOT, 'src', 'shared', `${m}.js`));
  const P = globalThis.SN_PREF;
  const V = globalThis.SN_VOCI_IMPOSTAZIONI;
  const impostazioni = { aggiornamenti: { installa: 'avvio' } };
  for (const piattaforma of ['linux', 'darwin']) {
    U.perProva({ piattaforma, cartella: cartellaTemporanea('filo-agg-scelta-'), avvisoVero: false });
    for (const valore of ['all\'apertura', 'in silenzio']) {
      const b = P.buildPreferencePartial('installazione aggiornamenti', valore);
      assert.ok(b && b.rifiuto && !b.partial, `${piattaforma}, ${valore}: ${JSON.stringify(b)}`);
      assert.match(b.rifiuto, /solo su Windows/);
    }
    assert.match(V.valoreLeggibile('aggiornamenti.installa', impostazioni), /solo su Windows/);
  }
  U.perProva({ piattaforma: 'win32', cartella: cartellaTemporanea('filo-agg-scelta-'), avvisoVero: false });
  assert.deepEqual(P.buildPreferencePartial('installazione aggiornamenti', 'in silenzio').partial, { aggiornamenti: { installa: 'chiusura' } });
  assert.doesNotMatch(V.valoreLeggibile('aggiornamenti.installa', impostazioni), /Windows/);
});

test('con «Installa gli aggiornamenti da solo» spento (#786) la versione scaricata aspetta che l\'utente la chieda', async () => {
  preparaCache();
  const prova = U.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella: dati, avvisoVero: false });
  const spento = { aggiornamenti: { automatici: false } };
  U.seguiImpostazioni(spento);
  assert.equal(prova.finto.autoDownload, false);
  prova.finto.emit('update-available', { version: '0.2.234' });
  await aspettaCarte();
  assert.equal(carteAttive('aggiornamento-disponibile').length, 1, 'nessuna carta «Installa»');
  // Spenta a metà scaricamento: la versione arriva lo stesso.
  scaricato(prova);
  await aspettaCarte();
  assert.equal(prova.registro.avvisi.length, 0, 'l\'avviso a tempo promette un\'installazione che non è stata chiesta');
  assert.deepEqual(carteAttive('aggiornamento-pronto').map((n) => n.action.versione), ['0.2.234']);
  assert.equal(carteAttive('aggiornamento-disponibile').length, 0, 'due carte per la stessa versione');
  assert.equal(await U.installaAllAvvioSeServe(spento, { forza: true }), false);
  assert.equal(prova.registro.lanciati.length, 0, 'spento, all\'apertura si è installata una versione mai chiesta');
  // «aggiornati» la chiede: con la versione pronta riavvia e la installa.
  const r = await U.aggiornaDaChat({ riavvio: true });
  assert.equal(r.esito, 'riavvio', r.frase);
  assert.equal(prova.registro.lanciati.length, 1);
});
