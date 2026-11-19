// Verifica #1905 giro 1: le altre strade con cui l'utente dà il percorso di un suo file.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa, togliCartella } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { let u = ''; let titolo = ''; try { u = t.view.webContents.getURL(); titolo = t.view.webContents.getTitle(); } catch (_) {} return { id: t.id, url: u || t.url || '', titolo }; });
});
const titoloFile = async (app) => ((await schede(app)).find((s) => s.url.startsWith('file:')) || {}).titolo || '';
const notifiche = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')].map((c) => c.textContent));

let base; let file;
test.beforeEach(() => {
  base = cartellaInCasa('filo-1905b-');
  const dir = join(base, 'Desktop', 'report');
  mkdirSync(dir, { recursive: true });
  file = join(dir, 'pagina prova.html');
  writeFileSync(file, '<!doctype html><title>Pagina 1905</title><h1>ok</h1>');
});
test.afterEach(() => { try { togliCartella(base); } catch (_) {} });

for (const [nome, scrivi] of [
  ['il percorso nudo', () => file],
  ['il percorso fra virgolette', () => `"${file}"`],
  ['l\'indirizzo file:///', () => pathToFileURL(file).href],
]) {
  test(`home: ${nome} incollato da solo e Invio apre il file`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
    await chiedi(page, scrivi());
    await page.waitForTimeout(3000);
    console.log(nome, 'schede', JSON.stringify(await schede(app)), 'notifiche', JSON.stringify(await notifiche(shell)), 'chiamate', (await chiamateAlModello(app)).length);
    await expect.poll(() => titoloFile(app), { timeout: 8000 }).toBe('Pagina 1905');
  });
}

test('riavvio: la scheda col file torna con la sessione', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(file).href }) }] }, { text: 'Aperto.' }]);
  await chiedi(page, `apri ${file}`);
  await expect.poll(() => titoloFile(app), { timeout: 8000 }).toBe('Pagina 1905');
  const s = (await schede(app)).find((x) => x.url.startsWith('file:'));
  // ricarica e indietro/avanti dentro la scheda
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => t.id === i).view.webContents.reload(), s.id);
  await expect.poll(() => titoloFile(app), { timeout: 8000 }).toBe('Pagina 1905');
  // chiusa e riaperta con la scorciatoia delle schede chiuse
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(i), s.id);
  await expect.poll(async () => (await schede(app)).some((x) => x.url.startsWith('file:')), { timeout: 5000 }).toBe(false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa?.());
  await expect.poll(() => titoloFile(app), { timeout: 8000 }).toBe('Pagina 1905');
});
