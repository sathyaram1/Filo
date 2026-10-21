// #872.4 giro 1, rilievo 1: corretta una riga, il doppio clic sulla riga sotto deve lasciarne aperto il campo.
import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());

test('r1 correggo «Ama il tè» e faccio doppio clic su «Vive a Lisbona»: la prima è salvata e la seconda resta in correzione', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nVive a Lisbona' }));
  const page = await openTab(QUADERNO);
  await expect(riga(page, 'Ama il tè')).toHaveCount(1, { timeout: 8_000 });
  const campo = page.locator('.qd-campo');
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await campo.fill('Ama il caffè');
  await riga(page, 'Vive a Lisbona').locator('.qd-testo').dblclick();
  await expect(riga(page, 'Ama il caffè')).toHaveCount(1);
  expect((await memoria(app)).PREFERENZE).toBe('Ama il caffè\nVive a Lisbona');
  await page.waitForTimeout(800);
  await expect(campo).toHaveCount(1);
  await expect(campo).toHaveValue('Vive a Lisbona');
  await expect(campo).toBeFocused();
});
