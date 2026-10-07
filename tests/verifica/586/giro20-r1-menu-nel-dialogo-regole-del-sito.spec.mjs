// Verifica #586 giro 20, rilievo 1: nato dentro un dialogo modale, il menu prende le regole che il sito scrive per il
// contenuto del dialogo (bottoni colorati, etichette in grassetto, spazi in più). Il giro 19 ha chiuso solo l'eredità.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS = `
  .login button { width:100%; padding:12px; background:#2563eb; color:#fff; border-radius:8px; font-weight:600 }
  dialog div { margin-bottom:16px }
  dialog span { font-weight:600; letter-spacing:.5px }`;

async function misuraMenu(page, campo) {
  const box = await page.locator(campo).boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  return page.evaluate(() => {
    const root = document.querySelector('.sn-menu');
    const voce = root.querySelector('.sn-menu-paste-main');
    const etichetta = voce.querySelector('.sn-menu-label');
    const r = root.getBoundingClientRect();
    const cv = getComputedStyle(voce);
    const ce = getComputedStyle(etichetta);
    return {
      larghezza: Math.round(r.width), altezza: Math.round(r.height),
      sfondo: cv.backgroundColor, colore: cv.color, peso: ce.fontWeight, spaziatura: ce.letterSpacing,
    };
  });
}

test('r1 nato in un dialogo modale con le regole del sito per il suo contenuto, il menu è quello di sempre', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Accesso</title><style>${CSS}</style><body>
    <input id="fuori" style="margin:40px;width:300px">
    <dialog id="accedi" class="login" style="width:360px;padding:24px"><div><span>Email</span><input id="c" style="width:300px"></div><button>Accedi</button></dialog></body>`);
  const fuori = await misuraMenu(page, '#fuori');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('accedi').showModal());
  const dentro = await misuraMenu(page, '#c');
  expect(await page.evaluate(() => document.querySelector('.sn-menu').parentElement.id)).toBe('accedi');
  expect(dentro, 'il menu nel dialogo ha preso lo stile che il sito scrive per il contenuto del dialogo').toEqual(fuori);
});
