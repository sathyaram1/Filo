// Verifica #1905 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let titolo = ''; let url = ''; try { titolo = t.view.webContents.getTitle(); url = t.view.webContents.getURL(); } catch (_) {} return { id: t.id, titolo, url }; });
});
const nellaScheda = (app, id, js) => app.evaluate(({ BrowserWindow }, [i, codice]) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === i).view.webContents.executeJavaScript(codice);
}, [id, js]);

let base;
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

test('esplora: errori di script e moduli json della cartella', async ({ app }) => {
  test.setTimeout(60_000);
  base = cartellaInCasa('filo-1905-g2-');
  const dir = join(base, 'Scaricati');
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  writeFileSync(join(dir, 'progetto', '.env'), 'TOKEN=sk_live_SEGRETO42\n');
  writeFileSync(join(dir, 'progetto', 'dati.json'), '{"iban":"IT60X0542811101000000123456"}');
  writeFileSync(join(dir, 'fattura.html'), `<!doctype html><title>Fattura</title>
    <script>
      window.__r = {};
      window.addEventListener('error', (e) => { if (e.filename && e.filename.endsWith('.env')) window.__r.env = String(e.message); }, true);
    </script>
    <script src="progetto/.env"></script>
    <script type="module">
      import('./progetto/dati.json', { with: { type: 'json' } }).then((m) => { window.__r.json = JSON.stringify(m.default); }, (e) => { window.__r.json = 'no:' + e.name; });
    </script>`);
  const file = join(dir, 'fattura.html');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  let s;
  await expect.poll(async () => { s = (await schede(app)).find((x) => x.titolo === 'Fattura'); return !!s; }, { timeout: 10_000 }).toBe(true);
  await new Promise((ok) => setTimeout(ok, 2500));
  const r = await nellaScheda(app, s.id, 'window.__r');
  console.log('ESPLORA', JSON.stringify(r));
  await ripristina(app);
});

test('esplora: conferma per un percorso non scritto, dalla chat', async ({ app }) => {
  test.setTimeout(60_000);
  base = cartellaInCasa('filo-1905-g2b-');
  const dir = join(base, 'Desktop', 'report');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'riquadro.html');
  writeFileSync(file, '<!doctype html><title>Riquadro</title><h1>ciao</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, 'apri il report riquadro che sta sul desktop');
  await new Promise((ok) => setTimeout(ok, 3000));
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(5, 790);
  await new Promise((ok) => setTimeout(ok, 800));
  await page.screenshot({ path: join(SHOTS, 'g2-conferma-file.png') });
  console.log('ESPLORA', JSON.stringify(await schede(app)));
  console.log('ESPLORA-TESTO', JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 3000))));
  const conferma = page.getByRole('button', { name: /^(Apri|Conferma|Sì|Esegui)/ }).first();
  console.log('ESPLORA-BOTTONI', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).slice(0, 40))));
  if (await conferma.count()) {
    await conferma.click();
    await new Promise((ok) => setTimeout(ok, 2500));
    console.log('ESPLORA-DOPO', JSON.stringify(await schede(app)));
    await page.screenshot({ path: join(SHOTS, 'g2-conferma-dopo.png') });
  }
  await ripristina(app);
});
