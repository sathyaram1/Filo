// Feedback #500: il menu del tasto destro NON ha un'altezza definitiva quando
// viene posato. Il riquadro della spiegazione (la sezione AI su un collegamento,
// su un'immagine, su una selezione) nasce a una riga e diventa di tre quando la
// risposta arriva: il menu cresce verso il basso DOPO essere stato piazzato,
// l'ultima voce finisce oltre il bordo della finestra — tagliata a metà e non
// cliccabile — e il menu non si risposta né si può scorrere.
//
// Questi spec asseriscono il SUCCESSO dal punto di vista di chi usa Filo:
// l'ULTIMA voce del menu (Invia feedback / Invia attacco, in fondo a QUALSIASI
// menu) resta dentro la finestra e si può puntare e cliccare davvero. Senza il
// fix — misura unica all'apertura — il menu resta dov'è, l'ultima voce sfora e
// Playwright non riesce nemmeno a portarci sopra il puntatore: rosso.
//
// Un menu che si muove porta con sé una conseguenza, provata in fondo al file:
// quando è così alto da doversi scorrere, lo scorrimento deve fermarsi dentro
// al menu (se passa alla pagina, la pagina scorre e il menu sparisce proprio a
// chi stava leggendo fino in fondo).
//
// Lo stesso difetto ha un secondo verso, in fondo al file: non è il menu ad
// allungarsi ma la FINESTRA ad accorciarsi sotto di lui. Il fondo esce dal
// bordo esattamente allo stesso modo, e il conto va rifatto uguale.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const LINK = 'https://example.com/articolo-lungo';

// Pagina col bersaglio nella metà bassa della finestra: lo scenario descritto.
function paginaLink() {
  return `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:65vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento in fondo</a>
  </body></html>`;
}

// Fa crescere il riquadro della spiegazione come fa la risposta AI quando
// arriva. `sfora` = di quanti px il menu finirebbe sotto il bordo se restasse
// dov'è: la crescita si calcola sulla posa vera, così lo scenario è lo stesso
// qualunque sia l'altezza del menu e della finestra.
async function cresciOltreIlBordo(page, sfora) {
  return menuDi(page).valuta((s) => {
    const menu = document.querySelector('.sn-menu');
    const box = menu && menu.querySelector('.sn-menu-inline');
    if (!box) return { error: 'nessun riquadro di spiegazione nel menu' };
    const bottom = menu.getBoundingClientRect().bottom;
    const vh = window.innerHeight;
    const delta = Math.max(24, Math.round(vh - bottom + s));
    box.style.minHeight = `${Math.round(box.getBoundingClientRect().height) + delta}px`;
    return { bottom, vh, delta };
  }, sfora);
}

// Pagina lunga: serve a vedere se lo scorrimento del menu si trasferisce alla
// pagina sotto (deve fermarsi dentro al menu).
function paginaLunga() {
  return `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:40vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="${LINK}" style="display:inline-block;padding:8px">un collegamento</a>
    <div style="height:300vh;padding:16px">Tanta pagina sotto, tutta scorrevole.</div>
  </body></html>`;
}

// Geometria del menu e della sua ultima voce.
async function geometria(page) {
  return menuDi(page).valuta(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return { error: 'menu chiuso' };
    const voci = menu.querySelectorAll('.sn-menu-item');
    const ultima = voci[voci.length - 1];
    const m = menu.getBoundingClientRect();
    const u = ultima ? ultima.getBoundingClientRect() : null;
    return {
      vh: window.innerHeight,
      menuTop: m.top,
      menuBottom: m.bottom,
      ultimaTesto: ultima ? (ultima.textContent || '').trim() : '',
      ultimaBottom: u ? u.bottom : null,
      scorrevole: menu.scrollHeight > menu.clientHeight + 1,
    };
  });
}

