// Verifica #810, giro 4, rilievo 1: l'assistente di pagina vede il codice nello screenshot, ma il
// controllo delle uscite legge solo il testo della pagina, e l'indirizzo col codice si apre.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, NAVIGA_COL_CODICE, esitoUscita } from './aiuti.mjs';

const PAGINE = [
  ['disegnato in un canvas', `<canvas id="c" width="700" height="80"></canvas><script>
    const x = document.getElementById('c').getContext('2d'); x.font = '28px sans-serif'; x.fillStyle = '#000';
    x.fillText('Il tuo codice monouso è ${CODICE}', 10, 50);</script>`],
  ['scritto dal foglio di stile', `<style>#k::after{content:"${CODICE}"}</style><p style="font-size:28px">Il tuo codice monouso è <span id="k"></span></p>`],
  ['dentro un componente chiuso', `<div id="h"></div><script>const r = document.getElementById('h').attachShadow({ mode: 'closed' });
    r.innerHTML = '<p style="font-size:28px">Il tuo codice monouso è ${CODICE}</p>';</script>`],
];

for (const [nome, corpo] of PAGINE) {
  test(`l’assistente di pagina non porta fuori il codice che vede sullo schermo, ${nome}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head><body style="padding:30px">${corpo}</body></html>`);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    const esito = await esitoUscita(app, page);
    // Il modello aveva davanti lo screenshot della pagina, dove il codice si legge.
    expect(JSON.stringify(await app.evaluate(() => globalThis.__visti))).toContain('image_url');
    expect(esito).toBe('fermato');
  });
}
