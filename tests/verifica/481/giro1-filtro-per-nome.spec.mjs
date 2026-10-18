import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

// Verifica #481 giro 1: i passi dell'utente sul menu «filtra per tipo» della Cronologia AI,
// con dati misti (codici omonimi, codice sconosciuto, voce senza azione) e tema scuro.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function trovaScheda(app, hostname, timeout = 15000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const w = app.windows().find((p) => { try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; } });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('Cronologia AI: ogni nome una volta, e la voce tiene tutte le righe con quel nome', async () => {
  const now = Date.now();
  const codici = [
    'help_intent_judge', 'spellcheck_word', 'help', 'filo_compact', 'help_intent_guess',
    'spellcheck_semantic', 'filo_lesson', 'help', 'codice_sconosciuto_xyz', null,
  ];
  const aiHistory = codici.map((action, i) => ({
    id: `v-${i}`,
    timestamp: new Date(now - i * 60000).toISOString(),
    ...(action ? { action } : {}),
    model: 'm',
    input: { selection: `richiesta ${i} <b>html</b> 🎉` },
    output: `risposta ${i}`,
    costEur: 0.0002,
  }));
  const userData = cartellaTemporanea('filo-ver481-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await trovaScheda(app, 'history');
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sn-history-item')).toHaveCount(codici.length);

    const opzioni = (await page.locator('#filter option').allTextContents()).slice(1);
    expect(new Set(opzioni).size, `voci doppie nel menu: ${opzioni.join(' | ')}`).toBe(opzioni.length);
    for (const n of ['Aiuto', 'Correttore ortografico', 'Memoria di Filo']) expect(opzioni).toContain(n);

    // Per ogni voce del menu: tutte le righe che mostrano quel nome, e solo quelle.
    const tutteMeta = await page.locator('.sn-history-meta > span:first-child').allTextContents();
    const nomeDi = (m) => m.split(' • ')[0];
    for (const nome of opzioni) {
      await page.selectOption('#filter', { label: nome });
      const attese = tutteMeta.filter((m) => nomeDi(m) === nome).length;
      await expect(page.locator('.sn-history-item')).toHaveCount(attese);
      const meta = await page.locator('.sn-history-meta > span:first-child').allTextContents();
      for (const m of meta) expect(nomeDi(m)).toBe(nome);
    }
    await page.selectOption('#filter', { label: 'Aiuto' });
    await expect(page.locator('.sn-history-item')).toHaveCount(4);

    // Tornare a «Tutte» rimette ogni riga, compresa quella senza tipo.
    await page.selectOption('#filter', '');
    await expect(page.locator('.sn-history-item')).toHaveCount(codici.length);

    mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
    await page.selectOption('#filter', { label: 'Aiuto' });
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'ver481-scuro.png') });

    // «Cancella tutto»: il menu si svuota dei nomi.
    await page.click('#clear');
    await clickConfirm(page, 'ok', { timeout: 5_000 });
    await expect(page.locator('.sn-history-item')).toHaveCount(0);
    await expect(page.locator('#filter option')).toHaveCount(1);
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
