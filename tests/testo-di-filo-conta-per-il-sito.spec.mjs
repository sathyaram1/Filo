// #2052 — il testo che Filo mette nella casella di un sito (Incolla e dettatura, il testo dei campi rimesso alla
// ricarica) deve contare per il sito come scritto dall'utente: su Reddit il commento incollato risultava vuoto all'invio.
// Il componente qui sotto tiene il testo come i campi di Reddit: fuori dalla casella, dall'ombra, solo dagli `input` del
// browser.
import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { nelMondoDiFilo, statoDi, clicca } from './helpers/riquadri.mjs';

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
  await menuDi(page).incolla.click();
  await expect(casella(page)).toHaveValue(testo);
  await page.screenshot({ path: 'tests/.shots/testo-di-filo-incollato.png' });

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText(`Pubblicato: ${testo}`);
});

test('incollato dopo quello che si è scritto, il sito ha il testo intero', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), 'non per coding.');
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await casella(page).click();
  await page.keyboard.type('Fable è un modello per automazione, ');
  await casella(page).click({ button: 'right', position: { x: 500, y: 130 } });
  await menuDi(page).incolla.click();
  await expect(casella(page)).toHaveValue('Fable è un modello per automazione, non per coding.');

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Fable è un modello per automazione, non per coding.');
});

test('un testo di migliaia di righe si incolla subito e il sito lo ha intero', async ({ app, openTab, testServer }) => {
  const testo = Array.from({ length: 3000 }, (_, i) => `riga ${i + 1} <b>non è markup</b> 😀`).join('\n');
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), testo);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await casella(page).click({ button: 'right' });
  const partito = Date.now();
  await menuDi(page).incolla.click();
  await expect.poll(() => casella(page).inputValue(), { timeout: 5000 }).toBe(testo);
  expect(Date.now() - partito, 'l\'incolla lungo non ferma la pagina').toBeLessThan(5000);

  await page.locator('#invia').click();
  expect(await page.locator('#esito').textContent()).toBe(`Pubblicato: ${testo}`);
});

test('un commento dettato a Filo si pubblica', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await casella(page).click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await nelMondoDiFilo(app, page, () => globalThis.SN_ACTIONS.insertDictatedText('Detto a voce, senza tastiera.'));
  await expect(casella(page)).toHaveValue('Detto a voce, senza tastiera.');

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Detto a voce, senza tastiera.');
});

test('un commento riscritto con Modifica si pubblica', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, complete: async () => ({ text: 'Commento riscritto da Filo.', usage: {} }) };
  });
  const page = await testServer.openReady(openTab, PAGINA);
  await casella(page).click();
  await page.keyboard.type('un comento con erori');
  await casella(page).evaluate((el) => el.select());
  await casella(page).click({ button: 'right' });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('riscritto');
  await clicca(app, page, '.sn-editbox-replace');
  await expect(casella(page)).toHaveValue('Commento riscritto da Filo.');

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Commento riscritto da Filo.');
});

test('un commento scritto da Filo per l\'utente (Aiuto che compila) si pubblica', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const ok = await nelMondoDiFilo(app, page, () => globalThis.SN_HIGHLIGHT.fillElement(
    document.querySelector('commento-finto').shadowRoot.querySelector('textarea'), 'Scritto da Filo su richiesta.'));
  expect(ok).toBe(true);
  await expect(casella(page)).toHaveValue('Scritto da Filo su richiesta.');

  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText('Pubblicato: Scritto da Filo su richiesta.');
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

// #2052.1 — la casella arriva tre secondi dopo la pagina, in fondo, come in un sito fatto di script; un editor ricco e
// una riga ci sono subito, in cima. Chi scrive lì mentre il testo torna non deve accorgersene.
const PAGINA_TARDI = `<!doctype html><html><head><title>Tardi</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif;background:#fff">
  <div id="ce" contenteditable="true" style="width:600px;min-height:80px;border:1px solid #999"></div>
  <input id="riga" style="display:block;margin-top:10px;width:600px;height:28px">
  <div id="posto" style="margin-top:1800px"></div>
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
    document.getElementById('invia').addEventListener('click', () => {
      const v = document.querySelector('commento-finto').valore.trim();
      document.getElementById('esito').textContent = v ? 'Pubblicato: ' + v : 'Comment cannot be empty';
    });
  </script>
</body></html>`;

async function ricaricaColTesto(page, testo) {
  await casella(page).click({ timeout: 8000 });
  await page.keyboard.type(testo);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  expect(await casella(page).count(), 'la casella non è ancora arrivata').toBe(0);
}

async function pubblicato(page, testo) {
  await page.locator('#invia').click();
  await expect(page.locator('#esito')).toHaveText(`Pubblicato: ${testo}`);
}

test('mentre scrivi in un editor ricco, il testo che torna nella casella arrivata tardi non sposta il cursore né la pagina', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_TARDI);
  await ricaricaColTesto(page, 'commento salvato');

  await page.locator('#ce').click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.type('secondo pezzo');
  await expect(page.locator('#ce')).toHaveText('Primo pezzo secondo pezzo');
  expect(await page.evaluate(() => window.scrollY), 'la pagina resta dove si scrive').toBe(0);
  await page.screenshot({ path: 'tests/.shots/testo-tornato-editor-ricco.png' });
  await pubblicato(page, 'commento salvato');
});

