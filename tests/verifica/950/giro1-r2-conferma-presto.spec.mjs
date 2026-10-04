// Verifica #950, giro 1, rilievo 2: «Rinomina» (o Invio) premuto mentre Filo sta ancora leggendo il file non deve
// buttare via la proposta: il file finisce col nome sensato, o la proposta resta davanti da confermare.

import { test, expect } from '../../fixtures/electron.mjs';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');

test('Invio durante «Leggo il file…»: la proposta che arriva dopo non va persa', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-v950-r2-');
  const vecchio = join(dir, 'scan_00231.pdf');
  writeFileSync(vecchio, PDF);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vecchio, etichetta: 'scan_00231.pdf' }) }] },
      { text: 'Eccolo.' },
    ]);
    // Il contenuto non conta: si prova il tempo. La proposta arriva dopo tre secondi, come da un modello vero.
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILE_NAME]: 'gemma', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      const N = require('/home/user/Filo/src/main/services/nomiFile.js');
      void N;
    }).catch(() => {});
    await app.evaluate(() => {
      const nomi = globalThis.__v950_nomi || (globalThis.__v950_nomi = true);
      void nomi;
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
        await new Promise((r) => setTimeout(r, 3000));
        return { text: 'Bolletta luce Enel Marzo 2026', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
    });
    const page = await home(app);
    await chiedi(page, 'trova la bolletta');
    const chip = page.locator('a.dash-action-btn').first();
    await expect(chip).toHaveText('scan_00231.pdf', { timeout: 15000 });
    await chip.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    await expect(page.locator('.sn-rinomina-stato')).toContainText('Leggo');
    await page.locator('.sn-rinomina-campo').press('Enter');

    const nuovo = join(dir, 'Bolletta luce Enel Marzo 2026.pdf');
    await expect.poll(async () => {
      if (existsSync(nuovo)) return 'rinominato';
      const campo = page.locator('.sn-rinomina-campo');
      if (await campo.count() && await campo.isVisible() && await campo.inputValue() === 'Bolletta luce Enel Marzo 2026') return 'proposta davanti';
      return 'persa';
    }, { timeout: 10000 }).not.toBe('persa');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
