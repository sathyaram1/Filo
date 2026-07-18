// Feedback #346: nel builder "non vedo dove scrivere" e "lo scroll è rotto sul
// pannello a destra e sinistra". Causa: le tre colonne del builder sono flex in
// colonna dentro un grid ad altezza fissa, ma senza `min-height: 0` il corpo
// scrollabile (.dk-col-body) cresce fino al contenuto invece di scrollare — così
// il .dk-col-body non scrolla MAI e, nella colonna chat, l'input in fondo viene
// spinto fuori dal riquadro (clippato da overflow:hidden) → "non vedo dove
// scrivere". Questo spec riempie di contenuto le colonne e ASSERISCE:
//   - il corpo di ogni colonna scrolla davvero (scrollHeight > clientHeight);
//   - la barra input della chat resta DENTRO il riquadro del builder (visibile).

import { test, expect } from './fixtures/electron.mjs';

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

// Riempie un contenitore con molte righe alte così da superare l'altezza della
// colonna e forzare l'overflow verticale.
async function stuff(page, sel, n) {
  await page.evaluate(({ sel, n }) => {
    const host = document.querySelector(sel);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('p');
      p.textContent = 'riga di contenuto molto lunga numero ' + i;
      p.style.margin = '12px 0';
      host.appendChild(p);
    }
  }, { sel, n });
}

test('#346 builder: i corpi delle colonne scrollano e l\'input chat resta visibile', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  // Riempi le tre colonne oltre la loro altezza.
  await stuff(page, '#chatLog', 60);
  await stuff(page, '#deckList', 60);
  await stuff(page, '#statsBody', 60);
  // #statsBody è nascosto di default (deck vuoto): mostralo per misurarne il corpo.
  await page.evaluate(() => {
    document.getElementById('statsBody').hidden = false;
    document.getElementById('statsEmpty').hidden = true;
  });

  const m = await page.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect();
    const builder = document.getElementById('builderGrid');
    const bRect = rect(builder);
    const bodies = Array.from(document.querySelectorAll('.dk-col-body'));
    const form = document.getElementById('chatForm');
    const fRect = rect(form);
    return {
      builderBottom: bRect.bottom,
      builderTop: bRect.top,
      // Per ogni corpo colonna: scrolla se scrollHeight supera clientHeight e il
      // corpo NON è cresciuto fino al contenuto (clientHeight limitato).
      bodies: bodies.map((el) => ({
        scrollable: el.scrollHeight - el.clientHeight > 4,
        bottom: rect(el).bottom,
      })),
      formTop: fRect.top,
      formBottom: fRect.bottom,
    };
  });

  // Ogni corpo colonna deve scrollare (overflow interno), non crescere all'infinito.
  for (const b of m.bodies) {
    expect(b.scrollable).toBe(true);
    // Il corpo non deve sfondare il fondo del riquadro del builder.
    expect(b.bottom).toBeLessThanOrEqual(m.builderBottom + 2);
  }

  // La barra input della chat sta DENTRO il riquadro del builder ed è visibile
  // (non spinta sotto/fuori dal fondo). È il sintomo "non vedo dove scrivere".
  expect(m.formBottom).toBeLessThanOrEqual(m.builderBottom + 2);
  expect(m.formTop).toBeGreaterThanOrEqual(m.builderTop - 2);
});
