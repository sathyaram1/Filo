// Verifica #586, giro 7 — il riquadro in sandbox, che per il browser non è
// nessuno.
//
// Il giro 6 aveva trovato che un riquadro scritto dalla pagina (`about:blank`,
// `srcdoc`) veniva negato in silenzio, e la correzione gli ha dato l'origine
// della pagina che lo ospita: giusto, perché per il browser è lo stesso sito.
//
// Qui si guarda la porta accanto. Un riquadro in SANDBOX non ha nessuna
// origine: né la sua né quella di chi lo ospita. È la forma con cui si
// incastonano le cose di cui non ci si fida — una pubblicità, un widget di
// terze parti, un pezzo di HTML arrivato da fuori. La domanda è cosa succede
// quando quel riquadro chiede la fotocamera dopo che alla PAGINA la fotocamera
// è già stata consentita: se eredita il sì della pagina, un pezzo di sito di
// cui nessuno si fida si accende la webcam senza che compaia niente.

import { test, expect } from '../../fixtures/electron.mjs';

const CHIEDI = `
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.q !== 'cam') return;
    navigator.mediaDevices.getUserMedia({ video: true }).then(
      (s) => {
        const n = s.getTracks().length;
        try { s.getTracks().forEach((t) => t.stop()); } catch (_) {}
        parent.postMessage({ r: 'ok:' + n }, '*');
      },
      (err) => parent.postMessage({ r: 'no:' + ((err && err.name) || '?') }, '*'));
  });
`;

function pagina(urlTerzo) {
  return `<!doctype html><html><body style="margin:0;padding:16px">
<iframe id="sandbox" sandbox="allow-scripts" allow="camera; microphone"
        srcdoc="&lt;body&gt;&lt;script&gt;${CHIEDI.replace(/</g, '&lt;')}&lt;/script&gt;&lt;/body&gt;"
        style="width:280px;height:100px"></iframe>
<iframe id="terzo" sandbox="allow-scripts" allow="camera; microphone"
        src="${urlTerzo}" style="width:280px;height:100px"></iframe>
<script>
  window.__risposta = null;
  window.addEventListener('message', (e) => { if (e.data && e.data.r) window.__risposta = e.data.r; });
  window.__chiedi = (quale) => {
    window.__risposta = null;
    document.getElementById(quale).contentWindow.postMessage({ q: 'cam' }, '*');
    return new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (window.__risposta) { clearInterval(iv); res(window.__risposta); }
        else if (Date.now() - t0 > 8000) { clearInterval(iv); res('appeso'); }
      }, 100);
    });
  };
  window.__chiediPagina = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
    (e) => 'no:' + ((e && e.name) || '?'));
</script></body></html>`;
}

test('un riquadro in sandbox non deve ereditare il sì dato alla pagina che lo ospita', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);

  // Il riquadro di terze parti sta su un altro indirizzo (stesso mini server,
  // altro nome): per il browser è un altro sito.
  const urlTerzo = testServer.html(`<!doctype html><body>widget<script>${CHIEDI}</script></body>`)
    .replace('http://127.0.0.1:', 'http://localhost:');

  const page = await testServer.openReady(openTab, pagina(urlTerzo));
  await page.waitForTimeout(1200);

  // 1) Alla PAGINA la fotocamera viene consentita, con la domanda, come deve.
  const dellaPagina = page.evaluate(() => window.__chiediPagina());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  console.log('[586 g7] la pagina dopo il Consenti:', await dellaPagina);

  // 2) Il riquadro in sandbox scritto dalla pagina stessa.
  const sandbox = page.evaluate(() => window.__chiedi('sandbox'));
  await shell.waitForTimeout(2500);
  const domandeSandbox = await shell.locator('.perm-chip').count();
  const esitoSandbox = await sandbox;
  console.log('[586 g7] riquadro in sandbox — domande:', domandeSandbox, 'esito:', esitoSandbox);
  if (domandeSandbox) await shell.locator('.perm-chip .perm-chip-x').first().click();
  await shell.waitForTimeout(400);

  // 3) Il riquadro in sandbox che porta dentro un ALTRO sito.
  const terzo = page.evaluate(() => window.__chiedi('terzo'));
  await shell.waitForTimeout(2500);
  const domandeTerzo = await shell.locator('.perm-chip').count();
  const testoTerzo = domandeTerzo ? await shell.locator('.perm-chip .perm-chip-text').first().innerText() : '';
  const esitoTerzo = await terzo;
  console.log('[586 g7] riquadro in sandbox di un altro sito — domande:', domandeTerzo,
    'testo:', JSON.stringify(testoTerzo), 'esito:', esitoTerzo);
  await shell.screenshot({ path: 'tests/.shots/586-giro7-riquadro-in-sandbox.png' });

  expect(
    esitoSandbox.startsWith('ok'),
    'un riquadro in sandbox — la forma con cui si incastona quello di cui non ci si fida: una '
    + 'pubblicità, un widget di terze parti, un pezzo di HTML arrivato da fuori — si accende la '
    + 'fotocamera senza che compaia nessuna domanda, riusando il sì dato alla pagina che lo ospita',
  ).toBe(false);

  expect(
    esitoTerzo.startsWith('ok'),
    'un riquadro in sandbox che porta dentro un ALTRO sito si accende la fotocamera senza che '
    + 'compaia nessuna domanda, riusando il sì dato al sito che lo ospita',
  ).toBe(false);
});
