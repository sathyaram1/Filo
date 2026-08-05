// Feedback #406: sui "componenti" web (shadow DOM) usati dai siti moderni il
// menu del tasto destro di Filo si apriva quasi vuoto — spariva OGNI voce che
// riguardava l'elemento davvero cliccato (link, immagine, testo selezionato),
// mentre sullo stesso identico elemento fuori dal componente le voci c'erano.
//
// Causa: il listener contextmenu vive su window, quindi per un evento nato dentro
// uno shadow root `e.target` viene ri-targettizzato all'host del componente e il
// vero elemento non è più raggiungibile; anche la selezione dentro lo shadow root
// non è esposta da window.getSelection(). Il fix legge composedPath()[0] come
// bersaglio reale e, per il testo, la selezione del root shadow.
//
// I test asseriscono il SUCCESSO: dentro lo shadow root il menu deve offrire le
// stesse azioni che offre in light DOM. Senza il fix quelle voci non compaiono →
// rosso.

import { test, expect } from './fixtures/electron.mjs';

// PNG 2×2 opaco (data URI): un'immagine che carica senza rete.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAlWQMEXtHc5AAAAABJRU5ErkJggg==';

// Pagina con un componente web (shadow root APERTO) che contiene link, immagine e
// un paragrafo selezionabile; gli stessi elementi esistono anche in light DOM come
// riferimento (baseline). Tutto same-origin/data URI: nessuna rete.
function pageHtml() {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Pagina di prova</h1>
    <p>In chiaro (light DOM):</p>
    <a id="light-link" href="https://example.com/pagina">link normale</a>
    <img id="light-img" src="${IMG}" width="40" height="40" alt="imm">
    <p id="light-text">Una frase in chiaro abbastanza lunga da poter essere selezionata.</p>

    <isolated-block></isolated-block>

    <script>
      class IsolatedBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML =
            '<p>Dentro il componente (shadow DOM):</p>' +
            '<a id="s-link" href="https://example.com/pagina">link nel blocco</a> ' +
            '<img id="s-img" src="${IMG}" width="40" height="40" alt="imm"> ' +
            '<p id="s-text">Una frase nel blocco abbastanza lunga da poter essere selezionata.</p>';
        }
      }
      customElements.define('isolated-block', IsolatedBlock);
    </script>
  </body></html>`;
}

async function openMenuOn(page, selector) {
  await page.locator(selector).click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toBeHidden();
}

test('link dentro uno shadow root: il menu offre le azioni sul link, come in light DOM', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml());

  // Baseline: sul link in chiaro le voci ci sono.
  let menu = await openMenuOn(page, '#light-link');
  await expect(menu.getByText('Apri in nuova tab', { exact: false }).first()).toBeVisible();
  await closeMenu(page);

  // Il fix: sul link IDENTICO dentro il componente, stesse voci.
  menu = await openMenuOn(page, '#s-link');
  await page.screenshot({ path: 'tests/.shots/context-menu-shadow-link.png' }).catch(() => {});
  for (const label of ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('immagine dentro uno shadow root: il menu offre le azioni sull\'immagine', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml());

  const menu = await openMenuOn(page, '#s-img');
  for (const label of ['Copia immagine', 'Salva immagine come', 'Copia URL immagine', 'Cerca immagine']) {
    await expect(menu.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

test('testo selezionato dentro uno shadow root: il menu offre Copia/Cerca e la risposta inline', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml());

  // Seleziona il testo DENTRO lo shadow root. In Chromium la selezione dentro un
  // componente vive nel root del componente (shadowRoot.getSelection), non in
  // window.getSelection().
  await page.evaluate(() => {
    const host = document.querySelector('isolated-block');
    const root = host.shadowRoot;
    const p = root.getElementById('s-text');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = (typeof root.getSelection === 'function') ? root.getSelection() : window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const menu = await openMenuOn(page, '#s-text');
  await page.screenshot({ path: 'tests/.shots/context-menu-shadow-text.png' }).catch(() => {});
  await expect(menu.getByText('Copia', { exact: true }).first()).toBeVisible();
  await expect(menu.getByText('Cerca', { exact: false }).first()).toBeVisible();
  // La spiegazione inline di Filo sul testo selezionato deve comparire.
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
});
