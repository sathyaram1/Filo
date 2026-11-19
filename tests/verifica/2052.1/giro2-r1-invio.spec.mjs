// Verifica #2052.1, giro 2, rilievo 1: il testo rimesso mentre si scrive altrove deve contare per il sito anche quando
// l'invio parte dalla tastiera, senza che il fuoco passi da un pulsante.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Tardi</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif;background:#fff">
  <form id="f" onsubmit="return false"><input id="riga" style="display:block;width:600px;height:28px"></form>
  <div id="posto" style="margin-top:10px"></div>
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
    document.getElementById('f').addEventListener('submit', () => {
      const v = document.querySelector('commento-finto').valore.trim();
      document.getElementById('esito').textContent = v ? 'Pubblicato: ' + v : 'Comment cannot be empty';
    });
  </script>
</body></html>`;

const casella = (page) => page.locator('commento-finto textarea');

test('r1 Invio nella riga dove si scrive, dopo il ritorno del testo: il sito ha il testo della casella', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await casella(page).click({ timeout: 8000 });
  await page.keyboard.type('commento salvato');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');

  await page.locator('#riga').click();
  await page.keyboard.type('oggetto');
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.press('Enter');
  await expect(page.locator('#esito')).toHaveText('Pubblicato: commento salvato');
});
