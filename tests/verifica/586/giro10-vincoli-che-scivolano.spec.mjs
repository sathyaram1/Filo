// Verifica #586, giro 10 — le forme in cui una pagina può scrivere la richiesta
// vecchia della cattura schermo.
//
// La guardia che riporta la strada vecchia su quella nuova (e che fa comparire
// la scelta di cosa si condivide) riconosce la richiesta guardando dove il sito
// scrive `chromeMediaSource`. Qui si provano le forme che un sito può usare per
// dire la stessa cosa, per vedere se qualcuna scivola accanto alla guardia: se
// scivola, da lì riparte lo schermo intero più l'audio del computer con un
// «Consenti» solo, cioè il rilievo del giro 9.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:12px">
<button id="go">prendi</button>
<script>
  const piatto = (s) => s.getTracks().map((t) => t.kind + ':' + (t.label || '?')
    + ':' + (t.getSettings ? (t.getSettings().width || 0) + 'x' + (t.getSettings().height || 0) : ''));
  window.__forme = {
    // Quella che il giro 9 conosceva: mandatory con dentro chromeMediaSource.
    mandatory: { video: { mandatory: { chromeMediaSource: 'desktop' } } },
    // La stessa cosa detta con optional, ma con un mandatory qualsiasi accanto.
    mandatorioPiuOptional: {
      video: { mandatory: { maxWidth: 1920 }, optional: [{ chromeMediaSource: 'desktop' }] },
    },
    // Il vecchio nome della stessa fonte.
    screen: { video: { mandatory: { chromeMediaSource: 'screen' } } },
  };
  window.__prova = (nome) => navigator.mediaDevices.getUserMedia(window.__forme[nome]).then(
    (s) => { window.__ultimo = s; return piatto(s); },
    (e) => ['rifiutato:' + ((e && e.name) || '?')]);
  window.__click = (nome) => new Promise((ok) => {
    const b = document.getElementById('go');
    const h = () => { b.removeEventListener('click', h); window.__prova(nome).then(ok); };
    b.addEventListener('click', h);
    window.__pronto = nome;
  });
</script></body></html>`;

test('ogni forma della richiesta vecchia dello schermo deve passare dalla scelta', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const esiti = {};

  for (const forma of ['mandatory', 'mandatorioPiuOptional', 'screen']) {
    const p = page.evaluate((n) => window.__click(n), forma);
    await page.waitForFunction((n) => window.__pronto === n, forma).catch(() => {});
    // Un clic VERO: la strada moderna della cattura schermo pretende un gesto.
    await page.click('#go');
    const domanda = await shell.locator('.perm-chip').first()
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    let testo = '';
    let scelta = false;
    if (domanda) {
      testo = ((await shell.locator('.perm-chip').first().textContent()) || '').replace(/\s+/g, ' ').trim();
      await shell.locator('.perm-chip .perm-chip-allow').first().click();
      scelta = await shell.locator('.perm-source').first()
        .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
      if (scelta) {
        await shell.locator('.perm-source-item').first().click();
      }
    }
    const arrivato = await p;
    esiti[forma] = { domanda, testo, scelta, arrivato };
    console.log('[586 g10]', forma, JSON.stringify(esiti[forma]));
    await page.evaluate(() => {
      try { (window.__ultimo || { getTracks: () => [] }).getTracks().forEach((t) => t.stop()); } catch (_) {}
    });
    await shell.waitForTimeout(2500);
  }

  // Una forma è un problema solo se lo schermo arriva DAVVERO senza la scelta.
  const scivolate = Object.entries(esiti).filter(([, v]) => {
    const preso = Array.isArray(v.arrivato) && v.arrivato.some((s) => !String(s).startsWith('rifiutato'));
    return preso && !v.scelta;
  }).map(([k]) => k);

  expect(
    scivolate,
    'scritta in queste forme, la richiesta vecchia della cattura schermo consegna lo schermo senza '
    + 'far scegliere cosa si condivide né se dare anche l\'audio del computer: è il rilievo del giro 9 '
    + `da un\'altra porta (misurato: ${JSON.stringify(esiti)})`,
  ).toEqual([]);
});
