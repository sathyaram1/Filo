// Verifica #1905 giro 1: da una pagina locale a un sito: ci si arriva con la propria sessione di sempre.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const schede = (app) => app.evaluate(({ BrowserWindow, session }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let u = ''; let s = ''; try { u = t.view.webContents.getURL(); s = t.view.webContents.session === session.fromPartition('file-del-computer') ? 'file' : 'altra'; } catch (_) {} return { id: t.id, url: u, sessione: s }; });
});
const nellaScheda = (app, id, js) => app.evaluate(({ BrowserWindow }, [i, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === i).view.webContents.executeJavaScript(codice, true);
}, [id, js]);

let base;
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('un collegamento al web dentro una pagina locale porta al sito con i cookie di sempre', async ({ app, testServer, openTab }) => {
  test.setTimeout(60_000);
  const sito = testServer.html('<title>Sito</title><script>document.title = "Sito " + (document.cookie || "senza-cookie")</script>');
  const prima = await openTab(testServer.html('<title>Accesso</title><script>document.cookie = "accesso=fatto; path=/"</script>'));
  await prima.waitForFunction(() => document.cookie.includes('accesso'));
  base = cartellaInCasa('filo-1905e-');
  mkdirSync(join(base, 'Desktop'), { recursive: true });
  const file = join(base, 'Desktop', 'link.html');
  writeFileSync(file, `<!doctype html><title>Link</title><a id="a" href="${sito}" style="display:block;width:400px;height:100px">vai</a>`);
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  let s;
  await expect.poll(async () => { s = (await schede(app)).find((x) => x.url.endsWith('link.html')); return !!s; }, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }, i) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => t.id === i).view.webContents;
    wc.sendInputEvent({ type: 'mouseDown', x: 50, y: 30, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 50, y: 30, button: 'left', clickCount: 1 });
  }, s.id);
  await page.waitForTimeout(2500);
  const tutte = await schede(app);
  const titoli = await Promise.all(tutte.map((x) => nellaScheda(app, x.id, 'document.title').catch(() => '?')));
  console.log('dopo clic', JSON.stringify(tutte.map((x, i) => ({ ...x, titolo: titoli[i] }))));
  const arrivo = tutte.findIndex((x) => x.url === sito);
  expect(arrivo).toBeGreaterThanOrEqual(0);
  expect(titoli[arrivo]).toBe('Sito accesso=fatto');
});
