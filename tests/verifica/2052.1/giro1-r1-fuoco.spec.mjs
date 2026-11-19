// Verifica #2052.1, giro 1, rilievo 1: il testo rimesso in un campo comparso tardi non toglie il fuoco a chi scrive altrove.
import { test, expect } from '../../fixtures/electron.mjs';

function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

const TARDI = `setTimeout(() => { const t = document.createElement('textarea'); t.name = 'nota'; t.id = 'nota';
  t.style.cssText = 'width:300px;height:60px'; document.getElementById('posto').appendChild(t);
  t.addEventListener('blur', () => { const u = document.getElementById('uscite'); u.textContent = +u.textContent + 1; }); }, 2500);`;

const pagina = (editore, extra = '') => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:16px sans-serif">
${editore}
<div id="posto"></div><p id="uscite">0</p>${extra}
<script>${TARDI}</script></body>`;

async function preparaERicarica(app, openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.locator('#nota').click({ timeout: 8000 });
  await page.keyboard.type('testo che torna');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  return page;
}

const torna = (page) => expect.poll(() => page.locator('#nota').inputValue().catch(() => ''), { timeout: 10000 }).toBe('testo che torna');

test('r1 editor ricco dentro un riquadro della pagina: si continua a scrivere lì', async ({ app, openTab, testServer }) => {
  const page = await preparaERicarica(app, openTab, testServer, pagina('<iframe id="fr" srcdoc="<body contenteditable=true style=&quot;min-height:60px&quot;></body>" style="width:400px;height:100px"></iframe>'));
  const corpo = page.frameLocator('#fr').locator('body');
  await corpo.click();
  await page.keyboard.type('Primo pezzo ');
  await torna(page);
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => corpo.innerText()).toBe('Primo pezzo secondo pezzo');
});

test('r1 modifica in linea che si chiude all\'uscita: resta aperta e si continua a scrivere lì', async ({ app, openTab, testServer }) => {
  const extra = `<script>
    const h = document.getElementById('titolo');
    h.addEventListener('click', () => {
      const e = document.createElement('div'); e.id = 'ed'; e.contentEditable = 'true'; e.style.cssText = 'width:300px;min-height:30px;border:1px solid #999';
      e.addEventListener('blur', () => { h.textContent = e.innerText; e.replaceWith(h); });
      h.replaceWith(e); e.focus();
    });</script>`;
  const page = await preparaERicarica(app, openTab, testServer, pagina('<h2 id="titolo" style="min-width:300px;border:1px dashed #999">Titolo della scheda</h2>', extra));
  await page.locator('#titolo').click();
  await page.keyboard.type('Primo pezzo ');
  await torna(page);
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => page.locator('#ed').innerText().catch(() => 'modifica chiusa')).toBe('Primo pezzo secondo pezzo');
  // Il sito non vede un'uscita da una casella in cui l'utente non è mai entrato.
  expect(await page.locator('#uscite').innerText()).toBe('0');
});
