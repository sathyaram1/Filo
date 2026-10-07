// Verifica #586 giro 21, rilievo 1: il menu nato in un dialogo modale prende ancora le regole del sito che passano sopra
// il ritorno ai valori di serie: quelle con !important, i contenuti prima/dopo gli elementi, le regole per le icone.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function misura(page, campo) {
  const box = await page.locator(campo).boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  return page.evaluate(() => {
    const root = document.querySelector('.sn-menu');
    const r = root.getBoundingClientRect();
    const voci = [...root.querySelectorAll('*')].filter((n) => !n.closest('svg')).map((n) => {
      const c = getComputedStyle(n);
      const b = n.getBoundingClientRect();
      return [n.className, Math.round(b.width), Math.round(b.height), c.backgroundColor, c.color, c.webkitTextFillColor,
        c.fontWeight, c.textTransform, getComputedStyle(n, '::before').content, getComputedStyle(n, '::after').content].join(' ');
    });
    const icone = [...root.querySelectorAll('svg')].map((s) => {
      const b = s.getBoundingClientRect();
      return `${Math.round(b.width)}x${Math.round(b.height)}`;
    });
    return { larghezza: Math.round(r.width), altezza: Math.round(r.height), voci, icone };
  });
}

async function fuoriEDentro(openTab, testServer, css) {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Accesso</title><style>${css}</style><body>
    <input id="fuori" style="margin:40px;width:300px">
    <dialog id="accedi" class="login" style="width:360px;padding:24px"><div><span>Email</span><input id="c" style="width:300px"></div><button>Accedi</button></dialog></body>`);
  const fuori = await misura(page, '#fuori');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('accedi').showModal());
  const dentro = await misura(page, '#c');
  expect(await page.evaluate(() => document.querySelector('.sn-menu').parentElement.id)).toBe('accedi');
  return { fuori, dentro };
}

test('r1 nato in un dialogo con regole !important per il suo contenuto, il menu è quello di sempre', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const { fuori, dentro } = await fuoriEDentro(openTab, testServer, `
    dialog button { background:#2563eb !important; color:#fff !important; padding:12px !important; border-radius:8px !important }
    dialog span { font-weight:700 !important; text-transform:uppercase !important }`);
  expect(dentro, 'le regole !important del dialogo sono arrivate al menu').toEqual(fuori);
});

test('r1 nato in un dialogo con contenuti prima e dopo gli elementi, il menu non li mostra', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const { fuori, dentro } = await fuoriEDentro(openTab, testServer, `
    dialog button::after { content:" ›"; color:#c00 }
    dialog div::before { content:""; display:block; height:12px; background:#c00 }`);
  expect(dentro, 'i contenuti aggiunti dal sito sono comparsi dentro il menu').toEqual(fuori);
});

test('r1 nato in un dialogo con regole per le icone del suo contenuto, le icone del menu restano della loro misura', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const { fuori, dentro } = await fuoriEDentro(openTab, testServer, `dialog svg { width:32px; height:32px }`);
  expect(dentro, 'le icone del menu hanno preso la misura che il sito scrive per le icone del dialogo').toEqual(fuori);
});
