// #786 — «Installa gli aggiornamenti da solo»: spento, Filo controlla ma non scarica né installa finché l'utente non
// preme «Installa» sulla carta della home; acceso, tutto come prima. La decisione gira su un aggiornatore finto.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
// L'aggancio vero di electron-updater all'installazione alla chiusura: la sua regola decide l'esito.
// Per nome, non per percorso: nella prova sulla fusione node_modules sta nella cartella sopra la radice.
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');

let carte;
function memoriaFinta() {
  carte = [];
  let id = 0;
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => carte.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: `n${++id}`, dismissed: false }; carte.unshift(e); return e; },
    dismissNotification: async (nid, { acted = false } = {}) => {
      const n = carte.find((x) => x.id === nid);
      if (n) Object.assign(n, { dismissed: true, acted });
      return carte;
    },
  };
}
const vive = () => carte.filter((n) => !n.dismissed && n.action?.tipo === U.TIPO_DISPONIBILE);

// `versione: null`: il feed non ha niente di nuovo. `lento`: lo scaricamento finisce quando la prova chiama `finisci()`.
function aggiornatoreFinto({ versione = '0.3.0', scaricamentoRotto = false, lento = false } = {}) {
  const ascolta = {};
  const allaChiusura = [];
  const u = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    scaricamenti: 0,
    installata: false,
    quitHandlerAdded: false,
    quitAndInstallCalled: false,
    _logger: { info() {} },
    app: { onQuit: (f) => allaChiusura.push(f) },
    install() { u.installata = true; return true; },
    chiudi() { for (const f of allaChiusura) f(0); },
    on(e, f) { (ascolta[e] ||= []).push(f); return u; },
    emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
    async checkForUpdates() {
      if (!versione) {
        u.emit('update-not-available', {});
        return { isUpdateAvailable: false };
      }
      u.emit('update-available', { version: versione });
      return { updateInfo: { version: versione }, downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
    },
    checkForUpdatesAndNotify() { return u.checkForUpdates(); },
    async downloadUpdate() {
      // Già scaricata, electron-updater la ritrova in cache: niente rete, ma rifà evento e aggancio.
      if (u.scaricata) {
        u.emit('update-downloaded', { version: versione });
        BaseUpdater.prototype.addQuitHandler.call(u);
        return ['Filo-Setup.exe'];
      }
      u.scaricamenti += 1;
      u.emit('download-progress', { percent: 42.7 });
      if (scaricamentoRotto) {
        const e = new Error('rete caduta');
        u.emit('error', e);
        throw e;
      }
      if (lento) await new Promise((ok) => { u.finisci = ok; });
      // Come electron-updater: prima l'evento, poi l'aggancio alla chiusura.
      u.scaricata = true;
      u.emit('update-downloaded', { version: versione });
      BaseUpdater.prototype.addQuitHandler.call(u);
      return ['Filo-Setup.exe'];
    },
  };
  return u;
}

// L'aggiornatore finto risponde in microtask: un giro del ciclo li esaurisce tutti, compresa la fila degli avvisi.
const calma = () => new Promise((r) => setImmediate(r));

async function avvia(u, automatici, { modo } = {}) {
  // Ogni prova parte senza un «Installa» lasciato da quella prima.
  await U.avviaAggiornatore(u, { automatici, chiesta: null, modo });
  await calma();
}

function conPiattaforma(p, fn) {
  const vero = process.platform;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  return Promise.resolve().then(fn).finally(() => {
    Object.defineProperty(process, 'platform', { value: vero, configurable: true });
  });
}

