// I gesti sulla cronologia degli appunti del menu del tasto destro. Dove sta il pannello lo sa solo
// tests/helpers/menuContestuale.mjs: qui si apre e si aspetta, senza cercarlo.

import { expect } from '../fixtures/electron.mjs';
import { menuDi, statoCronologia } from './menuContestuale.mjs';

export { statoCronologia };

// Tasto destro vero sul campo, poi la freccetta di Incolla: ritorna lo stato del pannello aperto.
export async function apriCronologia(app, page, campo) {
  await page.locator(campo).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible();
  const freccia = menu.locator('.sn-menu-paste-arrow');
  await expect(freccia).toBeVisible();
  await freccia.click();
  return cronologiaPronta(app, page);
}

// Il pannello aperto, quando ogni sua voce a schermo conterebbe un clic: il browser deve averla vista scoperta (#589.11).
export async function cronologiaPronta(app, page) {
  const pronta = (s) => !!s && s.voci.every((v) => v.pronta !== false) && s.svuotaPronta !== false;
  await expect.poll(async () => pronta(await statoCronologia(app, page)), { timeout: 5000 }).toBe(true);
  return statoCronologia(app, page);
}

// Testi delle voci visibili, null a pannello chiuso (comodo con expect.poll).
export async function testiCronologia(app, page) {
  const s = await statoCronologia(app, page);
  return s ? s.voci.map((v) => v.testo) : null;
}
