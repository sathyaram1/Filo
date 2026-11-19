// Verifica #1905 giro 1: una pagina locale aperta dall'utente prova a leggere gli altri file della sua cartella.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let u = ''; let titolo = ''; try { u = t.view.webContents.getURL(); titolo = t.view.webContents.getTitle(); } catch (_) {} return { id: t.id, url: u || t.url || '', titolo }; });
});
const nellaScheda = (app, id, js) => app.evaluate(({ BrowserWindow }, [i, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === i).view.webContents.executeJavaScript(codice);
}, [id, js]);

let base; let dir;
test.beforeEach(() => {
  base = cartellaInCasa('filo-1905c-');
  dir = join(base, 'Scaricati');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'estratto conto.txt'), 'IBAN-SEGRETO-1905');
  copyFileSync(resolve('assets/icons/icon-256.png'), join(dir, 'documento.png'));
  writeFileSync(join(dir, 'regalo.html'), `<!doctype html><title>Regalo</title><img id="i" src="documento.png">
    <script>
      window.__r = {};
      window.addEventListener('load', () => {
        try { const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').drawImage(document.getElementById('i'), 0, 0); window.__r.canvas = 'letto:' + c.toDataURL().length; } catch (e) { window.__r.canvas = 'no:' + e.name; }
        try {
          const w = window.open('estratto conto.txt');
          setTimeout(() => { try { window.__r.finestra = 'letto:' + w.document.body.innerText; } catch (e) { window.__r.finestra = 'no:' + e.name; } }, 1500);
        } catch (e) { window.__r.finestra = 'no:' + e.name; }
        try {
          const d = window.open('./');
          setTimeout(() => { try { window.__r.cartella = 'letto:' + d.document.body.innerText.slice(0, 200); } catch (e) { window.__r.cartella = 'no:' + e.name; } }, 1500);
        } catch (e) { window.__r.cartella = 'no:' + e.name; }
      });
    </script>`);
});
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('una pagina scaricata e aperta dall\'utente non legge gli altri file della cartella', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const file = join(dir, 'regalo.html');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  let s;
  await expect.poll(async () => { s = (await schede(app)).find((x) => x.titolo === 'Regalo'); return !!s; }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => nellaScheda(app, s.id, 'Object.keys(window.__r).length'), { timeout: 8000 }).toBe(3);
  const r = await nellaScheda(app, s.id, 'window.__r');
  console.log('letture', JSON.stringify(r), 'schede', JSON.stringify(await schede(app)));
  expect(String(r.finestra)).not.toContain('IBAN-SEGRETO');
  expect(String(r.cartella)).not.toContain('estratto');
  expect(String(r.canvas)).not.toMatch(/^letto/);
});
