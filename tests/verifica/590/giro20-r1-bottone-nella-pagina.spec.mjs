// Giro 20 di verifica (#590), rilievo 1: l'«Apri comunque» dell'assistente sta nel DOM della pagina, e la
// pagina ne decide posizione, aspetto, etichetta e fuoco. Un gesto normale dell'utente non deve aprire il sito.

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';

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
  return { tab, naviga };
}

// L'assistente ha provato ad aprire il sito della lista ed è stato fermato: sotto c'è il suo «Apri comunque».
async function dopoApertureFermata(app, shell, rete, corpo = '<h1>PAGINA</h1><p style="height:3000px">testo lungo</p>') {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const { tab, naviga } = await assistenteSu(app, shell, rete.pagina('sito.test', '/', corpo), 'sito.test');
  expect(await naviga(bersaglio)).toBe(false);
  await expect(tab.locator('.sn-sidebar button', { hasText: 'Apri comunque blocked.test' })).toBeVisible();
  return tab;
}

// Codice della pagina (mondo principale), non dell'utente.
const bottoneDellaPagina = () => [...document.querySelectorAll('.sn-sidebar button')].find((x) => /Apri comunque/.test(x.textContent));

test('la pagina stende il bottone, trasparente, su tutto lo schermo: un clic sul testo della pagina non apre il sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const tab = await dopoApertureFermata(app, shell, rete);
  await tab.evaluate((trova) => {
    const b = new Function(`return (${trova})()`)();
    document.body.append(b);
    b.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0;z-index:2147483647;margin:0;padding:0;border:0';
  }, bottoneDellaPagina.toString());
  await tab.mouse.click(200, 300);
  await tab.waitForTimeout(1500);
  expect(await suBloccato(app)).toEqual([]);
});

test('la pagina cambia l\'etichetta del bottone in «Chiudi questo avviso»: cliccarlo non apre il sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const tab = await dopoApertureFermata(app, shell, rete, '<h1>PAGINA</h1>');
  await tab.evaluate((trova) => { new Function(`return (${trova})()`)().textContent = 'Chiudi questo avviso'; }, bottoneDellaPagina.toString());
  await tab.locator('.sn-sidebar button', { hasText: 'Chiudi questo avviso' }).click();
  await tab.waitForTimeout(1500);
  expect(await suBloccato(app)).toEqual([]);
});

test('la pagina dà il fuoco al bottone reso invisibile: lo spazio per scorrere la pagina non apre il sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const tab = await dopoApertureFermata(app, shell, rete);
  await tab.evaluate((trova) => {
    const b = new Function(`return (${trova})()`)();
    b.style.opacity = '0';
    b.focus();
  }, bottoneDellaPagina.toString());
  await tab.keyboard.press('Space');
  await tab.waitForTimeout(1500);
  expect(await suBloccato(app)).toEqual([]);
});
