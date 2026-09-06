import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

// Feedback #422: le istruzioni fisse dei prompt lunghi ora stanno in testa,
// così i fornitori riusano quella parte invece di rielaborarla a ogni messaggio.
// Il modo per SAPERE se sta funzionando davvero è vederlo nel registro delle
// chiamate: se il riuso resta a zero, non sta funzionando.
//
// Questo spec ASSERISCE IL SUCCESSO: la cronologia delle richieste AI mostra,
// per ogni chiamata di cui conosce i token in ingresso, la quota riusata —
// distinguendo una chiamata con riuso pieno da una a zero. Pre-fix la pagina non
// mostrava nulla del genere (solo il costo): rosso al primo assert.

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

test('cronologia AI: mostra quanta parte del prompt è stata riusata', async () => {
  const now = Date.now();
  const aiHistory = [
    // Chiamata con riuso: 6400 token su 8000 letti dalla cache = 80%.
    { id: 'h-reuse', timestamp: new Date(now).toISOString(), action: 'filo_chat',
      provider: 'openrouter', model: 'gemini-3.1-flash-lite', input: { userMessage: 'messaggio con riuso' },
      output: 'risposta A', origin: 'filo://dashboard', costEur: 0.0002,
      usage: { promptTokens: 8000, completionTokens: 40, cachedPromptTokens: 6400 } },
    // Chiamata senza riuso: deve dire ZERO, non sparire.
    { id: 'h-no-reuse', timestamp: new Date(now - 1000).toISOString(), action: 'filo_chat',
      provider: 'openrouter', model: 'gemini-3.1-flash-lite', input: { userMessage: 'messaggio senza riuso' },
      output: 'risposta B', origin: 'filo://dashboard', costEur: 0.0002,
      usage: { promptTokens: 8000, completionTokens: 40, cachedPromptTokens: 0 } },
  ];

  const userData = mkdtempSync(join(tmpdir(), 'filo-hist-reuse-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const page = await findTabPage(app, 'history');
    expect(page, 'la pagina cronologia deve aprirsi').toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.sn-history-item')).toHaveCount(2);

    // La voce con riuso lo dichiara con la sua percentuale…
    const reused = page.locator('.sn-history-item', { hasText: 'messaggio con riuso' });
    await expect(reused.locator('.sn-history-reuse')).toHaveText('riuso 80%');
    // …e il dettaglio (al passaggio del mouse) dice quanti token su quanti.
    await expect(reused.locator('.sn-history-reuse'))
      .toHaveAttribute('title', /6\.400.*8\.000/);

    // La voce SENZA riuso lo dice esplicitamente: "zero" è l'informazione utile.
    const notReused = page.locator('.sn-history-item', { hasText: 'messaggio senza riuso' });
    await expect(notReused.locator('.sn-history-reuse')).toHaveText('riuso 0%');

    // Traccia visiva ispezionabile.
    try {
      mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
      await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'history-prompt-reuse.png') });
    } catch (_) {}
  } finally {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