// La piattaforma si inietta, mai quella che esegue la prova: nata su Linux, la prova era rossa solo su Windows.
// Su Windows di serie la versione pronta si installa all'apertura dopo, con la barra visibile; alla chiusura solo
// se l'utente l'ha scelto (#1039). Mac e Linux installano alla chiusura.
const SISTEMI = [
  { nome: 'Linux', piattaforma: 'linux', allaChiusura: true },
  { nome: 'Mac', piattaforma: 'darwin', allaChiusura: true },
  { nome: 'Windows, scelta la chiusura', piattaforma: 'win32', modo: 'chiusura', allaChiusura: true },
  { nome: 'Windows, di serie', piattaforma: 'win32', allaChiusura: false },
];
function perOgniSistema(titolo, fn) {
  for (const s of SISTEMI) test(`${titolo} (${s.nome})`, () => conPiattaforma(s.piattaforma, () => fn(s)));
}
// Cambiare «automatici» dalle Preferenze non deve riportare Windows al modo di serie.
const impostazioni = (s, automatici) => ({ aggiornamenti: { automatici, ...(s.modo ? { installa: s.modo } : {}) } });
const pronta = (s) => (s.allaChiusura ? { pronta: true } : { pronta: true, allApertura: true });

beforeEach(() => memoriaFinta());

perOgniSistema('spento: la versione nuova non si scarica e non si installa, e in home c\'è la sua carta con «Installa»', async (s) => {
  const u = aggiornatoreFinto();
  await avvia(u, false, s);
  assert.equal(u.scaricamenti, 0, 'da spento la versione nuova è partita da sola');
  assert.equal(u.autoDownload, false);
  assert.equal(u.autoInstallOnAppQuit, false, 'da spento si installerebbe alla chiusura');
  assert.equal(vive().length, 1, 'nessuna carta: l\'utente non saprebbe che c\'è una versione nuova');
  assert.equal(vive()[0].action.versione, '0.3.0');
  assert.match(vive()[0].text, /versione 0\.3\.0/);
  assert.match(vive()[0].text, /«Installa»/);
  assert.ok(!/aggiornamento-disponibile/.test(vive()[0].text), 'il marcatore interno è finito nel testo');
});

perOgniSistema('acceso: scarica da solo, si installa quando lo prevede il sistema e non scrive carte «Installa»', async (s) => {
  const u = aggiornatoreFinto();
  await avvia(u, true, s);
  assert.equal(u.autoDownload, true);
  assert.equal(u.autoInstallOnAppQuit, s.allaChiusura);
  assert.equal(u.scaricamenti, 1);
  assert.deepEqual(vive(), []);
  u.chiudi();
  assert.equal(u.installata, s.allaChiusura, s.allaChiusura ? 'acceso, alla chiusura non si è installata'
    : 'su Windows di serie si è installata alla chiusura, senza farsi vedere (#1039)');
});

perOgniSistema('«Installa» scarica, la carta mostra a che punto è e poi quando si installa', async (s) => {
  const u = aggiornatoreFinto();
  let stati = [];
  await U.avviaAggiornatore(u, {
    automatici: false,
    modo: s.modo,
    annuncia: () => { stati.push(U.conStatoAggiornamento(vive())[0]?.aggiornamento || null); },
  });
  await calma();
  stati = [];
  const r = await U.installaAggiornamento();
  assert.equal(r.ok, true);
  assert.equal(r.versione, '0.3.0');
  await calma();
  assert.equal(u.scaricamenti, 1);
  assert.equal(u.autoInstallOnAppQuit, s.allaChiusura);
  u.chiudi();
  assert.equal(u.installata, s.allaChiusura, s.allaChiusura ? 'premuto «Installa», alla chiusura non si è installata'
    : 'su Windows di serie si è installata alla chiusura invece che all\'apertura dopo');
  assert.ok(stati.some((x) => x && x.percento === 42), `la carta non ha mai mostrato lo scaricamento: ${JSON.stringify(stati)}`);
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, pronta(s), 'la carta non dice quando si installa');
  // Premere due volte non scarica due volte.
  await U.installaAggiornamento();
  await calma();
  assert.equal(u.scaricamenti, 1);
});

