// Verifica #430 giro 2 — esplorazione: alla riapertura di Filo le schede della sessione di prima hanno la foto.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { pagina, schede, carta, rosso, verde } from './giro2-carta.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('riaperto Filo, le schede della sessione di prima mostrano la loro foto al passaggio', async ({ testServer }) => {
  const uR = testServer.html(pagina('#d01010', 'Rossa'));
  const uV = testServer.html(pagina('#10b010', 'Verde'));
  const uB = testServer.html(pagina('#1030d0', 'Blu'));
  const userData = cartellaTemporanea('filo-test-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_open_tabs: { tabs: [uR, uV, uB], activeIndex: 2 } }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      const s = await schede(app);
      return s.tutte.filter((t) => [uR, uV, uB].includes(t.url) && !t.loading).length;
    }, { timeout: 20_000 }).toBe(3);
    const s = await schede(app);
    console.log('SCHEDE', JSON.stringify(s));
    await expect.poll(async () => {
      const x = await schede(app);
      return [uR, uV].every((u) => x.tutte.find((t) => t.url === u)?.foto);
    }, { timeout: 15_000 }).toBe(true);
    const idR = s.tutte.find((t) => t.url === uR).id;
    const idV = s.tutte.find((t) => t.url === uV).id;
    await shell.mouse.move(600, 500);
    await shell.waitForTimeout(900);
    await shell.locator(`.tab[data-id="${idR}"]`).hover();
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 2000 }).toBe(true);
    await shell.locator(`.tab[data-id="${idV}"]`).hover();
    await expect.poll(async () => verde((await carta(app)).colore), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
