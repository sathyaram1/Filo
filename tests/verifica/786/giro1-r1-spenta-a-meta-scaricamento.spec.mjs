// Verifica #786 giro 1, rilievo 1: spenta l'opzione mentre la versione dell'avvio sta ancora scaricando, «Installa»
// sulla carta deve farla installare alla chiusura. Gira sul gancio di chiusura VERO di electron-updater (che si
// aggancia solo a scaricamento finito, se in quel momento l'installazione alla chiusura è accesa).

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

// Come electron-updater: a scaricamento finito emette «update-downloaded» e poi chiama il suo addQuitHandler.
function aggiornatore(versione = '9.9.9') {
  const ascolta = {};
  const allaChiusura = [];
  const u = {
    autoDownload: true, autoInstallOnAppQuit: true, quitHandlerAdded: false, quitAndInstallCalled: false,
    installato: false, scaricamenti: 0, pronto: false,
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
      if (u.pronto) { u.emit('update-downloaded', { version: versione }); BaseUpdater.prototype.addQuitHandler.call(u); return Promise.resolve([]); }
      return new Promise((ok) => {
        u.finisci = () => {
          u.pronto = true;
          u.emit('update-downloaded', { version: versione });
          BaseUpdater.prototype.addQuitHandler.call(u);
          ok([]);
        };
      });
    },
    chiudi() { for (const f of allaChiusura) f(0); },
  };
  return u;
}

const calma = () => new Promise((r) => setImmediate(r));

test('spenta a metà dello scaricamento dell\'avvio, «Installa» la installa davvero alla chiusura', async () => {
  memoriaFinta();
  const u = aggiornatore();
  U.avviaAggiornatore(u, { automatici: true });
  await calma();
  // L'utente toglie la spunta mentre la versione sta ancora scaricando.
  U.seguiImpostazioni({ aggiornamenti: { automatici: false } });
  await calma();
  u.finisci();
  await calma();
  // In home c'è la carta con «Installa»: la preme.
  const r = await U.installaAggiornamento();
  expect(r.ok).toBe(true);
  await calma();
  u.chiudi();
  expect(u.installato, 'premuto «Installa», alla chiusura la versione non si è installata').toBe(true);
});

test('controllo: spenta dopo lo scaricamento finito, «Installa» la installa alla chiusura', async () => {
  memoriaFinta();
  const u = aggiornatore();
  U.avviaAggiornatore(u, { automatici: true });
  await calma();
  u.finisci();
  await calma();
  U.seguiImpostazioni({ aggiornamenti: { automatici: false } });
  await calma();
  await U.installaAggiornamento();
  await calma();
  u.chiudi();
  expect(u.installato).toBe(true);
});
