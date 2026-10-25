// Verifica #1471, giro 3, rilievo 3: un'icona presa e lasciata dov'era non è uno spostamento.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const gesti = (app) => app.evaluate(async () => {
  const C = globalThis.SN_CONTATORI;
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = C.giornoDi(Date.now());
  const out = { spostata: 0, posato: 0, annullato: 0 };
  for (const [k, dati] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    const d = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: k, app: '0.0.0', os: 'linux', dati });
    for (const v of Object.values(d.icona_spostata || {})) for (const voce of v.split(';')) out.spostata += Number(voce.split('|').pop());
    const t = d.trascinamento && d.trascinamento.icona_menu;
    if (t) for (const voce of t.split(';')) { const [, esito, n] = voce.split('|'); out[esito] += Number(n); }
  }
  return out;
});

test('r3 un’icona della riga del tasto destro presa e lasciata al suo posto non si conta come spostata', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;padding:40px;height:1400px"><p id="p">Clic destro qui.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  const ico = menu.icona('share');
  const b = await ico.boundingBox();
  const prima = await menu.valuta(() => [...document.querySelectorAll('.sn-menu-icon-row [data-sn-icon-id]')].map((x) => x.dataset.snIconId).join(','));
  const mouse = menu.superficie.mouse;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await mouse.move(cx, cy);
  await mouse.down();
  await mouse.move(cx + 12, cy + 6, { steps: 6 });
  await mouse.move(cx + 2, cy, { steps: 6 });
  await mouse.up();
  await new Promise((r) => setTimeout(r, 1000));
  const dopo = await menu.valuta(() => [...document.querySelectorAll('.sn-menu-icon-row [data-sn-icon-id]')].map((x) => x.dataset.snIconId).join(','));
  expect(dopo, 'la riga resta com’era').toBe(prima);
  expect(await gesti(app)).toEqual({ spostata: 0, posato: 0, annullato: 1 });
});
