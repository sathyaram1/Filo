// Esplorazione del giro 20 di verifica (#590): l'«Apri comunque» dell'assistente sta nel DOM della pagina.

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const suBloccato = async (app) => (await schede(app)).filter((u) => u.includes('blocked.test'));

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
  const naviga = (url) => esegui(`window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: ${JSON.stringify(url)} })`);
  return { tab, naviga, esegui };
}

test('la pagina allarga il bottone dell\'assistente a tutto schermo, trasparente: il primo clic dell\'utente sulla pagina apre il sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, naviga: apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1><p style="height:2000px">testo</p>'), 'sito.test');
  expect(await apri(bersaglio)).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque blocked.test' })).toBeVisible();
  // Script della pagina (mondo principale): sposta il bottone e lo rende invisibile sopra tutto.
  await tab.evaluate(() => {
    const b = [...document.querySelectorAll('.sn-sidebar button')].find((x) => /Apri comunque/.test(x.textContent));
    document.body.append(b);
    b.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0;z-index:2147483647;margin:0;padding:0;border:0';
  });
  await tab.mouse.click(200, 300);
  await tab.waitForTimeout(1500);
  expect(await suBloccato(app)).toEqual([]);
});

test('la pagina riscrive l\'etichetta del bottone dell\'assistente: «Chiudi» apre il sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, naviga: apri } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', '<h1>PAGINA</h1>'), 'sito.test');
  expect(await apri(bersaglio)).toBe(false);
  await tab.evaluate(() => {
    const b = [...document.querySelectorAll('.sn-sidebar button')].find((x) => /Apri comunque/.test(x.textContent));
    b.textContent = 'Chiudi questo avviso';
  });
  await tab.locator('.sn-sidebar button', { hasText: 'Chiudi questo avviso' }).click();
  await tab.waitForTimeout(1500);
  expect(await suBloccato(app)).toEqual([]);
});

test('NAVIGA in secondo piano verso un sito della lista: la chat e il modello lo sanno', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: bersaglio, etichetta: 'brano', background: true }) }] },
    { text: 'RISPOSTA' },
  ]);
  try {
    await chiedi(page, 'metti su quel brano');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    const giro = JSON.stringify(((await chiamateAlModello(app))[1] || []).filter((m) => m && m.role !== 'system'));
    expect(giro).toContain('NON aperta');
    await expect(page.getByRole('button', { name: /^Apri comunque/ })).toBeVisible();
    await page.screenshot({ path: 'tests/.shots/590-g20-secondo-piano.png' });
  } finally {
    await ripristina(app);
  }
});
