// #589.4 — un sito che parla col main dal mondo del preload (isolamento dei contesti rotto) non si fa dare la cronologia
// degli appunti da una scheda di sfondo né senza un gesto, e le scritture non rispondono con l'elenco; il menu Incolla,
// aperto dall'utente col tasto destro, la mostra ancora, anche dentro un riquadro di un altro sito. Regola: services/appuntiDaiSiti.js.

import { test, expect } from './fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const MONDO_CONTENT_SCRIPT = 999;
const CAMPO = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="50"></textarea></body></html>';

function dalSito(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    if (!tab) return { nonTrovata: true };
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { h: host, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

async function copiaPassword(shell) {
  const r = await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  expect(r).toEqual({ ok: true });
}

async function cronologiaDelMenu(dove) {
  await dove.locator('#ta').click({ button: 'right' });
  await expect(dove.locator('.sn-menu')).toBeVisible();
  await dove.locator('.sn-menu-paste-arrow').click();
  const sub = dove.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  return sub;
}

test('da una scheda di sfondo o senza un gesto la cronologia appunti non esce; il menu Incolla la mostra ancora', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  await testServer.openReady(openTab, CAMPO);
  const inVista = await testServer.openReady(openTab, CAMPO, { pubblico: true });
  const sfondo = dalSito(app, '127.0.0.1');
  const davanti = dalSito(app, 'sito-pubblico.test');

  // La scheda di sfondo chiede l'elenco, e lo cerca nelle risposte di aggiungi, togli e descrivi.
  const domande = [
    { type: 'get_clipboard_history' },
    { type: 'push_clipboard_entry', entry: { type: 'text', text: 'voce del sito' } },
    { type: 'remove_clipboard_entry', entry: { type: 'text', text: 'voce del sito' } },
    { type: 'update_clipboard_description', dataUrl: 'data:image/png;base64,AAAA', description: 'x' },
  ];
  for (const m of domande) {
    const r = await sfondo(m);
    expect(r?.nonTrovata, 'la scheda di sfondo non è stata trovata').toBeFalsy();
    expect(JSON.stringify(r), `${m.type}: l'elenco è arrivato alla scheda di sfondo`).not.toContain(PASSWORD);
  }
  expect(await sfondo(domande[0])).toMatchObject({ ok: false, code: 'forbidden' });

  // La scheda in vista, senza che l'utente ci abbia fatto niente, nemmeno.
  const senzaGesto = await davanti(domande[0]);
  expect(senzaGesto).toMatchObject({ ok: false, code: 'forbidden' });
  expect(JSON.stringify(senzaGesto)).not.toContain(PASSWORD);

  // L'utente apre il menu Incolla nella scheda che guarda: la cronologia c'è, password compresa.
  const sub = await cronologiaDelMenu(inVista);
  await expect(sub).toContainText(PASSWORD);

  // Il gesto vale per la scheda dove è stato fatto: quella di sfondo resta fuori.
  expect(await sfondo(domande[0])).toMatchObject({ ok: false, code: 'forbidden' });
});

test('nel riquadro di un altro sito il menu Incolla mostra la cronologia', async ({ shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  const sub = await cronologiaDelMenu(page.frameLocator('#embed'));
  await expect(sub).toContainText(PASSWORD);
});

test('le pagine di Filo leggono la cronologia senza gesto', async ({ shell }) => {
  await copiaPassword(shell);
  const r = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
  expect(r.ok).toBe(true);
  expect(r.items.some((i) => i.text === PASSWORD)).toBe(true);
});
