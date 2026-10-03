// #589.4 — un sito che parla col main dal mondo del preload (isolamento dei contesti rotto) non si fa dare la cronologia
// degli appunti da una scheda di sfondo, né dopo un clic qualunque, né dal menu aperto in un altro riquadro, e non la
// svuota senza un gesto; il menu Incolla aperto dall'utente la mostra ancora, anche in un riquadro. Regola: services/appuntiDaiSiti.js.

import { test, expect } from './fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const MONDO_CONTENT_SCRIPT = 999;
const CAMPO = '<!doctype html><html><body style="padding:40px"><button id="ok">Accetta</button><textarea id="ta" rows="5" cols="50"></textarea></body></html>';

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

test('un clic qualunque sulla pagina non apre la cronologia: serve il menu, aperto proprio nel riquadro che chiede', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const page = await testServer.openReady(openTab, CAMPO, { pubblico: true });
  await page.locator('#ok').click();
  const dopoUnClic = await dalSito(app, 'sito-pubblico.test')({ type: 'get_clipboard_history' });
  expect(dopoUnClic).toMatchObject({ ok: false, code: 'forbidden' });
  expect(JSON.stringify(dopoUnClic)).not.toContain(PASSWORD);

  // Un riquadro di un altro sito non approfitta del clic fatto sulla pagina che lo ospita: chiede con un menu finto.
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const ospite = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><button id="ospite">Leggi</button><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  const frame = ospite.frames().find((f) => f.url().includes('blocked.test'));
  await frame.waitForFunction(() => document.getElementById('ta'));
  await ospite.locator('#ospite').click();
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
    const sub = await aspetta('.sn-menu-history-sub, .sn-menu-sub');
    return sub ? sub.textContent : '(nessun sottomenu)';
  });
  expect(letto).not.toBe('(nessun menu)');
  expect(letto, 'la cronologia è arrivata al riquadro col gesto fatto sulla pagina ospite').not.toContain(PASSWORD);
});

test('una scheda di sfondo senza gesti non svuota la cronologia e non ci aggiunge voci', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  await testServer.openReady(openTab, CAMPO);
  await testServer.openReady(openTab, CAMPO, { pubblico: true });
  const sfondo = dalSito(app, '127.0.0.1');
  expect(await sfondo({ type: 'push_clipboard_entry', entry: { type: 'text', text: 'voce del sito' } })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await sfondo({ type: 'remove_clipboard_entry', entry: { type: 'text', text: PASSWORD } })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await sfondo({ type: 'clear_clipboard_history' })).toMatchObject({ ok: false, code: 'forbidden' });
  const r = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
  expect(r.items.map((i) => i.text)).toEqual([PASSWORD]);
});

test('su un sito che annulla il tasto destro in cattura su window il menu Incolla mostra ancora la cronologia', async ({ shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const page = await testServer.openReady(openTab, CAMPO.replace('</body>', "<script>window.addEventListener('contextmenu', (e) => e.preventDefault(), true);</script></body>"), { pubblico: true });
  const sub = await cronologiaDelMenu(page);
  await expect(sub).toContainText(PASSWORD);
});

test('il tasto destro nel riquadro di un altro sito non apre la cronologia alla pagina che lo ospita', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`, { pubblico: true });
  await page.frameLocator('#embed').locator('#ta').click({ button: 'right' });
  await expect(page.frameLocator('#embed').locator('.sn-menu')).toBeVisible();
  const r = await dalSito(app, 'sito-pubblico.test')({ type: 'get_clipboard_history' });
  expect(JSON.stringify(r), 'la pagina ospite ha avuto la cronologia col menu aperto nel riquadro').not.toContain(PASSWORD);
});

test('passata sullo sfondo dopo un clic, la scheda non svuota la cronologia; la copia d\'immagine in arrivo si registra', async ({ app, shell, openTab, testServer }) => {
  await copiaPassword(shell);
  const page = await testServer.openReady(openTab, CAMPO, { pubblico: true });
  await page.locator('#ok').click();
  await testServer.openReady(openTab, CAMPO);
  const sfondo = dalSito(app, 'sito-pubblico.test');
  expect(await sfondo({ type: 'clear_clipboard_history' })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await sfondo({ type: 'push_clipboard_entry', entry: { type: 'text', text: 'voce del sito' } })).toMatchObject({ ok: false, code: 'forbidden' });
  expect(await sfondo({ type: 'push_clipboard_entry', entry: { type: 'image', dataUrl: 'data:image/png;base64,AA', description: 'foto' } })).toEqual({ ok: true });
  const r = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
  expect(r.items.map((i) => i.text || i.description)).toEqual(['foto', PASSWORD]);
});
