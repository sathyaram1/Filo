// Verifica #843, giro 1, rilievo 1: due siti incollati sulla stessa riga (virgola o spazio) nella pagina Altro.
import { test, expect } from '../../fixtures/electron.mjs';

const esclusi = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).blocklist);

for (const incollato of ['docs.google.com, figma.com', 'docs.google.com figma.com']) {
  test(`r1 la pagina Altro spegne Filo su tutti e due i siti di «${incollato}»`, async ({ app, openTab }) => {
    const altro = await openTab('filo://options/altro.html');
    const casella = altro.locator('#blocklist');
    await expect(casella).toHaveValue('', { timeout: 8000 });
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), incollato);
    await casella.click();
    await altro.keyboard.press('Control+V');
    await altro.locator('#h-blocklist').click();
    await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual(['docs.google.com', 'figma.com']);
    await expect(altro.locator('#blocklistError')).toBeHidden();
  });
}
