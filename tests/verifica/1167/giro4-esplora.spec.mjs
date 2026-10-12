// #1167, giro 4: esplorazione (risposta ripetuta dal modello, markup nella risposta, tema scuro).
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';

async function bollettaTari(app) {
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tasse');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'tari-2026.pdf');
  writeFileSync(file, '%PDF-1.4');
  return { dir, file };
}
const apriFile = (file, id = 'f1') => ({ id, name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file }) });

test('ripete: il modello ripete la risposta nel giro dopo il bottone', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: `${RISPOSTA} Ti ho messo il bottone per aprirlo.` },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    const testo = await bolla.evaluate((el) => el.textContent);
    console.log('RIPETE bolla:', JSON.stringify(testo));
    expect(testo.split('305,40').length - 1).toBe(1);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markup: html nella risposta col bottone non diventa markup, tema scuro', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
    await modelloFinto(app, [
      { text: `${RISPOSTA} <img src=x onerror="window.__xss=1"> <b>grassetto</b>`, toolCalls: [apriFile(file)] },
      { text: 'Ti ho messo anche il bottone per aprirlo.', ritardoMs: 1500 },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('305,40', { timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/.shots/v1167-giro4-diretta-scuro.png' });
    await expect(bolla.locator('.dash-file-btn')).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/.shots/v1167-giro4-fine-scuro.png' });
    expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
    expect(await bolla.locator('img').count()).toBe(0);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/.shots/v1167-giro4-fine-chiaro.png' });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('due-bottoni: due giri di soli bottoni, poi un giro di lavoro con nota, poi la chiusura', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file)] },
      { text: 'La seconda rata scade il 2 dicembre.', toolCalls: [{ id: 'c1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ titolo: 'Rata TARI', inizio: '2026-12-02T09:00:00' }) }] },
      { text: 'Cerco anche il bollettino.', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: '' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15_000 }).toBe(4);
    await page.waitForTimeout(1500);
    const testo = await bolla.allTextContents();
    console.log('DUE-BOTTONI bolle:', JSON.stringify(testo));
    const tutto = testo.join('\n');
    expect(tutto).toContain('305,40');
    expect(tutto).toContain('2 dicembre');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
