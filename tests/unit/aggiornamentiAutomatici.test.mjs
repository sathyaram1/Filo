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

function aggiornatoreFinto({ versione = '0.3.0', scaricamentoRotto = false } = {}) {
  const ascolta = {};
  const u = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    scaricamenti: 0,
    on(e, f) { (ascolta[e] ||= []).push(f); return u; },
    emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
    async checkForUpdates() {
      u.emit('update-available', { version: versione });
      return { updateInfo: { version: versione }, downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
    },
    checkForUpdatesAndNotify() { return u.checkForUpdates(); },
    async downloadUpdate() {
      u.scaricamenti += 1;
      u.emit('download-progress', { percent: 42.7 });
      if (scaricamentoRotto) {
        const e = new Error('rete caduta');
        u.emit('error', e);
        throw e;
      }
      u.emit('update-downloaded', { version: versione });
      return ['Filo-Setup.exe'];
    },
  };
  return u;
}

// L'aggiornatore finto risponde in microtask: un giro del ciclo li esaurisce tutti, compresa la fila degli avvisi.
const calma = () => new Promise((r) => setImmediate(r));

async function avvia(u, automatici) {
  await U.avviaAggiornatore(u, { automatici });
  await calma();
}

function conPiattaforma(p, fn) {
  const vero = process.platform;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  return Promise.resolve().then(fn).finally(() => {
    Object.defineProperty(process, 'platform', { value: vero, configurable: true });
  });
}

beforeEach(() => memoriaFinta());

test('spento: la versione nuova non si scarica e non si installa, e in home c\'è la sua carta con «Installa»', async () => {
  const u = aggiornatoreFinto();
  await avvia(u, false);
  assert.equal(u.scaricamenti, 0, 'da spento la versione nuova è partita da sola');
  assert.equal(u.autoDownload, false);
  assert.equal(u.autoInstallOnAppQuit, false, 'da spento si installerebbe alla chiusura');
  assert.equal(vive().length, 1, 'nessuna carta: l\'utente non saprebbe che c\'è una versione nuova');
  assert.equal(vive()[0].action.versione, '0.3.0');
  assert.match(vive()[0].text, /versione 0\.3\.0/);
  assert.match(vive()[0].text, /«Installa»/);
  assert.ok(!/aggiornamento-disponibile/.test(vive()[0].text), 'il marcatore interno è finito nel testo');
});

test('acceso: tutto come prima, scarica da solo, si installa alla chiusura e non scrive carte', async () => {
  const u = aggiornatoreFinto();
  await avvia(u, true);
  assert.equal(u.autoDownload, true);
  assert.equal(u.autoInstallOnAppQuit, true);
  assert.equal(u.scaricamenti, 1);
  assert.deepEqual(carte, []);
});

test('«Installa» scarica, la carta mostra a che punto è e poi che si installa alla chiusura', async () => {
  const u = aggiornatoreFinto();
  let stati = [];
  await U.avviaAggiornatore(u, {
    automatici: false,
    annuncia: () => { stati.push(U.conStatoAggiornamento(vive())[0]?.aggiornamento || null); },
  });
  await calma();
  stati = [];
  assert.deepEqual(await U.installaAggiornamento(), { ok: true });
  await calma();
  assert.equal(u.scaricamenti, 1);
  assert.equal(u.autoInstallOnAppQuit, true, 'premuto «Installa», alla chiusura non si installerebbe');
  assert.ok(stati.some((s) => s && s.percento === 42), `la carta non ha mai mostrato lo scaricamento: ${JSON.stringify(stati)}`);
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, { pronta: true });
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

test('spento a sessione aperta: quello già scaricato non si installa alla chiusura, e la carta lo propone', async () => {
  const u = aggiornatoreFinto();
  await avvia(u, true);
  U.seguiImpostazioni({ aggiornamenti: { automatici: false } });
  await calma();
  assert.equal(u.autoInstallOnAppQuit, false, 'spento dopo lo scaricamento dell\'avvio, si installerebbe lo stesso');
  assert.equal(vive().length, 1);
  assert.equal(U.conStatoAggiornamento(vive())[0].aggiornamento, undefined, 'la carta dice che si installa, ma non succederà');
  await U.installaAggiornamento();
  await calma();
  assert.equal(u.autoInstallOnAppQuit, true);
  assert.equal(u.scaricamenti, 1, 'una versione già scaricata non si riscarica');
  assert.deepEqual(U.conStatoAggiornamento(vive())[0].aggiornamento, { pronta: true });
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
    assert.equal(r.level, 2, 'spegnerli dalla chat passa senza conferma');
    assert.match(r.risk, /sicurezza/);
  }
  assert.deepEqual(P.buildPreferencePartial('aggiornamenti_automatici', 'sì').partial, { aggiornamenti: { automatici: true } });
  assert.equal(globalThis.SN_CONST.DEFAULT_SETTINGS.aggiornamenti.automatici, true, 'di serie deve restare acceso');
});
