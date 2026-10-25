// Verifica #1471, giro 3, rilievo 2: l'uso della carta «Impostazioni rapide» dalle sue pastiglie si conta.

import { test, expect } from '../../fixtures/electron.mjs';

const uso = (app, carta) => app.evaluate(async (c) => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  let n = 0;
  for (const [k, dati] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    const v = d.carta_home && d.carta_home[c];
    if (!v) continue;
    for (const voce of v.split(';')) { const p = voce.split('|'); if (p.length === 3) n += Number(p[2]); }
  }
  return n;
}, carta);

test('r2 un clic su una pastiglia della carta «Impostazioni rapide» è un uso della carta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const casa = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  const pastiglia = casa.locator('.dash-carta[data-chiave="rapide"] .dash-pastiglia').first();
  await expect(pastiglia).toBeVisible({ timeout: 10_000 });
  await pastiglia.click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme), { timeout: 8_000 }).toBe('dark');
  await expect.poll(() => uso(app, 'rapide'), { timeout: 8_000 }).toBe(1);
});
