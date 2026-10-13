import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

// #481: più codici interni portano lo stesso nome («Aiuto» ne ha tre). Il menu
// "filtra per tipo" deve avere una voce per NOME, e quella voce deve tenere
// tutte le righe che mostrano il nome, anche mentre se ne tolgono alcune.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

const CODES = [
  'help', 'help_intent_guess', 'help_intent_judge',
  'spellcheck_semantic', 'spellcheck_word',
  'filo_lesson', 'filo_compact',
  'edit_text',
];

test('Cronologia AI: il filtro per tipo raggruppa per nome e tiene tutte le righe con quel nome', async () => {
  const now = Date.now();
  const aiHistory = CODES.map((action, i) => ({
    id: `h-${i}`,
    timestamp: new Date(now - i * 1000).toISOString(),
    action,
    provider: 'openrouter',
    model: 'deepseek-v4',
    input: { selection: `richiesta ${action}` },
    output: `risposta ${i}`,
    origin: 'https://example.com',
    costEur: 0.0001,
  }));

  const userData = cartellaTemporanea('filo-hist-etichetta-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await findTabPage(app, 'history');
    expect(page, 'la pagina cronologia deve aprirsi').toBeTruthy();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sn-history-item')).toHaveCount(CODES.length);

    // Ogni nome compare una volta sola nel menu.
    const testi = await page.locator('#filter option').allTextContents();
    expect(testi.slice(1).sort()).toEqual(['Aiuto', 'Correttore ortografico', 'Memoria di Filo', 'Modifica testo'].sort());

    const scegli = async (label, attese) => {
      await page.selectOption('#filter', { label });
      await expect(page.locator('.sn-history-item')).toHaveCount(attese);
      const meta = await page.locator('.sn-history-meta > span:first-child').allTextContents();
      for (const m of meta) expect(m.startsWith(`${label} •`), `riga fuori dal filtro: ${m}`).toBe(true);
    };
    await scegli('Aiuto', 3);
    await scegli('Correttore ortografico', 2);
    await scegli('Memoria di Filo', 2);
    await scegli('Modifica testo', 1);

    // Filtro e ricerca insieme: la ricerca restringe dentro il gruppo.
    await page.selectOption('#filter', { label: 'Aiuto' });
    await page.fill('#search', 'help_intent_judge');
    await expect(page.locator('.sn-history-item')).toHaveCount(1);
    await page.fill('#search', '');
    await expect(page.locator('.sn-history-item')).toHaveCount(3);

    // Togliendo una riga del gruppo il filtro resta su «Aiuto» con le altre due.
    const prima = page.locator('.sn-history-item').first();
    await prima.hover();
    await prima.locator('.sn-history-remove').click();
    await expect(page.locator('.sn-history-item')).toHaveCount(2);
    await expect(page.locator('#filter')).toHaveValue('Aiuto');
    expect(await page.locator('#filter option', { hasText: 'Aiuto' }).count()).toBe(1);

    // Tolta l'ultima riga del gruppo, il nome sparisce dal menu e la lista torna intera.
    for (let n = 2; n > 0; n--) {
      const voce = page.locator('.sn-history-item').first();
      await voce.hover();
      await voce.locator('.sn-history-remove').click();
      if (n > 1) await expect(page.locator('.sn-history-item')).toHaveCount(n - 1);
    }
    await expect(page.locator('#filter')).toHaveValue('');
    await expect(page.locator('.sn-history-item')).toHaveCount(CODES.length - 3);
    expect(await page.locator('#filter option').allTextContents()).not.toContain('Aiuto');
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
