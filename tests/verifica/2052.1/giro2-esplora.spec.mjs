// Verifica #2052.1, giro 2: esplorazione delle porte intorno al testo rimesso nella casella arrivata tardi.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (sopra = '', script = '', posto = 'margin-top:1800px') => `<!doctype html><html><head><title>Tardi</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif;background:#fff">
  <div id="ce" contenteditable="true" style="width:600px;min-height:80px;border:1px solid #999"></div>
  <form id="f" onsubmit="return false"><input id="riga" style="display:block;margin-top:10px;width:600px;height:28px"></form>
  <button id="altro">Altro</button>
  ${sopra}
  <div id="posto" style="${posto}"></div>
  <button id="invia">Comment</button>
  <p id="esito"></p>
  <script>
    customElements.define('commento-finto', class extends HTMLElement {
      constructor() {
        super();
        this.valore = '';
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<textarea name="commento" style="width:520px;height:140px"></textarea>';
        this.addEventListener('input', (e) => { if (e.isTrusted) this.valore = r.querySelector('textarea').value; });
      }
    });
    setTimeout(() => { document.getElementById('posto').innerHTML = '<commento-finto></commento-finto>'; }, 3000);
    const esito = () => { const v = document.querySelector('commento-finto').valore.trim();
      document.getElementById('esito').textContent = v ? 'Pubblicato: ' + v : 'Comment cannot be empty'; };
    document.getElementById('invia').addEventListener('click', esito);
    document.getElementById('f').addEventListener('submit', esito);
    ${script}
  </script>
</body></html>`;

const casella = (page) => page.locator('commento-finto textarea');

async function ricaricaColTesto(page, testo) {
  await casella(page).click({ timeout: 8000 });
  await page.keyboard.type(testo);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate(() => window.scrollTo(0, 0));
}
const torna = (page) => expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');

test('A dopo aver scritto altrove, un clic su un pulsante in cima non sposta la pagina e il sito conta il testo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA());
  await ricaricaColTesto(page, 'commento salvato');
  await page.locator('#ce').click();
  await page.keyboard.type('Primo pezzo ');
  await torna(page);
  await page.locator('#altro').click();
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  const valore = await page.evaluate(() => document.querySelector('commento-finto').valore);
  console.log('A scrollY', y, 'valore', JSON.stringify(valore));
  expect(y).toBe(0);
  expect(valore).toBe('commento salvato');
});

test('B chi legge senza scrivere: il testo torna e la pagina non salta', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA());
  await ricaricaColTesto(page, 'commento salvato');
  await torna(page);
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  console.log('B scrollY', y);
  expect(y).toBe(0);
});

test('C Invio nella riga dopo il ritorno: il sito ha il testo della casella', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA());
  await ricaricaColTesto(page, 'commento salvato');
  await page.locator('#riga').click();
  await page.keyboard.type('oggetto');
  await torna(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#esito')).toHaveText('Pubblicato: commento salvato');
});

test('D clic all\'inizio del testo tornato: si scrive lì', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA('', '', 'margin-top:10px'));
  await ricaricaColTesto(page, 'commento salvato');
  await page.locator('#ce').click();
  await page.keyboard.type('Primo ');
  await torna(page);
  await casella(page).click({ position: { x: 3, y: 8 } });
  await page.keyboard.type('X');
  expect(await casella(page).inputValue()).toBe('Xcommento salvato');
  expect(await page.evaluate(() => document.querySelector('commento-finto').valore)).toBe('Xcommento salvato');
});

test('E un menu aperto col fuoco su una voce resta aperto quando il testo torna', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const menu = '<button id="apri">Menu</button><div id="menu" hidden><button class="voce">Uno</button><button class="voce">Due</button></div>';
  const script = `
    const m = document.getElementById('menu');
    document.getElementById('apri').addEventListener('click', () => { m.hidden = false; m.querySelector('.voce').focus(); });
    m.addEventListener('focusout', (e) => { if (!m.contains(e.relatedTarget)) m.hidden = true; });`;
  const page = await testServer.openReady(openTab, PAGINA(menu, script, 'margin-top:10px'));
  await ricaricaColTesto(page, 'commento salvato');
  await page.locator('#apri').click();
  await expect(page.locator('#menu')).toBeVisible();
  await torna(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#menu')).toBeVisible();
});

test('F due caselle tardi mentre si scrive: un clic su Invia le conta tutte e due', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const script = `setTimeout(() => { const t = document.createElement('textarea'); t.name = 'seconda'; t.id = 'seconda'; t.style.cssText = 'width:300px;height:40px';
    t.addEventListener('input', (e) => { if (e.isTrusted) window.seconda = t.value; }); document.getElementById('posto').after(t); }, 3000);`;
  const page = await testServer.openReady(openTab, PAGINA('', script, 'margin-top:10px'));
  await page.locator('#seconda').click({ timeout: 8000 });
  await page.keyboard.type('seconda salvata');
  await ricaricaColTesto(page, 'commento salvato');
  await page.locator('#ce').click();
  await page.keyboard.type('Primo ');
  await torna(page);
  await expect(page.locator('#seconda')).toHaveValue('seconda salvata');
  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: commento salvato');
  expect(await page.evaluate(() => window.seconda)).toBe('seconda salvata');
  await expect(page.locator('#ce')).toHaveText('Primo ');
});