test('una carta sola per versione: un riavvio non la ripete, e chi l\'ha chiusa non se la ritrova', async () => {
  await avvia(aggiornatoreFinto(), false);
  await avvia(aggiornatoreFinto(), false);
  assert.equal(vive().length, 1, 'ogni avvio aggiunge una carta uguale');
  vive()[0].dismissed = true;
  await avvia(aggiornatoreFinto(), false);
  assert.equal(vive().length, 0, 'una carta chiusa è tornata per la stessa versione');
  await avvia(aggiornatoreFinto({ versione: '0.3.1' }), false);
  assert.deepEqual(vive().map((n) => n.action.versione), ['0.3.1'], 'una versione ancora più nuova non è stata segnalata');
});

test('una versione più nuova prende il posto della carta di quella prima', async () => {
  await avvia(aggiornatoreFinto({ versione: '0.3.0' }), false);
  await avvia(aggiornatoreFinto({ versione: '0.3.1' }), false);
  assert.deepEqual(vive().map((n) => n.action.versione), ['0.3.1']);
});

perOgniSistema('spento a sessione aperta: quello già scaricato non si installa da solo, e la carta lo propone', async (s) => {
  const u = aggiornatoreFinto();
  await avvia(u, true, s);
  U.seguiImpostazioni(impostazioni(s, false));
  await calma();
  assert.equal(u.autoInstallOnAppQuit, false, 'spento dopo lo scaricamento dell\'avvio, si installerebbe lo stesso');
  assert.equal(vive().length, 1);
  assert.equal(U.conStatoAggiornamento(vive())[0].aggiornamento, undefined, 'la carta dice che si installa, ma non succederà');
  await U.installaAggiornamento();
  await calma();
  assert.equal(u.autoInstallOnAppQuit, s.allaChiusura);
  assert.equal(u.scaricamenti, 1, 'una versione già scaricata non si riscarica');
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, pronta(s));
});

perOgniSistema('spento a metà dello scaricamento dell\'avvio, «Installa» la installa davvero', async (s) => {
  const u = aggiornatoreFinto({ lento: true });
  await avvia(u, true, s);
  U.seguiImpostazioni(impostazioni(s, false));
  await calma();
  u.finisci();
  await calma();
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, undefined, 'spenta, la carta chiede ancora «Installa»');
  await U.installaAggiornamento();
  await calma();
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, pronta(s));
  u.chiudi();
  assert.equal(u.installata, s.allaChiusura, s.allaChiusura ? 'la carta dice «pronta», ma alla chiusura non si è installata'
    : 'su Windows di serie si è installata alla chiusura invece che all\'apertura dopo');
  assert.equal(u.scaricamenti, 1, 'una versione già scaricata non si riscarica');
});

perOgniSistema('spento a metà dello scaricamento e poi riacceso: si installa come da acceso', async (s) => {
  const u = aggiornatoreFinto({ lento: true });
  await avvia(u, true, s);
  U.seguiImpostazioni(impostazioni(s, false));
  await calma();
  u.finisci();
  await calma();
  U.seguiImpostazioni(impostazioni(s, true));
  await calma();
  assert.equal(u.autoInstallOnAppQuit, s.allaChiusura);
  u.chiudi();
  assert.equal(u.installata, s.allaChiusura);
});

perOgniSistema('spento a metà dello scaricamento e lasciato spento: alla chiusura non si installa', async (s) => {
  const u = aggiornatoreFinto({ lento: true });
  await avvia(u, true, s);
  U.seguiImpostazioni(impostazioni(s, false));
  await calma();
  u.finisci();
  await calma();
  u.chiudi();
  assert.equal(u.installata, false);
});

