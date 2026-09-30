// Verifica #590, giro 19: esplorazione (bottoni «Apri comunque» con nomi lunghi e tema scuro,
// bottone dell'assistente reso trasparente dalla pagina, strade principali).

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (url, id = 'n1') => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina' }) });
const LUNGO = 'http://www.un-nome-di-sito.davvero-molto.lungo-per-provare.i-bottoni-della.chat-e-del.diario.blocked.test/p';

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

test('assistente: la riga del diario con un nome di sito comune', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const { tab, apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1><p>testo</p>'), 'sito.test');
  expect(await apri('http://www.blocked.test/')).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque' })).toBeVisible();
  const misura = () => tab.evaluate(() => {
    const l = [...document.querySelectorAll('.sn-sidebar-log')].pop();
    const c = document.querySelector('.sn-sidebar-conv');
    return { testo: l.textContent, lsw: l.scrollWidth, lcw: l.clientWidth, csw: c.scrollWidth, ccw: c.clientWidth, bs: getComputedStyle(l).boxSizing };
  });
  console.log('RIGA-UTENTE', JSON.stringify(await misura()));
  await tab.screenshot({ path: 'tests/.shots/590-g19-assistente-riga.png', clip: { x: 900, y: 0, width: 380, height: 200 } });
  await tab.evaluate(() => { const l = [...document.querySelectorAll('.sn-sidebar-log')].pop(); l.textContent = '· azione Filo: naviga: www.doubleclick.net è fra i siti di pubblicità e tracciamento'; });
  console.log('RIGA-LISTE', JSON.stringify(await misura()));
  await tab.screenshot({ path: 'tests/.shots/590-g19-assistente-riga-liste.png', clip: { x: 900, y: 0, width: 380, height: 200 } });
});

test('pagina «Sito bloccato» e notifica, tema scuro', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await tema(shell, 'dark');
  const pagina = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await lista(shell, ['blocked.test']);
  await expect.poll(async () => (await schede(app)).some((u) => /code=blocked/.test(u)), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  const w = app.windows().find((x) => /code=blocked/.test(x.url()));
  await w.screenshot({ path: 'tests/.shots/590-g19-pagina-bloccata-scuro.png' });
  const s = rete.pagina('sito.test', '/', `<h1>PAGINA</h1><a id="l" href="${pagina}">vai</a>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), s);
  await expect.poll(async () => (await schede(app)).includes(s), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(600);
  await app.windows().find((x) => x.url() === s).evaluate(() => document.getElementById('l').click());
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toBeVisible({ timeout: 6000 });
  await shell.screenshot({ path: 'tests/.shots/590-g19-notifica-scuro.png' });
});

test('Preferenze Sicurezza: lista con voci varie, scuro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await tema(shell, 'dark');
  await lista(shell, ['blocked.test', 'münchen.de', '.sito.it', 'www.facebook.com']);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await shell.waitForTimeout(1500);
  const w = app.windows().find((x) => x.url().startsWith('filo://security'));
  await w.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(800);
  const campo = w.locator('textarea').first();
  console.log('SICUREZZA-TEXTAREA', await campo.count() ? JSON.stringify(await campo.inputValue()) : 'nessuna textarea');
  await campo.evaluate((t) => t.scrollIntoView({ block: 'center' })).catch(() => {});
  await w.screenshot({ path: 'tests/.shots/590-g19-sicurezza-scuro.png' });
  if (await campo.count()) {
    await campo.fill('blocked.test\nfacebook\n<b>x</b>.com\n' + 'a'.repeat(300) + '.com');
    await campo.blur();
    await shell.waitForTimeout(1200);
    await w.screenshot({ path: 'tests/.shots/590-g19-sicurezza-voci-strane.png' });
  }
});
