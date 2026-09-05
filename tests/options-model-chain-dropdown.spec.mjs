// Feedback alpha (BiA4JTqkNasdsRQ0A7eQ): il menu di selezione del modello nelle
// pagine "Modelli" (Opzioni) e "Modelli predefiniti" usava il popup NATIVO della
// <datalist>, fuori dalla palette di Filo (colori di sistema). Ora l'editor a
// segmenti mostra un dropdown custom coerente con gli altri menu a tendina di
// Filo (classi .sn-select-*), letto dalle stesse opzioni del registry.
//
// Il test asserisce il COMPORTAMENTO atteso (non solo l'assenza del vecchio):
//   1. L'input del segmento NON usa più la datalist nativa (niente attributo
//      `list`) → senza il fix questo è rosso.
//   2. Mettendo a fuoco l'input compare un popup custom .sn-chain-pop con le
//      opzioni del registry (es. "flash"); è lo stile coerente di Filo.
//   3. Cliccando un'opzione l'input si compila con quel nickname e il valore
//      viene salvato → la selezione "dalla tendina" funziona davvero.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 4_000 });
}

test('Modelli per azione: dropdown custom Filo al posto della datalist nativa', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP (1 segmento)
  const input = chain.locator('.sn-chain-input').nth(0);

  // (1) Niente più popup nativo della datalist.
  await expect(input).not.toHaveAttribute('list', /.*/);

  // (2) Il focus apre il dropdown custom con le opzioni del registry.
  await input.focus();
  const pop = chain.locator('.sn-chain-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  const flashOpt = pop.locator('.sn-select-option', { hasText: 'deepseek-flash' }).first();
  await expect(flashOpt).toBeVisible();

  // (3) Cliccando un'opzione l'input si compila e il valore persiste.
  await input.fill('deepseek-flash');
  await expect(pop).toBeVisible();
  const exact = pop.locator('.sn-select-option').filter({ has: page.locator('.sn-chain-opt-nick', { hasText: /^deepseek-flash$/ }) }).first();
  await exact.click();
  await expect(input).toHaveValue('deepseek-flash');

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  const saved = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.EXPLAIN_DEEP];
  });
  expect(saved).toBe('deepseek-flash');
});

test('Modelli per azione: digitando si filtra la tendina custom', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const chain = page.locator('#modelsGrid .sn-chain').nth(1);
  const input = chain.locator('.sn-chain-input').nth(0);
  await input.focus();
  const pop = chain.locator('.sn-chain-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });

  // Al focus si vedono TUTTI i nickname del registry (anche con il campo già
  // compilato col default), così l'utente può sceglierne un altro.
  const total = await pop.locator('.sn-select-option').count();
  expect(total).toBeGreaterThan(1);

  // Filtra per "whisper": resta solo whisper.
  await input.fill('whisper');
  await expect(pop.locator('.sn-select-option')).toHaveCount(1);
  await expect(pop.locator('.sn-select-option').first()).toContainText('whisper');
});
