// #1803.2 giro 2 — un programma già nella barra, rimesso a parole con l'OK: pulsante, riassunto, Filo e la chat
// riaperta non devono dirlo messo.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const salvate = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti || []);

test('programma già nella barra rimesso a parole con l\'OK: nessuno lo dice messo', async ({ app }) => {
  test.skip(process.platform === 'win32', 'programma di prova come script di shell');
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('barra-siti-gia');
  const gioco = path.join(dir, 'Gioco');
  fs.writeFileSync(gioco, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(gioco, 0o755);
  let page = await home(app);
  await app.evaluate(async (_e, p) => {
    await chrome.storage.local.set({ filo_barra_siti: [{ id: 'gc', tipo: 'app', percorso: p, nome: 'Gioco', icona: '' }] });
  }, gioco);
  await page.reload();
  page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'aggiungi', elemento: gioco, nome: 'Gioco' }) }] },
    { text: 'Ti chiedo conferma.' },
    { text: 'Risposta finale.' },
  ]);
  let chiamate = [];
  try {
    await page.locator('#input').fill('metti il mio gioco nella barra');
    await page.locator('#sendBtn').click();
    const btn = page.locator('button.dash-action-btn', { hasText: 'nella barra dei siti' });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta finale.' })).toHaveCount(1, { timeout: 15_000 });
    await expect(btn).not.toContainText('Messo nella barra');
    await expect(btn).toContainText('già nella barra');
    await expect(page.locator('#bubbles')).not.toContainText('Messo nella barra');
    await expect(page.locator('#bubbles')).not.toContainText('Ha sistemato la barra dei siti');
    try { fs.mkdirSync(path.join(process.cwd(), 'tests', '.shots'), { recursive: true }); await page.screenshot({ path: path.join(process.cwd(), 'tests', '.shots', 'verifica-1803-2-programma.png') }); } catch (_) {}
    chiamate = await chiamateAlModello(app);
  } finally { await ripristina(app); }
  expect((await salvate(app)).length).toBe(1);
  // Quello che Filo legge dopo l'OK, e la memoria del turno dopo: mai «Messo».
  const dopo = JSON.stringify(chiamate.at(-1));
  expect(dopo).not.toMatch(/Messo nella barra/);
  expect(dopo).toMatch(/già nella barra/i);

  const chat = (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
    .find((c) => !c.app && c.messages.some((m) => m.text === 'metti il mio gioco nella barra'));
  expect(chat).toBeTruthy();
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await expect(page.locator('#bubbles')).toContainText('Risposta finale.', { timeout: 10_000 });
  const testo = await page.locator('#bubbles').innerText();
  expect(testo).not.toContain('Messo nella barra');
  expect(testo).not.toContain('Ha sistemato la barra dei siti');
});
