// Esplorazione del giro 4 di #1905: il percorso incollato da solo nel campo della home, e con la barra davanti.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

for (const forma of ['solo', 'barra', 'url']) {
  test(`campo della home: percorso ${forma}`, async ({ app, avvisi, shell }) => {
    test.setTimeout(60_000);
    const dir = join(cartellaTemporanea('g4h-'), 'report');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'r.html');
    writeFileSync(f, '<!doctype html><title>Report campo</title><h1>ciao</h1>');
    const page = await home(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: pathToFileURL(f).href }) }] },
      { text: 'Ecco il report.' },
    ]);
    const testo = forma === 'solo' ? f : forma === 'barra' ? `/${f}` : `/${pathToFileURL(f).href}`;
    await chiedi(page, testo);
    await page.waitForTimeout(4000);
    const schede = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
      .map((t) => { try { return t.view.webContents.getURL() + ' | ' + t.view.webContents.getTitle(); } catch (_) { return t.url; } }));
    const chiamate = await app.evaluate(() => (globalThis.__chatFinta_calls || []).length);
    let testiAvvisi = [];
    try { testiAvvisi = await (await avvisi()).locator('.shell-notif').allInnerTexts(); } catch (_) {}
    console.log('CAMPO', forma, JSON.stringify({ schede, chiamate, testiAvvisi }));
    mkdirSync(SHOTS, { recursive: true });
    await shell.screenshot({ path: join(SHOTS, `g4-campo-${forma}.png`) });
    await ripristina(app);
  });
}
