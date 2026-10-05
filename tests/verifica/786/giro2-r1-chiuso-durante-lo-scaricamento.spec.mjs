// Verifica #786 giro 2, rilievo 1: opzione spenta, premuto «Installa», Filo chiuso mentre la versione scarica.
// Al riavvio la richiesta dell'utente deve valere ancora: la versione riprende a scaricare e si installa alla chiusura.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { BaseUpdater } = require(join(ROOT, 'node_modules', 'electron-updater', 'out', 'BaseUpdater.js'));

function memoriaFinta() {
  const carte = [];
  let id = 0;
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => carte.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: `n${++id}`, dismissed: false }; carte.unshift(e); return e; },
    dismissNotification: async (nid) => { const n = carte.find((x) => x.id === nid); if (n) n.dismissed = true; return carte; },
  };
  return carte;
}

// Uno scaricamento che non finisce da solo; alla chiusura electron-updater lo abbandona.
function aggiornatore(versione = '9.9.9') {
  const ascolta = {};
  const allaChiusura = [];
  const u = {
    autoDownload: true, autoInstallOnAppQuit: true, quitHandlerAdded: false, quitAndInstallCalled: false,
    installato: false, scaricamenti: 0,
    _logger: { info() {} },
    app: { onQuit: (f) => allaChiusura.push(f) },
    install() { u.installato = true; },
    on(e, f) { (ascolta[e] ||= []).push(f); return u; },
    emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
    async checkForUpdates() {
      u.emit('update-available', { version: versione });
      return { downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
    },
    checkForUpdatesAndNotify() { return u.checkForUpdates(); },
    downloadUpdate() {
      u.scaricamenti += 1;
      u.emit('download-progress', { percent: 37 });
      return new Promise((ok) => {
        u.finisci = () => { u.emit('update-downloaded', { version: versione }); BaseUpdater.prototype.addQuitHandler.call(u); ok([]); };
      });
    },
    chiudi() { for (const f of allaChiusura) f(0); },
  };
  return u;
}

const calma = () => new Promise((r) => setImmediate(r));

test('spenta, «Installa» premuto e Filo chiuso a metà scaricamento: al riavvio la versione chiesta riprende a scaricare', async () => {
  const carte = memoriaFinta();
  const prima = aggiornatore();
  U.avviaAggiornatore(prima, { automatici: false });
  await calma();
  const r = await U.installaAggiornamento();
  expect(r.ok).toBe(true);
  await calma();
  expect(prima.scaricamenti).toBe(1);
  // La carta dice «Scarico la versione 9.9.9: 37%»: l'utente chiude Filo perché «si installa quando chiudi Filo».
  prima.chiudi();
  expect(prima.installato).toBe(false);

  // Riavvio, opzione sempre spenta.
  const dopo = aggiornatore();
  U.avviaAggiornatore(dopo, { automatici: false });
  await calma();
  const [carta] = U.conStatoAggiornamento(carte.filter((n) => !n.dismissed));
  expect(dopo.scaricamenti, `al riavvio la carta chiede di nuovo «Installa»: ${JSON.stringify(carta)}`).toBe(1);
  dopo.finisci();
  await calma();
  dopo.chiudi();
  expect(dopo.installato, 'la versione chiesta non si installa alla chiusura dopo il riavvio').toBe(true);
});
