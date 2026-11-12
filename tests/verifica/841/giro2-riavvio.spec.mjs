// Verifica #841 giro 2: la scelta sopravvive al riavvio; un file di dati vecchio col valore di serie spento si riaccende.
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const lancia = (userData) => electron.launch({
  args: [...argomentiScala, '.'], cwd: ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
});
const flag = async (app) => {
  await expect.poll(() => app.evaluate(() => !!globalThis.SN_STORAGE), { timeout: 15_000 }).toBe(true);
  return app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags?.help);
};

test('spento a parole e riavviato due volte: resta spento', async () => {
  test.setTimeout(120_000);
  const ud = cartellaTemporanea('filo-v841-');
  try {
    let app = await lancia(ud);
    expect(await flag(app)).toBe(true);
    const r = await app.evaluate(async () => globalThis.__filoHandlers.executeFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'aiuto', valore: 'spento' }));
    expect(r.executed).toBe(true);
    expect(await flag(app)).toBe(false);
    await app.evaluate(() => globalThis.__filoStorage?.whenSettled?.());
    await chiudiApp(app);
    for (let i = 0; i < 2; i++) {
      app = await lancia(ud);
      expect(await flag(app)).toBe(false);
      await chiudiApp(app);
    }
  } finally { try { rmSync(ud, { recursive: true, force: true }); } catch (_) {} }
});

test('un file di dati di prima col valore di serie spento si apre con l\'Aiuto acceso, e la scelta dopo regge', async () => {
  test.setTimeout(120_000);
  const ud = cartellaTemporanea('filo-v841-');
  try {
    writeFileSync(join(ud, 'storage.json'), JSON.stringify({ settings: { theme: 'light', featureFlags: { help: false, categorize: false, spellcheck: true } } }));
    let app = await lancia(ud);
    expect(await flag(app)).toBe(true);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('light');
    await chiudiApp(app);
    app = await lancia(ud);
    expect(await flag(app)).toBe(true);
    await chiudiApp(app);
  } finally { try { rmSync(ud, { recursive: true, force: true }); } catch (_) {} }
});