// Aspetta che il menu sia rientrato dopo la crescita.
async function attendiRientro(page) {
  await expect.poll(async () => {
    const g = await geometria(page);
    return g.error ? -1 : Math.round(g.menuBottom - g.vh);
  }, { timeout: 5000 }).toBeLessThanOrEqual(0);
}

async function apriMenuSu(page, selector, opts = {}) {
  await page.locator(selector).click({ button: 'right', ...opts });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  // Il riquadro della spiegazione: è lui che cresce quando la risposta arriva.
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  return menu;
}

test('#500 la spiegazione cresce: il menu del collegamento rientra invece di farsi tagliare', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLink());
  const menu = await apriMenuSu(page, '#link');

  const cresciuto = await cresciOltreIlBordo(page, 40);
  expect(cresciuto.error).toBeFalsy();
  expect(cresciuto.bottom + cresciuto.delta).toBeGreaterThan(cresciuto.vh);

  await attendiRientro(page);
  const g = await geometria(page);
  expect(g.menuTop).toBeGreaterThanOrEqual(0);
  expect(g.scorrevole).toBe(false);          // ci sta: basta spostarlo, non tagliarlo
  expect(g.ultimaBottom).toBeLessThanOrEqual(g.vh);
  expect(g.ultimaTesto.length).toBeGreaterThan(0);

  // E si può davvero puntare e cliccare l'ultima voce: Playwright rifiuta di
  // agire su un elemento fuori dalla finestra, quindi questo è il test vero.
  const ultima = menu.locator('.sn-menu-item').last();
  await ultima.hover({ timeout: 3000 });
  await ultima.click({ timeout: 3000 });
  await expect(menu).toHaveCount(0);
});

