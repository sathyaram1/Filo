// Verifica #2052.1, giro 1: chi scrive in un campo che si chiude all'uscita (modifica in linea) non lo perde.
import { test, expect } from '../../fixtures/electron.mjs';

function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

const PAGINA = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:16px sans-serif">
<h2 id="titolo" style="min-width:300px;border:1px dashed #999">Titolo della scheda</h2>
<div id="posto"></div><p id="uscite">0</p>
<script>
  const h = document.getElementById('titolo');
  h.addEventListener('click', () => {
    const e = document.createElement('div'); e.id = 'ed'; e.contentEditable = 'true'; e.style.cssText = 'width:300px;min-height:30px;border:1px solid #999';
    e.addEventListener('blur', () => { h.textContent = e.innerText; e.replaceWith(h); });
    h.replaceWith(e); e.focus();
  });
  setTimeout(() => { const t = document.createElement('textarea'); t.name = 'nota'; t.id = 'nota';
    t.style.cssText = 'width:300px;height:60px'; t.addEventListener('blur', () => { const u = document.getElementById('uscite'); u.textContent = +u.textContent + 1; });
    document.getElementById('posto').appendChild(t); }, 2500);
</script></body>`;

test('modifica in linea che si chiude all\'uscita: si continua a scrivere lì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#nota').click({ timeout: 8000 });
  await page.keyboard.type('testo che torna');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#titolo').click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => page.locator('#nota').inputValue().catch(() => ''), { timeout: 10000 }).toBe('testo che torna');
  await page.keyboard.type('secondo pezzo');
  await expect.poll(() => page.locator('#ed').innerText().catch(() => 'editore chiuso')).toBe('Primo pezzo secondo pezzo');
  expect(await page.locator('#uscite').innerText()).toBe('0');
});
