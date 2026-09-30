// Su un sito il popup di conferma di Filo non sta nel documento della pagina (#592.6): lì il codice del sito
// poteva renderlo invisibile e disegnare al suo posto un popup finto con un altro testo, e il clic su OK del
// finto confermava quello vero. Qui il sito prova a farlo, e l'utente legge e conferma la domanda vera.

import { test, expect } from './fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo, confirmState, clickConfirm, pointWhenConfirmAppears, CONFIRM_HOST } from './helpers/confirm.mjs';

test.setTimeout(60_000);

// La pagina ostile del rilievo: appena compare qualcosa di Filo in cima al documento lo rende trasparente
// e disegna un popup innocuo al suo posto.
const OSTILE = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
<h1>Pagina qualunque</h1>
<textarea id="ta" rows="4" cols="50"></textarea>
<script>
  window.__visto = false;
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('body > *')) {
      if (el.id === 'finto' || el.style.zIndex !== '2147483647') continue;
      window.__visto = true;
      el.style.opacity = '0';
      if (document.getElementById('finto')) continue;
      const f = document.createElement('div');
      f.id = 'finto';
      f.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2147483646';
      f.innerHTML = '<div style="background:#fff;padding:20px;border:1px solid #ccc">Filo chiede conferma. Filo vuole impostare: Tema \\u2192 Scuro.</div>';
      document.body.appendChild(f);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true });
</script>
</body></html>`;

const FEEDBACK = { type: 'INVIA_FEEDBACK', testo: 'Testo esatto che parte agli sviluppatori', titolo: 'Prova' };

async function stubFeedback(app) {
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    if (!globalThis.__origFbSubmit) globalThis.__origFbSubmit = FB.submit;
    globalThis.__fbCalls = [];
    FB.submit = async (payload) => { globalThis.__fbCalls.push(payload); return { id: 'test-fb' }; };
  });
}

// La strada del rilievo: l'Aiuto, convinto dalla pagina, chiede un'azione di livello 2.
function chiediDallAiuto(app, host, azione) {
  return nelMondoDiFilo(app, host, `
    window.__esitoAiuto = 'in corso';
    window.__filoSidebarTest.runFiloAction(${JSON.stringify(azione)}).then((v) => { window.__esitoAiuto = v; });
    true;`);
}
const esitoAiuto = (app, host) => nelMondoDiFilo(app, host, 'window.__esitoAiuto');

// La vista del popup: ultima fra le viste della finestra, visibile, grande quanto la scheda davanti.
function geometria(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const figli = w.contentView.children;
    const ultima = figli[figli.length - 1];
    const scheda = tm.tabs.find((t) => t.id === tm.activeId);
    const vista = tm.conferme.vista;
    return {
      inCima: !!vista && ultima === vista,
      visibile: !!vista && (typeof vista.getVisible === 'function' ? vista.getVisible() : true),
      vista: vista ? vista.getBounds() : null,
      scheda: scheda.view.getBounds(),
      url: vista ? vista.webContents.getURL() : '',
    };
  });
}

test('sito ostile: il popup vero sta sopra la scheda, il sito non lo vede, e OK fa quello che il popup dice', async ({ app, openTab, testServer }) => {
  await stubFeedback(app);
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  // Annulla: niente parte.
  await chiediDallAiuto(app, host, FEEDBACK);
  let sopra = await confermaSopraPagina(app);
  const stato = await confirmState(sopra);
  expect(stato.title).toBe('Filo chiede conferma');
  expect(stato.text).toContain('Testo esatto che parte agli sviluppatori');
  expect(stato.text).not.toContain('Tema');
  // Nel documento del sito non c'è niente da nascondere, e il finto non è mai nato.
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await page.evaluate(() => ({ visto: window.__visto, finto: !!document.getElementById('finto') }))).toEqual({ visto: false, finto: false });
  const g = await geometria(app);
  expect(g.url).toBe('filo://shell/conferma.html');
  expect(g.inCima, 'la vista del popup sta sopra tutte le altre').toBe(true);
  expect(g.visibile).toBe(true);
  expect(g.vista).toEqual(g.scheda);
  await sopra.screenshot({ path: 'tests/.shots/conferme-sopra-pagina.png' });

  await clickConfirm(sopra, 'cancel');
  await expect.poll(() => esitoAiuto(app, host)).toBe(false);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);
  await expect.poll(async () => (await geometria(app)).visibile).toBe(false);

  // OK: il feedback parte, con il testo che si leggeva.
  await chiediDallAiuto(app, host, FEEDBACK);
  sopra = await confermaSopraPagina(app);
  await clickConfirm(sopra, 'ok');
  await expect.poll(() => esitoAiuto(app, host)).toBe(true);
  await expect.poll(() => app.evaluate(() => globalThis.__fbCalls.length)).toBe(1);
  expect((await app.evaluate(() => globalThis.__fbCalls[0])).text).toContain('Testo esatto che parte agli sviluppatori');
  expect(await page.evaluate(() => window.__visto)).toBe(false);
});

test('un clic vero su OK appena il popup compare non vale; dopo mezzo secondo sì', async ({ app, openTab, testServer }) => {
  await stubFeedback(app);
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  await chiediDallAiuto(app, host, FEEDBACK);
  const sopra = await confermaSopraPagina(app);
  const p = await pointWhenConfirmAppears(sopra, 'ok');
  await sopra.mouse.click(p.x, p.y);
  await new Promise((r) => setTimeout(r, 300));
  expect(await esitoAiuto(app, host)).toBe('in corso');
  expect(await confirmState(sopra)).not.toBeNull();

  await new Promise((r) => setTimeout(r, 500));
  await sopra.mouse.click(p.x, p.y);
  await expect.poll(() => esitoAiuto(app, host)).toBe(true);
  await expect.poll(() => app.evaluate(() => globalThis.__fbCalls.length)).toBe(1);
});

test('chi stava scrivendo nella pagina continua a scrivere nel suo campo; Esc annulla e il fuoco torna lì', async ({ app, openTab, testServer }) => {
  await stubFeedback(app);
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  await page.locator('#ta').click();
  await page.keyboard.type('ciao');
  await chiediDallAiuto(app, host, FEEDBACK);
  const sopra = await confermaSopraPagina(app);
  await sopra.keyboard.type(' mondo');
  await expect(page.locator('#ta')).toHaveValue('ciao mondo');
  await sopra.keyboard.press('Backspace');
  await expect(page.locator('#ta')).toHaveValue('ciao mond');

  await sopra.keyboard.press('Escape');
  await expect.poll(() => esitoAiuto(app, host)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ta');
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);
});

test('la domanda sta sopra la sua scheda: dietro aspetta, davanti torna; una pagina nuova la chiude come Annulla', async ({ app, shell, openTab, testServer }) => {
  await stubFeedback(app);
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const idScheda = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);

  await chiediDallAiuto(app, host, FEEDBACK);
  await confermaSopraPagina(app);

  await openTab('filo://history/history.html');
  await expect.poll(async () => (await geometria(app)).visibile).toBe(false);
  expect(await esitoAiuto(app, host)).toBe('in corso');

  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idScheda);
  const sopra = await confermaSopraPagina(app);
  expect((await confirmState(sopra)).text).toContain('Testo esatto che parte agli sviluppatori');
  const g = await geometria(app);
  expect(g.inCima).toBe(true);
  expect(g.vista).toEqual(g.scheda);

  await page.evaluate(() => { location.reload(); });
  await expect.poll(async () => (await geometria(app)).visibile).toBe(false);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);
});
