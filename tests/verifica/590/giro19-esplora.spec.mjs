// Verifica #590, giro 19: esplorazione (bottoni «Apri comunque» con nomi lunghi e tema scuro,
// bottone dell'assistente reso trasparente dalla pagina, strade principali).

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (url, id = 'n1') => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina' }) });
const LUNGO = `http://${'sottodominio-lunghissimo-'.repeat(4)}x.blocked.test/percorso`;

async function tema(shell, t) {
  await shell.evaluate((x) => window.filoShell.message({ type: 'update_settings', settings: { theme: x } }), t);
  await shell.waitForTimeout(500);
}

test('chat della home: nome lunghissimo sul bottone, tema scuro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(LUNGO)] }, { text: 'È fra i siti bloccati.' }]);
  try {
    await chiedi(page, 'apri');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'fra i siti bloccati' })).toBeVisible({ timeout: 20_000 });
    const b = page.getByRole('button', { name: /^Apri comunque/ });
    await expect(b).toBeVisible();
    const m = await b.evaluate((x) => {
      const r = x.getBoundingClientRect();
      const bolla = x.closest('.dash-bubble, .dash-bubble-filo, .dash-bubble-actions') || x.parentElement;
      const rb = bolla.getBoundingClientRect();
      return { w: r.width, right: r.right, bollaRight: rb.right, vw: window.innerWidth, sw: document.documentElement.scrollWidth, testo: x.textContent };
    });
    console.log('HOME-LUNGO', JSON.stringify(m));
    await page.screenshot({ path: 'tests/.shots/590-g19-home-lungo-chiaro.png' });
    await tema(shell, 'dark');
    await page.screenshot({ path: 'tests/.shots/590-g19-home-lungo-scuro.png' });
  } finally {
    await ripristina(app);
  }
});

async function assistenteSu(app, shell, pagina, host) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  const esegui = (code) => app.evaluate(async ({ BrowserWindow }, [c, h]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).includes(h));
    return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]);
  }, [code, host]);
  await esegui('window.SN_SIDEBAR.open(), 1');
  const tab = app.windows().find((w) => w.url().includes(host));
  const apri = (url) => esegui(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: ${JSON.stringify(url)} })`);
  return { tab, apri, esegui };
}

test('assistente: nome lunghissimo sul bottone, chiaro e scuro', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const { tab, apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1><p>testo</p>'), 'sito.test');
  expect(await apri(LUNGO)).toBe(false);
  const b = tab.locator('.sn-sidebar button', { hasText: 'Apri comunque' });
  await expect(b).toBeVisible();
  const m = await b.evaluate((x) => {
    const r = x.getBoundingClientRect();
    const s = document.querySelector('.sn-sidebar').getBoundingClientRect();
    return { left: r.left, right: r.right, sLeft: s.left, sRight: s.right, sw: x.scrollWidth, cw: x.clientWidth };
  });
  console.log('ASSISTENTE-LUNGO', JSON.stringify(m));
  await tab.screenshot({ path: 'tests/.shots/590-g19-assistente-lungo-chiaro.png' });
  await tema(shell, 'dark');
  await tab.screenshot({ path: 'tests/.shots/590-g19-assistente-lungo-scuro.png' });
});

test('assistente: la pagina rende il bottone trasparente e grande quanto lo schermo, poi l\'utente clicca sulla pagina', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1><p>leggi</p>'), 'sito.test');
  expect(await apri(bersaglio)).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque' })).toBeVisible();
  // Script della pagina (mondo principale): tocca solo il DOM condiviso.
  await tab.evaluate(() => {
    const b = [...document.querySelectorAll('.sn-sidebar button')].find((x) => /Apri comunque/.test(x.textContent));
    b.style.cssText = 'position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;opacity:0.01!important;z-index:2147483647!important;margin:0!important;max-width:none!important';
  });
  await tab.mouse.click(200, 300);
  await tab.waitForTimeout(2000);
  console.log('CLICKJACK schede', JSON.stringify(await schede(app)));
});

test('strade: barra della shell su una scheda aperta e home con grafie strane', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  rete.pagina('www.blocked.test', '/p', '<h1>SITO</h1>');
  const pagina = rete.pagina('sito.test', '/', '<h1>PAGINA</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);
  for (const u of ['BLOCKED.TEST', 'blocked.test.', 'http://WWW.Blocked.Test./p', 'http://user@blocked.test/', 'http://blocked%2Etest/']) {
    await shell.evaluate(([i, x]) => window.filoShell.tabs.navigate(i, x), [id, u]);
    await shell.waitForTimeout(1200);
    console.log('NAVIGATE', u, JSON.stringify(await schede(app)));
  }
});
