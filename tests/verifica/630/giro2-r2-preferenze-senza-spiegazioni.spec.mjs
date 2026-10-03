// Verifica #630 giro 2, rilievo 2: nella sezione Notifiche delle Preferenze nessuna frase spiega l'interfaccia
// (qui: quali avvisi suonano e quali no, nell'etichetta della casella del suono).
import { test, expect } from '../../fixtures/electron.mjs';

test('Preferenze, Notifiche: l’etichetta del suono non spiega quali avvisi restano muti', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#notifSoundEnabled');
  const sezione = page.locator('section', { has: page.locator('#notifDuration') });
  await expect(sezione).not.toContainText('restano mute');
  await expect(sezione).not.toContainText('Copiato');
});
