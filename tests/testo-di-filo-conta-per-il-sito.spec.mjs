// #2052 — il testo che Filo mette nella casella di un sito (Incolla e dettatura, il testo dei campi rimesso alla
// ricarica) deve contare per il sito come scritto dall'utente: su Reddit il commento incollato risultava vuoto all'invio.
// Il componente qui sotto tiene il testo come i campi di Reddit: fuori dalla casella, dall'ombra, solo dagli `input` del
// browser.
import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><html><head><title>Commenti</title></head>
<body style="margin:0;padding:32px;font-family:sans-serif;background:#fff">
  <commento-finto></commento-finto>
  <button id="invia" style="margin-top:12px">Comment</button>
  <p id="esito"></p>
  <script>
    customElements.define('commento-finto', class extends HTMLElement {
      constructor() {
        super();
        this.valore = '';
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<textarea name="commento" style="width:520px;height:140px;font-size:15px"></textarea>';
        this.addEventListener('input', (e) => { if (e.isTrusted) this.valore = r.querySelector('textarea').value; });
      }
    });
    document.getElementById('invia').addEventListener('click', () => {
      const v = document.querySelector('commento-finto').valore.trim();
      document.getElementById('esito').textContent = v ? 'Pubblicato: ' + v : 'Comment cannot be empty';
    });
  </script>
</body></html>`;

const casella = (page) => page.locator('commento-finto textarea');

test.describe.configure({ mode: 'parallel' });

test('un commento incollato col menu di Filo si pubblica: il sito lo conta come scritto', async ({ app, openTab, testServer }) => {
  const testo = 'Ok, ora è più chiaro cosa intendi. Fable orchestratore con Opus come subagenti.';
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), testo);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await casella(page).click({ button: 'right' });
  await menuDi(page).locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(casella(page)).toHaveValue(testo);
  await page.screenshot({ path: 'tests/.shots/testo-di-filo-incollato.png' });

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText(`Pubblicato: ${testo}`);
});

test('incollato in mezzo a quello che si è scritto, il sito ha il testo intero', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), 'non per coding');
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await casella(page).click();
  await page.keyboard.type('Fable è un modello  e basta.');
  await casella(page).evaluate((el) => el.setSelectionRange(19, 19));
  await casella(page).click({ button: 'right', position: { x: 5, y: 5 } });
  await casella(page).evaluate((el) => el.setSelectionRange(19, 19));
  await menuDi(page).locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(casella(page)).toHaveValue('Fable è un modello non per coding e basta.');

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Fable è un modello non per coding e basta.');
});

test('il commento rimesso alla ricarica si pubblica, e il fuoco non resta nella casella', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await casella(page).click();
  await page.keyboard.type('Sul motore ripeti la stessa cosa senza rispondere.');
  await page.waitForTimeout(1200);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => casella(page).inputValue(), { timeout: 8000 }).toBe('Sul motore ripeti la stessa cosa senza rispondere.');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Sul motore ripeti la stessa cosa senza rispondere.');
});
