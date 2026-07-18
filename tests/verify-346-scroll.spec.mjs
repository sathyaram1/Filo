// VERIFIER #346 (black-box dal sintomo): "non vedo dove scrivere" + "scroll
// rotto sul pannello a destra e sinistra (probabilmente anche centrale)".
// Sintomo tradotto in comportamento: quando una colonna del builder ha più
// contenuto dell'altezza disponibile DEVE scrollare al suo interno; la barra
// per scrivere (in fondo alla colonna chat) DEVE restare dentro il riquadro
// visibile. Se il fix venisse rimosso, questi assert diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

async function openBuilder(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

// Riempie il corpo di una colonna con tanto contenuto reale da superare
// l'altezza disponibile (blocchi alti, non una singola stringa lunga).
async function stuff(page, bodySel, n) {
  await page.evaluate(({ sel, count }) => {
    const body = document.querySelector(sel);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('p');
      p.textContent = 'Riga di contenuto numero ' + i + ' — testo di riempimento.';
      p.style.margin = '14px 0';
      body.appendChild(p);
    }
  }, { sel: bodySel, count: n });
}

test('#346 — colonne scrollano internamente e l\'input chat resta visibile quando il contenuto trabocca', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await openBuilder(page);

  // Riempie tutte e tre le colonne oltre l'altezza dello schermo.
  await stuff(page, '#chatLog', 80);          // colonna chat (sinistra)
  await stuff(page, '#colDeck .dk-col-body', 80);   // colonna mazzo (centrale)
  await stuff(page, '#colDetail .dk-col-body', 80);  // colonna dettaglio (destra)
  await page.waitForTimeout(50);

  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const grid = document.getElementById('builderGrid');
    const gb = r(grid);
    const bodies = {
      chat: document.getElementById('chatLog'),
      deck: document.querySelector('#colDeck .dk-col-body'),
      detail: document.querySelector('#colDetail .dk-col-body'),
    };
    const scrolls = {};
    for (const k of Object.keys(bodies)) {
      const el = bodies[k];
      scrolls[k] = { scrollH: el.scrollHeight, clientH: el.clientHeight };
    }
    return {
      gridBottom: gb.bottom,
      gridHeight: gb.height,
      colChatBottom: r(document.getElementById('colChat')).bottom,
      colDeckBottom: r(document.getElementById('colDeck')).bottom,
      colDetailBottom: r(document.getElementById('colDetail')).bottom,
      inputRect: (() => { const b = r(document.getElementById('chatInput')); return { top: b.top, bottom: b.bottom, height: b.height }; })(),
      formTop: r(document.getElementById('chatForm')).top,
      scrolls,
    };
  });

  // 1) Nessuna colonna trabocca fuori dal riquadro a altezza fissa del builder.
  expect(m.colChatBottom).toBeLessThanOrEqual(m.gridBottom + 2);
  expect(m.colDeckBottom).toBeLessThanOrEqual(m.gridBottom + 2);
  expect(m.colDetailBottom).toBeLessThanOrEqual(m.gridBottom + 2);

  // 2) Ogni corpo colonna scrolla DAVVERO al suo interno (contenuto > altezza).
  for (const k of ['chat', 'deck', 'detail']) {
    expect(m.scrolls[k].scrollH).toBeGreaterThan(m.scrolls[k].clientH + 20);
  }

  // 3) SINTOMO "non vedo dove scrivere": la barra input in fondo alla chat resta
  //    dentro il riquadro visibile (non spinta sotto il bordo del builder).
  expect(m.inputRect.bottom).toBeLessThanOrEqual(m.gridBottom + 2);
  expect(m.inputRect.top).toBeGreaterThanOrEqual(0);
  expect(m.inputRect.height).toBeGreaterThan(10);

  // Traccia visiva ispezionabile della run.
  await page.screenshot({ path: 'tests/.shots/verify-346-scroll.png' });
});
