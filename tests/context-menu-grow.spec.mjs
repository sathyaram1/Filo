// Feedback #500: il menu del tasto destro NON ha un'altezza definitiva quando
// viene posato. Il riquadro della spiegazione (la sezione AI su un collegamento,
// su un'immagine, su una selezione) nasce a una riga e diventa di tre quando la
// risposta arriva: il menu cresce verso il basso DOPO essere stato piazzato, e
// l'ultima voce finisce oltre il bordo della finestra, tagliata a metà e non
// cliccabile. Il menu non si risposta e non si può scorrere.
//
// Questi spec asseriscono il SUCCESSO dal punto di vista di chi usa Filo:
// l'ULTIMA voce del menu è dentro la finestra e si può cliccare davvero (il
// click esegue l'azione). Senza il fix — misura unica all'apertura — il menu
// resta dov'è, l'ultima voce sfora e il click sulle sue coordinate non la
// raggiunge: rosso.

import { test, expect } from './fixtures/electron.mjs';

const LINK = 'https://example.com/articolo-lungo';

// Pagina alta, col bersaglio nella metà bassa della finestra: è lo scenario
// descritto (menu aperto in basso, spiegazione che arriva dopo).
function pagina(extra = '') {
  return `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:70vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento in fondo</a>
    ${extra}
  </body></html>`;
}

// Fa crescere il riquadro della spiegazione come fa la risposta AI quando
// arriva: `delta` px in più di contenuto dentro la sezione inline del menu.
// Ritorna la geometria prima/dopo.
async function cresci(page, delta) {
  return page.evaluate((d) => {
    const menu = document.querySelector('.sn-menu');
    const box = menu.querySelector('.sn-menu-inline');
    if (!box) return { error: 'nessun riquadro di spiegazione nel menu' };
    const prima = menu.getBoundingClientRect().bottom;
    const target = (box.getBoundingClientRect().height || 0) + d;
    box.style.minHeight = `${target}px`;
    return { prima, vh: window.innerHeight };
  }, delta);
}

// Geometria dell'ultima voce cliccabile del menu.
async function ultimaVoce(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    const voci = menu.querySelectorAll('.sn-menu-item, .sn-menu-paste, .sn-menu-correction');
    const el = voci[voci.length - 1];
    const r = el.getBoundingClientRect();
    return {
      testo: (el.textContent || '').trim(),
      bottom: r.bottom,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      vh: window.innerHeight,
      menuBottom: menu.getBoundingClientRect().bottom,
    };
  });
}

test('#500 il riquadro della spiegazione cresce: il menu del collegamento resta dentro la finestra', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  const stato = await cresci(page, 60);
  expect(stato.error).toBeFalsy();
  // Il menu era posato vicino al bordo: la crescita lo porterebbe fuori.
  expect(stato.prima + 60).toBeGreaterThan(stato.vh);

  await expect.poll(async () => (await ultimaVoce(page)).menuBottom)
    .toBeLessThanOrEqual(stato.vh);

  const voce = await ultimaVoce(page);
  expect(voce.bottom).toBeLessThanOrEqual(voce.vh);
});

test('#500 dopo la crescita l\'ultima voce si clicca davvero', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  const stato = await cresci(page, 60);
  expect(stato.error).toBeFalsy();
  await expect.poll(async () => (await ultimaVoce(page)).menuBottom)
    .toBeLessThanOrEqual(stato.vh);

  // Click alle coordinate vere dell'ultima voce: se fosse ancora oltre il bordo
  // il puntatore non la incontrerebbe e il menu resterebbe aperto.
  const voce = await ultimaVoce(page);
  await page.mouse.click(voce.cx, voce.cy);
  await expect(menu).toHaveCount(0);
});

test('#500 il menu di una scheda filmato dentro un collegamento resta dentro la finestra', async ({ openTab, testServer }) => {
  // Il menu più alto: azioni del filmato + azioni del link + spiegazione.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:60vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="card" href="${LINK}"><video id="clip" src="/clip.mp4" width="320" height="120" style="background:#333"></video></a>
  </body></html>`);
  await page.locator('#clip').click({ button: 'right', position: { x: 20, y: 20 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  const stato = await cresci(page, 80);
  expect(stato.error).toBeFalsy();

  await expect.poll(async () => (await ultimaVoce(page)).menuBottom)
    .toBeLessThanOrEqual(stato.vh);
  const voce = await ultimaVoce(page);
  expect(voce.bottom).toBeLessThanOrEqual(voce.vh);
});

test('#500 un menu più alto della finestra diventa scorrevole invece di essere tagliato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina());
  await page.locator('#link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  // Una spiegazione enorme: non c'è posa che la faccia stare: deve scorrere.
  await page.evaluate(() => {
    const box = document.querySelector('.sn-menu .sn-menu-inline');
    box.style.minHeight = `${window.innerHeight + 400}px`;
  });

  await expect.poll(async () => page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    const r = m.getBoundingClientRect();
    return { scorre: m.scrollHeight > m.clientHeight + 1, dentro: r.bottom <= window.innerHeight && r.top >= 0 };
  })).toEqual({ scorre: true, dentro: true });
});
