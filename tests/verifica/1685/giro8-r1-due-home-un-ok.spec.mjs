// Verifica #1685 giro 8, rilievo 1: due home sulla stessa conversazione mostrano lo stesso bottone di una conferma in
// sospeso; dato l'OK in una, l'altra non deve poter far partire l'azione una seconda volta.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const accoda = (file) => ({ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo x >> "${file}"`, spiegazione: 'Accodo una riga' }) });
const righe = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((r) => r.trim()).length : 0);

test('r1 dato l\'OK in una home, il bottone della stessa conferma nell\'altra home non rifà l\'azione', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('giro8-due-home-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Accodo.', toolCalls: [accoda(f)] }, { text: 'Aspetto il tuo OK.' }, { text: '' }, { text: 'DI NUOVO' }]);
    await chiedi(page, 'accoda una riga al file');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

    const b = await openTab('filo://newtab/');
    await expect(b.locator('.dash-bubble-user', { hasText: 'accoda una riga al file' })).toBeVisible({ timeout: 10_000 });
    const bottoneB = b.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    await expect(bottoneB).toBeVisible({ timeout: 8_000 });

    await shell.locator('.tab').first().click();
    const bottoneA = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    await bottoneA.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect.poll(() => righe(f), { timeout: 8_000 }).toBe(1);
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

    await shell.locator('.tab').nth(1).click();
    await page.waitForTimeout(1000);
    if (!/^✓/.test(String(await bottoneB.first().textContent()))) {
      await bottoneB.first().click();
      if (await b.locator(CONFIRM_HOST).isVisible({ timeout: 3_000 }).catch(() => false)) {
        if (await b.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(b, 'conferma');
        await scrollConfirmToEnd(b);
        await clickConfirm(b, 'ok');
      }
      await b.waitForTimeout(2500);
    }
    expect(righe(f), 'l\'azione confermata una volta è partita una volta sola').toBe(1);
    await expect(b.locator('.dash-bubble-filo', { hasText: 'DI NUOVO' }), 'nessuna seconda ripresa').toHaveCount(0);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
