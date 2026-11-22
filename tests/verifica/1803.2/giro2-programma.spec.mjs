// #1803.2 giro 2 — un programma rimesso a parole con l'OK: pulsante, riassunto, Filo e la chat riaperta dicono com'è
// andata davvero (già lì oppure messo).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const salvate = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti || []);

for (const gia of [false, true]) {
  test(`programma ${gia ? 'già nella barra' : 'nuovo'} messo a parole con l'OK: pulsante, Filo e chat riaperta dicono l'esito vero`, async ({ app }) => {
    test.skip(process.platform === 'win32', 'programma di prova come script di shell');
    test.setTimeout(120_000);
    const dir = cartellaTemporanea('barra-siti-gia');
    const gioco = path.join(dir, 'Gioco');
    fs.writeFileSync(gioco, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(gioco, 0o755);
    let page = await home(app);
    await app.evaluate(async (_e, [p, g]) => {
      await chrome.storage.local.set({ filo_barra_siti: g ? [{ id: 'gc', tipo: 'app', percorso: p, nome: 'Gioco', icona: '' }] : [] });
    }, [gioco, gia]);
    await page.reload();
    page = await home(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'p1', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'aggiungi', elemento: gioco, nome: 'Gioco' }) }] },
      { text: 'Ti chiedo conferma.' },
      { text: 'Risposta finale.' },
    ]);
    let chiamate = [];
    const atteso = gia ? 'È già nella barra' : 'Messo nella barra';
    const vietato = gia ? 'Messo nella barra' : 'È già nella barra';
    try {
      await page.locator('#input').fill('metti il mio gioco nella barra');
      await page.locator('#sendBtn').click();
      const btn = page.locator('button.dash-action-btn', { hasText: 'nella barra dei siti' });
      await expect(btn).toBeVisible({ timeout: 15_000 });
      await btn.click();
      await clickConfirm(page, 'ok');
      await expect(btn).toHaveText(/^[✓✗]/, { timeout: 15_000 });
      await expect(btn).toContainText(atteso);
      await expect(btn).not.toContainText(vietato);
      try { fs.mkdirSync(path.join(process.cwd(), 'tests', '.shots'), { recursive: true }); await page.screenshot({ path: path.join(process.cwd(), 'tests', '.shots', `verifica-1803-2-programma-${gia ? 'gia' : 'nuovo'}.png`) }); } catch (_) {}
      // Dopo l'OK Filo riprende da solo e risponde sull'esito.
      await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta finale.' })).toHaveCount(1, { timeout: 15_000 });
      if (gia) await expect(page.locator('#bubbles')).not.toContainText('Ha sistemato la barra dei siti');
      chiamate = await chiamateAlModello(app);
    } finally { await ripristina(app); }
    expect((await salvate(app)).length).toBe(1);
    const dopo = JSON.stringify(chiamate.at(-1));
    expect(dopo).not.toContain(vietato);
    expect(dopo).toContain(atteso);

    const chat = (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
      .find((c) => !c.app && c.messages.some((m) => m.text === 'metti il mio gioco nella barra'));
    expect(chat).toBeTruthy();
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    await expect(page.locator('#bubbles')).toContainText('Risposta finale.', { timeout: 10_000 });
    const testo = await page.locator('#bubbles').innerText();
    expect(testo).not.toContain(vietato);
    if (gia) expect(testo).not.toContain('Ha sistemato la barra dei siti');
  });
}
