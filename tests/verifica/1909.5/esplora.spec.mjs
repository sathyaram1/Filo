import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('a Normale Filo propone rsync --delete: il riquadro vuole la parola, come robocopy /MIR', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  for (const comando of ['rsync -a --delete vuota/ ~/Documenti/', 'robocopy vuota C:\\Users\\x\\Documents /MIR']) {
    try {
      await modelloFinto(app, [
        { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando, spiegazione: 'Allineo le cartelle' }) }] },
        { text: 'Fine.' },
      ]);
      await chiedi(page, 'allinea Documenti alla cartella vuota');
      const host = page.locator(CONFIRM_HOST);
      const bottone = page.locator('.dash-action-btn-primary').last();
      await expect(host.or(bottone).first()).toBeVisible({ timeout: 20_000 });
      if (!(await host.isVisible())) await bottone.click();
      await expect(host).toBeVisible({ timeout: 10_000 });
      const s = await confirmState(page);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `verifica-1909-5-${comando.split(' ')[0]}.png`) });
      console.log(comando, '=>', JSON.stringify(s));
      expect(s.hasInput, `${comando}: vuole la parola`).toBe(true);
      expect(s.text).toContain('cancella per sempre, senza passare dal cestino');
      await clickConfirm(page, 'cancel');
    } finally {
      await ripristina(app);
    }
  }
});
