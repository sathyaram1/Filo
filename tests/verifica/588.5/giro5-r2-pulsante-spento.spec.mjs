// Verifica #588.5 giro 5, rilievo 2: quando se ne va l'avviso più vecchio (chiuso con la X o scaduto), i pulsanti
// dell'avviso più recente si spengono per un secondo anche se non si sono mossi, e il clic che ci arriva va perso.
import { test, expect } from '../../fixtures/electron.mjs';

async function dueAvvisi(shell, avvisi, primoSec) {
  await shell.evaluate((primoSec) => {
    window.__apri = 0;
    window.filoNotify('Scaricato: primo.pdf', { durationSec: primoSec, actions: [{ label: 'Apri file', onClick: () => {} }] });
  }, primoSec);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await shell.evaluate(() => window.filoNotify('Scaricato: secondo.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => { window.__apri++; } }] }));
  const secondo = vista.locator('.shell-notif.show', { hasText: 'secondo.pdf' }).locator('.shell-notif-action');
  await expect(secondo).toBeEnabled({ timeout: 3000 });
  return { vista, secondo };
}

test('chiuso con la X l’avviso più vecchio, «Apri file» di quello più recente risponde subito', async ({ shell, avvisi }) => {
  const { vista, secondo } = await dueAvvisi(shell, avvisi, 0);
  await vista.locator('.shell-notif.show', { hasText: 'primo.pdf' }).locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(1, { timeout: 3000 });
  await vista.waitForTimeout(300);
  // force: il clic va dove sta il pulsante, come il mouse dell'utente, senza aspettare che si riaccenda.
  await secondo.click({ force: true });
  await expect.poll(() => shell.evaluate(() => window.__apri), { timeout: 2000 }).toBe(1);
});

test('scaduto da solo l’avviso più vecchio, «Apri file» di quello più recente risponde subito', async ({ shell, avvisi }) => {
  const { vista, secondo } = await dueAvvisi(shell, avvisi, 2);
  await expect(shell.locator('.shell-notif')).toHaveCount(1, { timeout: 5000 });
  await vista.waitForTimeout(300);
  await secondo.click({ force: true });
  await expect.poll(() => shell.evaluate(() => window.__apri), { timeout: 2000 }).toBe(1);
});
