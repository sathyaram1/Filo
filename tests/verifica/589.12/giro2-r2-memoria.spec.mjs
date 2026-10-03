// #589.12 giro 2, rilievo 2 — memoria, notifiche e timer dell'utente arrivano al codice di Filo nella scheda di un sito.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const SEGRETO_MEMORIA = 'Abita in via Segreta 12';

function dalSito(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    if (!tab) return { nonTrovata: true };
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { h: host, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

test('memoria, notifiche e timer non arrivano a un sito; la home li legge', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (_e, segreto) => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: segreto, PREFERENZE: '' });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Bonifico ricevuto 589' });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Visita medica 589', seconds: 3600 });
  }, SEGRETO_MEMORIA);

  await testServer.openReady(openTab, '<!doctype html><html><body><p>sito B</p></body></html>', { pubblico: true });
  const daB = dalSito(app, 'sito-pubblico.test');
  const M = await app.evaluate(() => globalThis.SN_MSG.MSG);
  const risposte = {
    memoria: await daB({ type: M.FILO_GET_MEMORY }),
    notifiche: await daB({ type: M.FILO_GET_NOTIFICATIONS }),
    timer: await daB({ type: M.FILO_GET_TIMERS }),
  };
  const tutto = JSON.stringify(risposte);
  expect(tutto).not.toContain(SEGRETO_MEMORIA);
  expect(tutto).not.toContain('Bonifico ricevuto 589');
  expect(tutto).not.toContain('Visita medica 589');

  const home = await openTab('filo://home/home.html');
  const daHome = await home.evaluate(async () => {
    const MSG = window.SN_MSG.MSG;
    const [m, n, t] = await Promise.all([
      chrome.runtime.sendMessage({ type: MSG.FILO_GET_MEMORY }),
      chrome.runtime.sendMessage({ type: MSG.FILO_GET_NOTIFICATIONS }),
      chrome.runtime.sendMessage({ type: MSG.FILO_GET_TIMERS }),
    ]);
    return JSON.stringify({ m, n, t });
  });
  expect(daHome).toContain(SEGRETO_MEMORIA);
  expect(daHome).toContain('Bonifico ricevuto 589');
  expect(daHome).toContain('Visita medica 589');
});
