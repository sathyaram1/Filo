// Esplorazione temporanea del giro 3: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { usaServerFinto, homePage, prepara, onboardingFatto, riscattaDaCrediti } from './_crediti-finti.mjs';

const stato = usaServerFinto(test);
const INVITO = /codice d.invito/i;

async function scrivi(home, testo) {
  await home.fill('#input', testo);
  await home.press('#input', 'Enter');
}

test('esplora: già accolto, dopo il riscatto «Riprova» risponde col modello', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app, stato.base);
  await onboardingFatto(app);
  const home = await homePage(app);
  await home.reload();
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await scrivi(home, 'ciao');
  await expect(home.locator('#bubbles')).toContainText(INVITO, { timeout: 20_000 });
  await riscattaDaCrediti(openTab);
  await shell.locator('.tab').first().click();
  await home.waitForTimeout(4000);
  await home.screenshot({ path: 'tests/.shots/giro3-gia-accolto.png' });
  await home.locator('#bubbles button', { hasText: 'Riprova' }).click();
  await expect(home.locator('#bubbles')).toContainText('Dimmi pure.', { timeout: 30_000 });
  console.log('RIPROVA-OK', await home.locator('#bubbles').innerText());
});

test('esplora: nuovo, invito del primo avvio dopo aver scritto: com’è la home', async ({ app }) => {
  test.setTimeout(180_000);
  stato.pendingCode = 'ABCD-EFGH';
  stato.trattieni = true;
  await prepara(app, stato.base);
  const home = await homePage(app);
  await expect.poll(() => stato.trattenute.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(home.locator('#homeMessage')).toContainText(INVITO, { timeout: 30_000 });
  await scrivi(home, 'ciao');
  await expect(home.locator('#bubbles')).toContainText(INVITO, { timeout: 20_000 });
  await home.fill('#input', 'sto scrivendo');
  for (const r of stato.trattenute.splice(0)) r();
  await expect(home.locator('#bubbles')).toContainText(/Ciao, sono Filo/, { timeout: 30_000 });
  await home.waitForTimeout(1500);
  await home.screenshot({ path: 'tests/.shots/giro3-nuovo-invito.png' });
  console.log('INPUT', JSON.stringify(await home.inputValue('#input')));
  const ok = home.locator('button', { hasText: /Inizia|Grazie|OK|Va bene|Chiudi/ }).first();
  if (await ok.count()) { await ok.click().catch(() => {}); await home.waitForTimeout(800); }
  await home.screenshot({ path: 'tests/.shots/giro3-nuovo-invito-dopo.png' });
});