test('#500 il menu di una scheda filmato dentro un collegamento rientra a sua volta', async ({ openTab, testServer }) => {
  // Il menu più alto: azioni del filmato + azioni del link + spiegazione.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:55vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="card" href="${LINK}"><video id="clip" src="/clip.mp4" width="320" height="120" style="background:#333"></video></a>
  </body></html>`);
  const menu = await apriMenuSu(page, '#clip', { position: { x: 20, y: 20 } });

  const cresciuto = await cresciOltreIlBordo(page, 40);
  expect(cresciuto.error).toBeFalsy();

  await attendiRientro(page);
  const g = await geometria(page);
  expect(g.menuTop).toBeGreaterThanOrEqual(0);
  if (!g.scorrevole) expect(g.ultimaBottom).toBeLessThanOrEqual(g.vh);
  await menu.locator('.sn-menu-item').last().hover({ timeout: 3000 });
});

test('#500 se la spiegazione supera la finestra intera il menu diventa scorrevole', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLink());
  const menu = await apriMenuSu(page, '#link');

  // Nessuna posa può farlo stare: l'unica via d'uscita è lo scorrimento (#405).
  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu .sn-menu-inline');
    box.style.minHeight = `${window.innerHeight + 400}px`;
  });

  await expect.poll(async () => {
    const g = await geometria(page);
    if (g.error) return null;
    return { scorrevole: g.scorrevole, dentro: g.menuBottom <= g.vh && g.menuTop >= 0 };
  }, { timeout: 5000 }).toEqual({ scorrevole: true, dentro: true });
  await expect(menu).toBeVisible();
});

test('#500 se la spiegazione poi si accorcia il menu torna intero, senza barra', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLink());
  const menu = await apriMenuSu(page, '#link');

  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu .sn-menu-inline');
    box.style.minHeight = `${window.innerHeight + 400}px`;
  });
  await expect.poll(async () => (await geometria(page)).scorrevole, { timeout: 5000 }).toBe(true);

  // La spiegazione sparisce (succede davvero: "NESSUNA SPIEGAZIONE" toglie il
  // riquadro). Il tetto messo prima non deve restare addosso a un menu corto.
  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu .sn-menu-inline');
    box.style.minHeight = '';
  });
  await expect.poll(async () => (await geometria(page)).scorrevole, { timeout: 5000 }).toBe(false);
  const g = await geometria(page);
  expect(g.menuBottom).toBeLessThanOrEqual(g.vh);
  expect(g.menuTop).toBeGreaterThanOrEqual(0);
  await expect(menu).toBeVisible();
});

// --- lo scorrimento del menu si ferma dentro al menu -----------------------

// Rende la spiegazione più alta della finestra: nessuna posa può farci stare il
// menu, quindi diventa scorrevole.
async function rendiScorrevole(page) {
  await menuDi(page).valuta(() => {
    const box = document.querySelector('.sn-menu .sn-menu-inline');
    box.style.minHeight = `${window.innerHeight + 600}px`;
  });
  await expect.poll(async () => (await geometria(page)).scorrevole, { timeout: 5000 }).toBe(true);
}

// Porta il puntatore sul menu e gira la rotella `giri` volte.
async function rotellaSulMenu(page, giri, passo = 200) {
  const c = await menuDi(page).valuta(() => {
    const m = document.querySelector('.sn-menu').getBoundingClientRect();
    return { x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) };
  });
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < giri; i++) await page.mouse.wheel(0, passo);
}

async function statoScorrimento(page) {
  const menu = await menuDi(page).valuta(() => {
    const m = document.querySelector('.sn-menu');
    return {
      menuAperto: !!m,
      menuScrollTop: m ? Math.round(m.scrollTop) : -1,
      inFondo: m ? (m.scrollTop + m.clientHeight >= m.scrollHeight - 2) : false,
    };
  });
  return { ...menu, paginaY: await page.evaluate(() => Math.round(window.scrollY)) };
}

test('#500 letta la spiegazione fino in fondo, un giro di rotella in più non porta via il menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLunga());
  const menu = await apriMenuSu(page, '#link');
  await rendiScorrevole(page);

  // Fino in fondo alla spiegazione.
  await rotellaSulMenu(page, 20, 300);
  await expect.poll(async () => (await statoScorrimento(page)).inFondo, { timeout: 5000 }).toBe(true);

  const prima = await statoScorrimento(page);
  expect(prima.menuScrollTop).toBeGreaterThan(0);

  // Il colpo di troppo: col trackpad l'inerzia lo dà da sola. Il menu deve
  // restare, e la pagina sotto non deve muoversi di un pixel.
  await rotellaSulMenu(page, 4, 300);
  await page.waitForTimeout(400);

  const dopo = await statoScorrimento(page);
  expect(dopo.menuAperto).toBe(true);
  expect(dopo.paginaY).toBe(prima.paginaY);
  await expect(menu).toBeVisible();

  // E l'ultima voce si raggiunge davvero, scorrendo.
  const ultima = menu.locator('.sn-menu-item').last();
  await ultima.hover({ timeout: 3000 });
  await ultima.click({ timeout: 3000 });
  await expect(menu).toHaveCount(0);
});

// --- la FINESTRA si accorcia sotto al menu ---------------------------------
// L'altro verso dello stesso difetto: il menu sta fermo ed è la finestra a
// perdere altezza. Prima non succedeva niente — col menu di una selezione,
// che sopravvive apposta agli eventi di scorrimento, il menu restava esatto
// dov'era con le ultime voci fuori dal bordo.

// Cambia l'altezza della finestra e aspetta che la pagina se ne accorga.
// Ritorna la funzione che rimette le misure di prima.
async function accorciaFinestra(app, page, quanto) {
  const vhPrima = await page.evaluate(() => window.innerHeight);
  const bounds = await app.evaluate(async ({ BrowserWindow }, d) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const b = w.getBounds();
    w.setBounds({ ...b, height: Math.max(240, b.height - d) });
    return b;
  }, quanto);
  await expect
    .poll(async () => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeLessThan(vhPrima);
  return async () => {
    await app.evaluate(async ({ BrowserWindow }, b) => {
      BrowserWindow.getAllWindows().find((x) => x._filoTabs).setBounds(b);
    }, bounds);
  };
}

// Seleziona un paragrafo: il menu che ne esce è quello che il difetto colpiva
// per intero, perché è marcato per NON chiudersi sugli eventi di scorrimento.
async function selezionaParagrafo(page, selettore) {
  await page.evaluate((s) => {
    const p = document.querySelector(s);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, selettore);
}

test('#500 la finestra si accorcia sotto al menu di una selezione: il menu rientra e l\'ultima voce resta cliccabile', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:60vh;padding:16px">Testo in cima alla pagina.</div>
    <p id="frase" style="padding:8px">Una frase selezionata nella metà bassa della finestra.</p>
  </body></html>`);
  await selezionaParagrafo(page, '#frase');
  const menu = await apriMenuSu(page, '#frase');

  const prima = await geometria(page);
  expect(prima.menuBottom).toBeLessThanOrEqual(prima.vh);

  const ripristina = await accorciaFinestra(app, page, 340);
  try {
    await attendiRientro(page);
    const dopo = await geometria(page);
    expect(dopo.error).toBeFalsy();
    expect(dopo.menuTop).toBeGreaterThanOrEqual(0);
    expect(dopo.menuBottom).toBeLessThanOrEqual(dopo.vh);
    expect(dopo.ultimaBottom).toBeLessThanOrEqual(dopo.vh);
    expect(dopo.ultimaTesto.length).toBeGreaterThan(0);

    // La prova vera: Playwright rifiuta di puntare e cliccare un elemento
    // fuori dalla finestra.
    const ultima = menu.locator('.sn-menu-item').last();
    await ultima.hover({ timeout: 3000 });
    await ultima.click({ timeout: 3000 });
    await expect(menu).toHaveCount(0);
  } finally {
    await ripristina();
  }
});