perOgniSistema('chiusa la carta, chiedendolo (a Filo) la versione si installa lo stesso', async (s) => {
  const u = aggiornatoreFinto();
  await avvia(u, false, s);
  vive()[0].dismissed = true;
  const r = await U.installaAggiornamento();
  await calma();
  assert.equal(r.ok, true);
  assert.equal(r.versione, '0.3.0');
  assert.equal(u.scaricamenti, 1);
  assert.equal(u.autoInstallOnAppQuit, s.allaChiusura);
  u.chiudi();
  assert.equal(u.installata, s.allaChiusura);
});

// La richiesta di «Installa» sta nel disco: un riavvio a metà scaricamento non la perde.
async function conDiscoFinto(fn) {
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  const disco = {};
  globalThis.SN_STORAGE = {
    getRaw: async (k, f) => (disco[k] === undefined ? f : disco[k]),
    setRaw: async (k, v) => { disco[k] = v; },
  };
  try { await fn(disco); } finally { delete globalThis.SN_STORAGE; }
}
async function riavvia(versioneInUso, { automatici = false, versione = '0.3.0', modo } = {}) {
  await U.togliAvvisiSuperati(versioneInUso);
  const u = aggiornatoreFinto({ versione, lento: true });
  await U.avviaAggiornatore(u, { automatici, chiesta: await U.richiestaValida(versioneInUso), modo });
  await calma();
  await calma();
  return u;
}

perOgniSistema('spento, «Installa» e Filo chiuso a metà scaricamento: al riavvio la versione chiesta riprende e si installa', async (s) => {
  for (const via of ['carta', 'chat']) {
    await conDiscoFinto(async () => {
      memoriaFinta();
      const prima = aggiornatoreFinto({ lento: true });
      await avvia(prima, false, s);
      if (via === 'chat') vive()[0].dismissed = true;
      await U.installaAggiornamento();
      await calma();
      assert.equal(prima.scaricamenti, 1);
      prima.chiudi();
      assert.equal(prima.installata, false);

      const dopo = await riavvia('0.2.0', { modo: s.modo });
      assert.equal(dopo.scaricamenti, 1, `${via}: al riavvio la versione chiesta non riprende a scaricare`);
      if (via === 'carta') {
        const [carta] = U.conStatoAggiornamento(vive());
        assert.ok(carta.aggiornamento && carta.aggiornamento.percento != null, `la carta chiede di nuovo «Installa»: ${JSON.stringify(carta)}`);
      }
      dopo.finisci();
      await calma();
      if (via === 'carta') assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, pronta(s));
      dopo.chiudi();
      assert.equal(dopo.installata, s.allaChiusura, `${via}: dopo il riavvio la versione chiesta non si installa quando deve`);
    });
  }
});

test('la richiesta si scorda quando la versione è installata o il feed ne offre un\'altra', async () => {
  await conDiscoFinto(async (disco) => {
    const chiave = globalThis.SN_CONST.STORAGE_KEYS.AGGIORNAMENTO_CHIESTO;
    const prima = aggiornatoreFinto({ lento: true });
    await avvia(prima, false);
    await U.installaAggiornamento();
    await calma();
    assert.deepEqual(disco[chiave], { versione: '0.3.0' });
    // Installata: al riavvio non scarica niente da sé.
    const installata = await riavvia('0.3.0', { versione: '0.3.0' });
    assert.equal(disco[chiave], null);
    assert.equal(installata.scaricamenti, 0);

    disco[chiave] = { versione: '0.3.0' };
    // Il feed offre una versione più nuova di quella chiesta: torna la carta con «Installa», senza scaricare.
    const altra = await riavvia('0.2.0', { versione: '0.4.0' });
    assert.equal(altra.scaricamenti, 0);
    assert.equal(disco[chiave], null);
    assert.ok(vive().some((n) => n.action.versione === '0.4.0'));
  });
});

test('chiesto quando non c\'è niente di nuovo, l\'esito lo dice e non scarica niente', async () => {
  const u = aggiornatoreFinto({ versione: null });
  await avvia(u, false);
  const r = await U.installaAggiornamento();
  await calma();
  assert.equal(r.ok, true);
  assert.equal(r.stato, 'aggiornato');
  assert.equal(r.versione, null);
  assert.equal(u.scaricamenti, 0);
});

