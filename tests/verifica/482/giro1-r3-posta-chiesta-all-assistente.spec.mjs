// Verifica #482 giro 1, rilievo 3: la posta chiesta all'assistente è rifiutata «per sicurezza», mentre un clic la apre.
import { test, expect } from '../../fixtures/electron.mjs';

test('r3 l\'assistente che apre un indirizzo di posta lo consegna al programma di posta', async ({ app }) => {
  await app.evaluate(({ shell }) => {
    globalThis.__esterni = [];
    shell.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
  });
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: 'mailto:mario@esempio.it?subject=Ciao' }));
  expect(r && r.output && r.output.blocked, 'rifiutata come indirizzo non ammesso').toBeFalsy();
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 5000 }).toEqual(['mailto:mario@esempio.it?subject=Ciao']);
});
