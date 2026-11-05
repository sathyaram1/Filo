// Verifica #1808.2 giro 1, rilievo 2: un editor in un riquadro che la pagina svuota mentre manda il testo con una richiesta,
// respinta dal sito, deve tenere aperta la scheda come un'area di testo nella pagina; arrivata, no.
import { test, expect } from '../../fixtures/electron.mjs';
import { LETTERA, apriEsatta, sporca, archiviaTutto, apriSito } from './sito.mjs';

test.describe.configure({ timeout: 180_000 });

const FORME = {
  'riquadro nato con srcdoc': ['<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style=\'min-height:100px\'></body>"></iframe>', ''],
  'riquadro riempito da uno script': ['<iframe id="ifr" style="width:420px;height:120px"></iframe>', "{ const d = ifr.contentDocument; d.open(); d.write(\"<body contenteditable=true style='min-height:100px'></body>\"); d.close(); }"],
};

test('r2 un editor in un riquadro svuotato all’invio e respinto dal sito tiene aperta la scheda; arrivato no', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const respinti = {};
    const arrivati = {};
    let k = 0;
    for (const [nome, [riq, prep]] of Object.entries(FORME)) for (const [api, dove] of [['/api/rifiuta', respinti], ['/api/ok', arrivati]]) {
      const titolo = `Ed${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>${riq}<button id="pub">Invia</button><p id="esito"></p>
        <script>${prep} pub.onclick = () => { const b = ifr.contentDocument.body; const t = b.innerHTML; b.innerHTML = '';
          fetch('${api}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) }).then((r) => { esito.textContent = r.ok ? 'Inviato' : 'Non inviato'; }); };</script>`));
      await page.waitForTimeout(400);
      await page.frameLocator('#ifr').locator('body').click();
      await page.keyboard.type(LETTERA);
      const id = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await expect(page.locator('#esito')).toHaveText(dove === arrivati ? 'Inviato' : 'Non inviato');
      await page.waitForTimeout(1000);
      dove[nome] = id;
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
  } finally { await sito.chiudi(); }
});
