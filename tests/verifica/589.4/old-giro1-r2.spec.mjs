// #589.4 giro 1, rilievo 2 — la lettura della cronologia appunti la sblocca solo l'utente che apre il menu Incolla su
// quel sito: un clic qualunque sulla pagina, o il clic sulla pagina che ospita il riquadro di un altro sito, non bastano.

import { test, expect } from '../../fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const MONDO_CONTENT_SCRIPT = 999;
const CAMPO = '<!doctype html><html><body style="padding:40px"><button id="ok">Accetta</button><textarea id="ta" rows="5" cols="50"></textarea></body></html>';

async function copiaPassword(shell) {
  const r = await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  expect(r).toEqual({ ok: true });
}

test('isolamento rotto: dopo un clic su un pulsante della pagina il sito in vista non si fa dare la cronologia', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const page = await testServer.openReady(openTab, CAMPO, { pubblico: true });
  await page.locator('#ok').click();
  const r = await app.evaluate(async ({ BrowserWindow }, mondo) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('sito-pubblico.test'));
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: "chrome.runtime.sendMessage({ type: 'get_clipboard_history' })" }]);
  }, MONDO_CONTENT_SCRIPT);
  expect(JSON.stringify(r), 'la cronologia è arrivata al sito dopo un clic che non apriva il menu').not.toContain(PASSWORD);
});

// Il riquadro chiede la cronologia passando dal menu di Filo che apre da sé con un evento finto (unica strada per far
// parlare un riquadro col main da un test): la risposta la decide la stessa regola del gesto.
test('un riquadro di un altro sito, col clic fatto sulla pagina che lo ospita, non ottiene la cronologia', async ({ shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><button id="ospite">Leggi l'articolo</button><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  const frame = page.frames().find((f) => f.url().includes('blocked.test'));
  expect(frame, 'riquadro non trovato').toBeTruthy();
  await frame.waitForFunction(() => document.getElementById('ta'));
  await page.locator('#ospite').click();
  const letto = await frame.evaluate(async () => {
    const ta = document.getElementById('ta');
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10, button: 2 }));
    const aspetta = async (sel) => {
      for (let i = 0; i < 60; i++) { const el = document.querySelector(sel); if (el) return el; await new Promise((ok) => setTimeout(ok, 50)); }
      return null;
    };
    const freccia = await aspetta('.sn-menu-paste-arrow');
    if (!freccia) return '(nessun menu)';
    freccia.click();
    const sub = await aspetta('.sn-menu-history-sub');
    return sub ? sub.textContent : '(nessun sottomenu)';
  });
  expect(letto, 'la cronologia è arrivata al riquadro col gesto fatto sulla pagina ospite').not.toContain(PASSWORD);
});
