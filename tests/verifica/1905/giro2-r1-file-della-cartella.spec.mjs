// Verifica #1905 giro 2, rilievo 1 (già giro 1): una pagina locale aperta dall'utente non deve poter leggere i file
// della sua cartella, né i pixel delle foto né il testo di un file caricato come script (il messaggio d'errore).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let titolo = ''; try { titolo = t.view.webContents.getTitle(); } catch (_) {} return { id: t.id, titolo }; });
});
const nellaScheda = (app, id, js) => app.evaluate(({ BrowserWindow }, [i, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === i).view.webContents.executeJavaScript(codice);
}, [id, js]);

let base;
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('r1 una pagina scaricata e aperta dall\'utente non legge i pixel di una foto accanto (nella cartella o in una sottocartella)', async ({ app }) => {
  test.setTimeout(60_000);
  base = cartellaInCasa('filo-1905-r1-');
  const dir = join(base, 'Scaricati');
  mkdirSync(join(dir, 'Foto'), { recursive: true });
  copyFileSync(resolve('assets/icons/icon-256.png'), join(dir, 'IMG_0001.png'));
  copyFileSync(resolve('assets/icons/icon-256.png'), join(dir, 'Foto', 'IMG_0002.png'));
  writeFileSync(join(dir, 'fattura.html'), `<!doctype html><title>Fattura</title>
    <script>
      window.__r = {};
      const leggi = (k, src) => { const i = new Image(); i.onload = () => {
        try { const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').drawImage(i, 0, 0); window.__r[k] = 'letto:' + c.toDataURL().length; }
        catch (e) { window.__r[k] = 'no:' + e.name; } }; i.onerror = () => { window.__r[k] = 'no:caricamento'; }; i.src = src; };
      leggi('accanto', 'IMG_0001.png');
      leggi('sotto', 'Foto/IMG_0002.png');
    </script>`);
  const file = join(dir, 'fattura.html');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  let s;
  await expect.poll(async () => { s = (await schede(app)).find((x) => x.titolo === 'Fattura'); return !!s; }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => nellaScheda(app, s.id, 'Object.keys(window.__r).length'), { timeout: 8000 }).toBe(2);
  const r = await nellaScheda(app, s.id, 'window.__r');
  expect(r.accanto, 'i pixel della foto accanto restano chiusi alla pagina').toMatch(/^no:/);
  expect(r.sotto, 'i pixel della foto nella sottocartella restano chiusi alla pagina').toMatch(/^no:/);
});