test('riacceso a sessione aperta: scarica come all\'avvio e si installa alla chiusura', async () => {
  const u = aggiornatoreFinto();
  await avvia(u, false);
  U.seguiImpostazioni({ aggiornamenti: { automatici: true } });
  await calma();
  assert.equal(u.scaricamenti, 1);
  assert.equal(u.autoInstallOnAppQuit, true);
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, { pronta: true });
});

test('su Windows uno scaricamento che non riesce resta sulla carta, con «Installa» per riprovare', async () => {
  await conPiattaforma('win32', async () => {
    const u = aggiornatoreFinto({ scaricamentoRotto: true });
    await avvia(u, false);
    await U.installaAggiornamento();
    await calma();
    const a = U.conStatoAggiornamento(vive())[0].aggiornamento;
    assert.ok(a && /non è riuscito/.test(a.errore), `la carta non dice che non è andata: ${JSON.stringify(a)}`);
  });
});

test('su Linux, se non si installa, l\'avviso che dice cosa fare prende il posto della carta', async () => {
  await conPiattaforma('linux', async () => {
    await avvia(aggiornatoreFinto({ scaricamentoRotto: true }), false);
    await U.installaAggiornamento();
    await calma();
    assert.equal(vive().length, 0, 'restano due carte per la stessa versione');
    assert.ok(carte.some((n) => !n.dismissed && n.action?.tipo === 'aggiornamento-linux'));
  });
});

test('una versione già installata non resta in home a chiedere «Installa»', async () => {
  await avvia(aggiornatoreFinto({ versione: '0.3.0' }), false);
  await U.togliAvvisiSuperati('0.2.999');
  assert.equal(vive().length, 1, 'tolta la carta di una versione che non c\'è ancora');
  await U.togliAvvisiSuperati('0.3.0');
  assert.equal(vive().length, 0);
  await avvia(aggiornatoreFinto({ versione: '0.10.0' }), false);
  await U.togliAvvisiSuperati('0.9.5');
  assert.equal(vive().length, 1, '0.10 è più nuova di 0.9');
});

test('senza aggiornatore (Filo avviato dal codice) «Installa» dice dove prenderla', async () => {
  delete require.cache[require.resolve(join(ROOT, 'src', 'main', 'updater.js'))];
  const fresco = require(join(ROOT, 'src', 'main', 'updater.js'));
  const r = await fresco.installaAggiornamento();
  assert.equal(r.ok, false);
  assert.match(r.error, /filo\.red/);
});

test('dalla chat: la preferenza cambia solo dopo una conferma che spiega il rischio', () => {
  globalThis.self = globalThis;
  for (const m of ['tabColor', 'constants', 'contenutoEsterno', 'preferences']) require(join(ROOT, 'src', 'shared', `${m}.js`));
  const P = globalThis.SN_PREF;
  for (const chiave of ['aggiornamenti_automatici', 'installa gli aggiornamenti da solo', 'aggiornamenti automatici']) {
    const r = P.buildPreferencePartial(chiave, 'no');
    assert.deepEqual(r.partial, { aggiornamenti: { automatici: false } }, chiave);
    assert.equal(r.costo, 2);
    assert.equal(r.allenta, true, 'spegnerli dalla chat abbassa una difesa: vuole «conferma» a ogni livello (#530)');
    assert.match(r.risk, /sicurezza/);
  }
  assert.deepEqual(P.buildPreferencePartial('aggiornamenti_automatici', 'sì').partial, { aggiornamenti: { automatici: true } });
  assert.equal(globalThis.SN_CONST.DEFAULT_SETTINGS.aggiornamenti.automatici, true, 'di serie deve restare acceso');
});
