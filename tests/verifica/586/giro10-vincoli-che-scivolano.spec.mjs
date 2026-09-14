// Verifica #586, giro 10 — le forme in cui una pagina può scrivere la richiesta
// vecchia della cattura schermo.
//
// La guardia che riporta la strada vecchia su quella nuova (ed è lei a far
// comparire la scelta di cosa si condivide, aggiunta dopo il giro 9) riconosce
// la richiesta cercando una parola precisa fra i vincoli. Qui si provano le altre
// forme con cui un sito dice la stessa cosa: se una scivola accanto alla
// guardia, da lì riparte lo schermo intero con un «Consenti» solo, cioè il
// rilievo del giro 9.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:12px">
<input id="campo" style="width:70%">
<script>
  window.__vivo = String(Date.now());
  const piatto = (s) => s.getTracks().map((t) => t.kind + ':' + (t.label || '?')
    + ':' + (t.getSettings ? (t.getSettings().width || 0) + 'x' + (t.getSettings().height || 0) : ''));
  window.__forme = {
    // Quella che il giro 9 conosceva, e che la correzione riporta sulla strada
    // moderna: il metro di paragone.
    desktop: { video: { mandatory: { chromeMediaSource: 'desktop' } } },
    // La stessa cosa detta con optional, con un mandatory qualsiasi accanto.
    optional: {
      video: { mandatory: { maxWidth: 1920 }, optional: [{ chromeMediaSource: 'desktop' }] },
    },
    // L'altro nome della stessa fonte, che Chromium tiene ancora buono.
    screen: { video: { mandatory: { chromeMediaSource: 'screen' } } },
    // E lo stesso con l'audio del computer chiesto insieme.
    screenConAudio: {
      audio: { mandatory: { chromeMediaSource: 'screen' } },
      video: { mandatory: { chromeMediaSource: 'screen' } },
    },
  };
  window.__prova = (nome) => navigator.mediaDevices.getUserMedia(window.__forme[nome]).then(
    (s) => { window.__ultimo = s; return piatto(s); },
    (e) => ['rifiutato:' + ((e && e.name) || '?')]);
</script></body></html>`;

// Quello che è arrivato è lo SCHERMO (non la webcam, non un rifiuto)?
function schermo(arrivato) {
  return Array.isArray(arrivato) && arrivato.some((s) => /:(Screen|Entire screen|Schermo)/i.test(String(s)));
}

test('ogni forma della richiesta vecchia dello schermo deve passare dalla scelta', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const esiti = {};

  for (const forma of ['desktop', 'optional', 'screen', 'screenConAudio']) {
    const p = page.evaluate((n) => window.__prova(n), forma);
    const domanda = await shell.locator('.perm-chip').first()
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    let testo = '';
    let scelta = false;
    if (domanda) {
      testo = ((await shell.locator('.perm-chip').first().textContent()) || '').replace(/\s+/g, ' ').trim();
      await shell.locator('.perm-chip .perm-chip-allow').first().click();
      scelta = await shell.locator('.perm-source').first()
        .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
      if (scelta) await shell.locator('.perm-source-item').first().click();
    }
    const arrivato = await p;
    esiti[forma] = { testo, scelta, arrivato };
    console.log('[586 g10]', forma, JSON.stringify(esiti[forma]));
    await page.evaluate(() => {
      try { (window.__ultimo || { getTracks: () => [] }).getTracks().forEach((t) => t.stop()); } catch (_) {}
    });
    await shell.waitForTimeout(2500);
  }

  const scivolate = Object.entries(esiti)
    .filter(([, v]) => schermo(v.arrivato) && !v.scelta).map(([k]) => k);

  expect(
    scivolate,
    'scritta in queste forme, la richiesta vecchia della cattura schermo consegna lo schermo intero '
    + 'senza far scegliere cosa si condivide né se dare anche l\'audio del computer, con un «Consenti» '
    + `solo: è il rilievo del giro 9 da un'altra porta (misurato: ${JSON.stringify(esiti)})`,
  ).toEqual([]);
});

test('la richiesta che ammazza la scheda non deve ammazzarla nemmeno con l\'altro nome della fonte', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#campo', 'quello che stavo leggendo').catch(() => {});
  const prima = await page.evaluate(() => window.__vivo);

  // L'audio del computer senza l'immagine: la forma che Chromium non rifiuta,
  // chiude il processo della pagina. Con la parola «desktop» Filo la ferma prima
  // (giro 4); con l'altro nome della stessa fonte la guardia non la riconosce.
  const esito = await page.evaluate(() => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'screen' } },
  }).then(() => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?')))
    .catch((e) => 'la scheda è morta: ' + e.message);
  let dopo = 'scheda morta';
  let campo = '';
  try {
    dopo = await page.evaluate(() => window.__vivo);
    campo = await page.inputValue('#campo');
  } catch (_) {}
  console.log('[586 g10] audio del computer con l\'altro nome:', JSON.stringify(esito),
    '— la pagina è ancora quella:', dopo === prima, 'campo:', JSON.stringify(campo));

  expect(
    dopo === prima,
    'chiesto l\'audio del computer senza l\'immagine dello schermo, con l\'altro nome della fonte, la '
    + 'scheda muore all\'istante: chi stava leggendo perde quello che aveva aperto lì, senza un '
    + 'avviso e senza aver toccato niente. Con la parola «desktop» la stessa richiesta torna un '
    + 'errore che il sito sa gestire (giro 4)',
  ).toBe(true);
});
