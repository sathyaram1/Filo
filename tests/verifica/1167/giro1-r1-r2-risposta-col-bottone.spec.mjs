// #1167, giro 1: la risposta scritta insieme a un'azione che mette solo un bottone deve arrivare nella bolla anche
// quando il bottone è un evento di calendario (r1) e quando il giro dopo il bottone fallisce (r2).
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA_VISITA = 'La visita è martedì 14 ottobre alle 10:30, dal dottor Rossi.';
const RISPOSTA_TARI = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';
const evento = { id: 'e1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ data: '2026-10-14', ora: '10:30', titolo: 'Visita dottor Rossi' }) };

test('r1 la risposta scritta col bottone del calendario resta nella bolla, non nel blocco delle attività', async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA_VISITA, toolCalls: [evento] },
      { text: 'Ti ho messo il bottone per aggiungerla al calendario.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quando ho la visita?');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla).toContainText('Ti ho messo il bottone', { timeout: 15_000 });
    await expect(bolla).toHaveCount(1);
    await expect(bolla).toContainText('martedì 14 ottobre alle 10:30');
  } finally {
    await ripristina(app);
  }
});

test('r2 il giro dopo il bottone del file fallisce: la risposta già scritta resta leggibile nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tasse');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'tari-2026.pdf');
  writeFileSync(file, '%PDF-1.4');
  try {
    await modelloFinto(app, [{ text: RISPOSTA_TARI, toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file }) }] }]);
    await app.evaluate(() => {
      const primo = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
        if (globalThis.__chatFinta_calls.length === 0) return primo(opts);
        globalThis.__chatFinta_calls.push([]);
        const e = new Error('Il fornitore non risponde.');
        e.status = 503;
        throw e;
      };
    });
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari?');
    await expect.poll(() => app.evaluate(() => globalThis.__chatFinta_calls.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(2500);
    const bolleConRisposta = page.locator('.dash-bubble-filo', { hasText: 'Hai pagato 305,40 €' });
    await expect(bolleConRisposta).toHaveCount(1, { timeout: 5_000 });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
