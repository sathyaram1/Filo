// Verifica #1704 giro 1, rilievo 1: riaperta la home, le righe delle segnalazioni della conversazione ripresa non
// mostrano più il fumetto col testo (dal vivo sì). Modello finto, invio finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const TESTO = 'Il timer non suona mai quando la scheda è dietro.';

async function passaSopra(page, loc) {
  const c = await loc.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 3 });
}

for (const esito of ['inviata', 'non inviata']) {
  test(`r1 riaperta la home, la riga «Segnalazione ${esito}» mostra ancora titolo e testo nel fumetto`, async ({ app }) => {
    test.setTimeout(90_000);
    const page = await home(app);
    await app.evaluate(() => {
      globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
      globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fb-1704' });
    });
    try {
      await livelloAutonomia(app, 'conservativo');
      await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: TESTO, titolo: 'Timer muto' }) }] }, { text: 'Fatto.' }]);
      await chiedi(page, 'segnala il timer');
      await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
      if (esito === 'inviata') {
        if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
        await scrollConfirmToEnd(page);
        await clickConfirm(page, 'ok');
        await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: '✓' }).first()).toBeVisible({ timeout: 10_000 });
      } else {
        await clickConfirm(page, 'cancel');
        // Dal vivo il tasto della proposta lo dice: è la stessa segnalazione.
        const tasto = page.locator('.dash-bubble-filo .dash-action-btn', { hasNotText: '✓' }).first();
        await expect(tasto).toBeVisible({ timeout: 5000 });
        await passaSopra(page, tasto);
        await expect(page.locator('[data-sn-fumetto] .tip')).toContainText(TESTO, { timeout: 3000 });
        await page.mouse.move(5, 5);
      }
      await page.reload();
      const di = await home(app);
      const riga = di.getByText(esito === 'inviata' ? 'Segnalazione inviata · Timer muto' : 'Segnalazione non inviata').first();
      await expect(riga).toBeVisible({ timeout: 10_000 });
      await passaSopra(di, riga);
      const tip = di.locator('[data-sn-fumetto] .tip');
      await expect(tip).toBeVisible({ timeout: 3000 });
      await expect(tip).toContainText('Timer muto');
      await expect(tip).toContainText(TESTO);
    } finally {
      await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
      await ripristina(app);
    }
  });
}
