// Verifica #2372.1 giro 1, rilievo 1: dare una lettera nuova a un tasto che ne aveva già una toglie la vecchia in silenzio.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

test('r1 dalle Preferenze: «i» alle Impostazioni, che avevano «e», dice che «ee» non le apre più', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'e', tasto: 'impostazioni' }] } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.locator('#doppioToccoNuova').fill('i');
  await pref.locator('#doppioToccoDove').fill('Impostazioni');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.map((v) => v.lettera).join())).toBe('i');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.screenshot({ path: `${SHOTS}/2372-1-v-lettera-tasto.png` });
  await expect(pref.locator('#doppioToccoHint')).toContainText('ee');
});

test('r1 a parole: «i impostazioni», che avevano «e», lo dice nella risposta', async ({ app }) => {
  const label = await app.evaluate(() => {
    const r = globalThis.SN_DOPPIO_TOCCO.daTesto('i impostazioni', { doppioTocco: { lettere: [{ lettera: 'e', tasto: 'impostazioni' }] } });
    return { lettere: r.lettere.map((v) => v.lettera).join(), label: r.label };
  });
  expect(label.lettere).toBe('i');
  expect(label.label).toContain('ee');
});
