import { test, expect } from '../../fixtures/electron.mjs';

function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents));
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try {
      return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) };
    } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}

test('esplora il mondo del preload', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const r = await sito(`(() => {
    const out = { require: typeof require, process: typeof process, ipc: typeof ipcRenderer, electron: typeof electron };
    const nomi = Object.getOwnPropertyNames(globalThis).filter((k) => !(k in Object.getPrototypeOf(globalThis) ) );
    out.globali = nomi.filter((k) => /^(SN_|filo|__|chrome|ipc|_)/i.test(k));
    const cerca = [];
    for (const k of nomi) {
      try {
        const v = globalThis[k];
        if (v && typeof v === 'object') for (const kk of Object.keys(v)) if (/ipc|send|invoke/i.test(kk)) cerca.push(k + '.' + kk);
      } catch (_) {}
    }
    out.cerca = cerca.slice(0, 80);
    out.chrome = typeof chrome === 'object' ? Object.keys(chrome) : null;
    out.runtime = typeof chrome === 'object' && chrome.runtime ? Object.keys(chrome.runtime) : null;
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
  expect(r.errore).toBeFalsy();
});