test('#500 la finestra si accorcia sotto al menu di un collegamento: resta aperto e rientra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLink());
  const menu = await apriMenuSu(page, '#link');

  const ripristina = await accorciaFinestra(app, page, 340);
  try {
    // Non si chiude: chi rimpicciolisce la finestra non sta chiedendo di
    // annullare quello che stava per fare.
    await expect(menu).toBeVisible();
    await attendiRientro(page);
    const dopo = await geometria(page);
    expect(dopo.menuTop).toBeGreaterThanOrEqual(0);
    expect(dopo.menuBottom).toBeLessThanOrEqual(dopo.vh);
    await menu.locator('.sn-menu-item').last().hover({ timeout: 3000 });
  } finally {
    await ripristina();
  }
});

test('#500 la finestra scende sotto l\'altezza del menu: il menu diventa scorrevole invece di uscire', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaLink());
  await apriMenuSu(page, '#link');

  // Una spiegazione lunga: il menu arriva a riempire quasi tutta la finestra,
  // ma ci sta ancora — niente tetto, niente barra.
  await menuDi(page).valuta(() => {
    const menu = document.querySelector('.sn-menu');
    const box = menu.querySelector('.sn-menu-inline');
    const cresci = window.innerHeight - 60 - Math.round(menu.getBoundingClientRect().height);
    if (cresci > 0) box.style.minHeight = `${Math.round(box.getBoundingClientRect().height) + cresci}px`;
  });
  await attendiRientro(page);
  expect((await geometria(page)).scorrevole, 'il menu è già scorrevole: lo scenario non prova niente').toBe(false);

  // Adesso la finestra si accorcia: quel menu non ci sta più in nessuna posa.
  const ripristina = await accorciaFinestra(app, page, 340);
  try {
    await expect.poll(async () => {
      const g = await geometria(page);
      if (g.error) return null;
      return { scorrevole: g.scorrevole, dentro: g.menuBottom <= g.vh && g.menuTop >= 0 };
    }, { timeout: 5000 }).toEqual({ scorrevole: true, dentro: true });
  } finally {
    await ripristina();
  }
});
