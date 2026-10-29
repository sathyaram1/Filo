// Esplorazione: quanto conta la misura dei buchi del main, con l'esame a fette e con l'esame tutto in un colpo.
import { test } from '../../fixtures/electron.mjs';

for (const modo of ['fette', 'sincrono']) {
  test(`buchi del main contati: ${modo}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const N = 5000;
    const html = '<title>Risultati</title><div id="lista"></div>'
      + `<script>(function () { var h = '';`
      + ` for (var i = 0; i < ${N}; i++) h += '<a href="https://risultato-' + i + '.esempio-' + (i % 997) + '.com/pagina/' + i + '">risultato ' + i + '</a>';`
      + ` document.getElementById('lista').innerHTML = h; })();</script>`;
    await app.evaluate(({ BrowserWindow }, m) => {
      const SB = globalThis.SN_SAFEBROWSE;
      if (m === 'sincrono') {
        SB.checkLinks = async (urls) => { const r = SB.links.esaminaLotto(urls, { checkSync: SB.checkSync }); return { esaminati: r.fatti, segnalati: r.segnalati }; };
      }
      globalThis.__buco = { max: 0, maxTutti: 0, contati: 0, attivo: true };
      const inEsame = () => BrowserWindow.getAllWindows()
        .some((w) => ((w._filoTabs && w._filoTabs.tabs) || []).some((t) => (t._sbLinkInCoda || 0) > 0));
      let prima = performance.now();
      let eraInEsame = inEsame();
      const giro = () => {
        const ora = performance.now();
        const adesso = inEsame();
        if (eraInEsame || adesso) { globalThis.__buco.max = Math.max(globalThis.__buco.max, ora - prima); globalThis.__buco.contati++; }
        prima = ora;
        eraInEsame = adesso;
        if (globalThis.__buco.attivo) setTimeout(giro, 1);
      };
      setTimeout(giro, 1);
    }, modo);
    const pagina = await testServer.openReady(openTab, html);
    await pagina.waitForTimeout(8000);
    const r = await app.evaluate(() => { globalThis.__buco.attivo = false; return globalThis.__buco; });
    console.log(`ESPLORA ${modo}: ${JSON.stringify(r)}`);
  });
}
