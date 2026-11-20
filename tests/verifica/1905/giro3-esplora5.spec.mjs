// Esplorazione 5 del giro 3 di #1905: il percorso incollato nella chat della home, col modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmText } from '../../helpers/confirm.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => ({ url: t.view.webContents.getURL(), title: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }));
});
const naviga = (url) => ({ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url }) });

test.afterEach(async ({ app }) => { await ripristina(app); });

test('percorso incollato in chat: si apre la pagina resa', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1905 Desktop');
  mkdirSync(join(dir, 'report'));
  const html = join(dir, 'report', '2026-10-30-riquadro-conferma-schema.html');
  writeFileSync(html, '<title>Riquadro conferma</title><h1 style="color:#b5651d">Schema del riquadro</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [naviga(pathToFileURL(html).href)] }, { text: 'Aperto.' }]);
  await chiedi(page, `aprimi questo ${html}`);
  await expect.poll(async () => (await schede(app)).find((s) => s.attiva)?.title, { timeout: 15_000 }).toBe('Riquadro conferma');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await page.waitForTimeout(1500);
  // torna alla home per guardare la chat
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs[0].id);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/1905-g3-chat-dopo.png' });
  console.log('CHAT', await page.locator('.dash-chat, #chat, body').first().innerText().then((t) => t.slice(-800)));
});

test('percorso non scritto dall\'utente: riquadro di conferma', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1905 Desktop');
  const html = join(dir, 'riquadro.html');
  writeFileSync(html, '<title>Riquadro</title><h1>x</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [naviga(pathToFileURL(html).href)] }, { text: 'Aperto.' }]);
  await chiedi(page, 'aprimi il report del riquadro che ho sulla scrivania');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  console.log('CONFERMA', await confirmText(page));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/1905-g3-conferma.png' });
});

test('file che non c\'è e cartella: cosa legge l\'utente', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaInCasa('filo-1905 Desktop');
  const assente = join(dir, 'sparito.html');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [naviga(assente)] }, { text: 'Non lo trovo.' }]);
  await chiedi(page, `apri ${assente}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/.shots/1905-g3-assente.png' });
});
