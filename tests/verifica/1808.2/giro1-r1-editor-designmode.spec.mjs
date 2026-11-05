// Verifica #1808.2 giro 1, rilievo 1: un editor acceso col designMode in un riquadro nato con srcdoc, mandato e respinto,
// deve tenere aperta la scheda come lo stesso editor in un riquadro riempito da uno script.
import { test, expect } from '../../fixtures/electron.mjs';
import { LETTERA, apriEsatta, sporca, archiviaTutto, apriSito, schede } from './sito.mjs';

test.describe.configure({ timeout: 180_000 });

const FORME = {
  'designMode acceso dal riquadro': ['<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body style=\'min-height:100px\'></body><script>document.designMode=\'on\'</script>"></iframe>', ''],
  'designMode acceso dalla pagina': ['<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body style=\'min-height:100px\'></body>"></iframe>', "ifr.addEventListener('load', () => { ifr.contentDocument.designMode = 'on'; });"],
};

async function scriviEManda(app, shell, sito, titolo, riq, prep, azione, attesa) {
  const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
    <form id="f" method="post" action="${azione}"><textarea name="corpo" id="nasc" style="display:none"></textarea>${riq}<button id="pub">Invia</button></form>
    <script>${prep} f.addEventListener('submit', () => { nasc.value = ifr.contentDocument.body.innerHTML; });</script>`));
  await page.waitForTimeout(500);
  await page.frameLocator('#ifr').locator('body').click();
  await page.keyboard.type(LETTERA);
  await expect(page.frameLocator('#ifr').locator('body')).toContainText(LETTERA);
  const id = await sporca(shell, titolo);
  await page.locator('#pub').click();
  await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).toBe(attesa);
  await page.waitForTimeout(800);
  return id;
}

test('r1 un editor designMode in un riquadro srcdoc, mandato e respinto, tiene aperta la scheda; mandato bene no', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const respinti = {};
    let k = 0;
    for (const [nome, [riq, prep]] of Object.entries(FORME)) respinti[nome] = await scriviEManda(app, shell, sito, `Dm${++k}`, riq, prep, '/err500', 'Errore');
    const [riq, prep] = FORME['designMode acceso dal riquadro'];
    const arrivato = await scriviEManda(app, shell, sito, `Dm${++k}`, riq, prep, '/ok', 'Fatto');
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
    expect.soft(aperte, 'arrivato').not.toContain(arrivato);
  } finally { await sito.chiudi(); }
});