test('mentre scrivi in un\'altra riga, il cursore e la selezione restano dove li avevi messi', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_TARDI);
  await ricaricaColTesto(page, 'commento salvato');

  await page.locator('#riga').click();
  await page.keyboard.type('abcdef');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.type('X');
  await expect(page.locator('#riga')).toHaveValue('abcXf');
  await pubblicato(page, 'commento salvato');
});

test('mentre componi una parola con la tastiera di un\'altra lingua, il testo torna senza chiuderla', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA_TARDI);
  await ricaricaColTesto(page, 'commento salvato');

  const cdp = await page.context().newCDPSession(page);
  await page.locator('#ce').click();
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await cdp.send('Input.insertText', { text: '日本' });
  await page.keyboard.type(' fine');
  await expect(page.locator('#ce')).toHaveText('日本 fine');
  await pubblicato(page, 'commento salvato');
});

// Chi scrive altrove non perde il fuoco nemmeno dove restituirlo non basta: un editor dentro un riquadro (i classici
// editor di posta) e una modifica in linea che si chiude quando se ne esce. La casella non vede uscite non sue.
const paginaTardiCon = (editore, script = '') => PAGINA_TARDI
  .replace(/<div id="ce"[^>]*><\/div>/, editore)
  .replace("this.addEventListener('input'", "r.querySelector('textarea').addEventListener('blur', () => { window.uscite = (window.uscite || 0) + 1; });\n        this.addEventListener('input'")
  .replace('</script>', `${script}</script>`);

test('mentre scrivi in un editor dentro un riquadro, il testo che torna non ti toglie il fuoco', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, paginaTardiCon('<iframe id="fr" srcdoc="<body contenteditable=true style=&quot;min-height:60px&quot;></body>" style="width:600px;height:100px"></iframe>'));
  await ricaricaColTesto(page, 'commento salvato');

  const corpo = page.frameLocator('#fr').locator('body');
  await corpo.click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.type('secondo pezzo');
  await expect(corpo).toHaveText('Primo pezzo secondo pezzo');
  expect(await page.evaluate(() => window.uscite || 0)).toBe(0);
  await pubblicato(page, 'commento salvato');
});

test('mentre scrivi in una modifica in linea che si chiude all\'uscita, resta aperta e il testo torna lo stesso', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const script = `
    const h = document.getElementById('titolo');
    h.addEventListener('click', () => {
      const e = document.createElement('div'); e.id = 'ed'; e.contentEditable = 'true'; e.style.cssText = 'width:600px;min-height:30px;border:1px solid #999';
      e.addEventListener('blur', () => { h.textContent = e.innerText; e.replaceWith(h); });
      h.replaceWith(e); e.focus();
    });`;
  const page = await testServer.openReady(openTab, paginaTardiCon('<h2 id="titolo" style="width:600px;border:1px dashed #999">Titolo</h2>', script));
  await ricaricaColTesto(page, 'commento salvato');

  await page.locator('#titolo').click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.type('secondo pezzo');
  await expect(page.locator('#ed')).toHaveText('Primo pezzo secondo pezzo');
  expect(await page.evaluate(() => window.uscite || 0)).toBe(0);
  await pubblicato(page, 'commento salvato');
  await expect(page.locator('#titolo')).toHaveText('Primo pezzo secondo pezzo');
});
