// Verifica #967 giro 3: «Togli» su più siti di fila mentre il salvataggio è lento (disco occupato, antivirus).
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const fidatiSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.safeBrowse.trustedSites);

test('r1 tre «Togli» di fila sulla prima riga con un salvataggio lento: escono i tre siti tolti, e nessuno ricompare', async ({ app, shell }) => {
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['uno967.it', 'due967.it', 'tre967.it', 'quattro967.it'] } } }));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sic = await aspettaFinestra(app, (w) => w.url().startsWith('filo://security/'), 'Sicurezza');
  const box = sic.locator('#sec-safebrowse-fidati');
  await expect(box.locator('li')).toHaveCount(4, { timeout: 10_000 });
  // Il disco risponde in 400 ms: una scrittura dura più del tempo fra due clic.
  await app.evaluate(() => {
    const S = globalThis.SN_STORAGE;
    const vero = S.updateSettings;
    S.updateSettings = async (...a) => { await new Promise((r) => setTimeout(r, 400)); return vero.apply(S, a); };
  });
  const visti = [];
  for (let i = 0; i < 3; i++) {
    const riga = box.locator('li').first();
    visti.push((await riga.locator('span').textContent()).trim());
    await riga.getByRole('button', { name: 'Togli' }).click();
    await sic.waitForTimeout(250);
  }
  await sic.waitForTimeout(2500);
  // Ogni clic ha tolto un sito diverso, quello che l'utente vedeva in cima.
  expect(new Set(visti).size, `righe cliccate: ${visti.join(', ')}`).toBe(3);
  expect(await fidatiSalvati(app)).toEqual(['quattro967.it']);
  await expect(box.locator('li')).toHaveCount(1);
});
