// VERIFICA TEMPORANEA (feedback #406) — black-box dal sintomo utente.
// "Su elementi dentro un blocco isolato (shadow root) il menu del tasto destro
// perde tutte le voci sull'elemento (link/immagine/selezione)."
// Questo file NON deve restare nel repo: è la traccia della run di verifica.

import { test, expect } from './fixtures/electron.mjs';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVQ4jWNgGAWjYBSMglEwCkbBKBgFo2AUAAAGgAABm0lQxwAAAABJRU5ErkJggg==';

const HTML = `<!doctype html><html><body style="padding:30px;font:16px sans-serif">
  <h1>Verifica 406</h1>

  <!-- LIGHT DOM (riferimento) -->
  <p><a id="light-link" href="https://example.com/light">link normale</a></p>
  <p><img id="light-img" src="${PNG}" width="64" height="64" alt="img normale"></p>
  <p id="light-text">Frase normale in chiaro abbastanza lunga da poter essere selezionata con il mouse.</p>

  <!-- SHADOW ROOT APERTO -->
  <div id="host-open"></div>
  <!-- SHADOW ROOT ANNIDATO -->
  <div id="host-nested"></div>
  <!-- SHADOW ROOT CHIUSO -->
  <div id="host-closed"></div>
  <!-- SLOT: contenuto light proiettato dentro lo shadow -->
  <div id="host-slot"><a id="slot-link" href="https://example.com/slotted" slot="s">link slottato</a></div>

  <script>
    const tpl = (pfx) => \`
      <p><a id="\${pfx}-link" href="https://example.com/\${pfx}">link dentro il blocco</a></p>
      <p><img id="\${pfx}-img" src="${PNG}" width="64" height="64" alt="img dentro il blocco"></p>
      <p id="\${pfx}-text">Frase dentro il blocco isolato abbastanza lunga da poter essere selezionata con il mouse.</p>
      <p><a id="\${pfx}-js" href="javascript:alert(1)">link javascript</a></p>
      <p><a id="\${pfx}-xss" href="https://example.com/&lt;script&gt;alert(1)&lt;/script&gt;">&lt;script&gt;alert(1)&lt;/script&gt;</a></p>
      <p><textarea id="\${pfx}-ta" rows="2" cols="30">testo modificabile</textarea></p>
    \`;

    const open = document.querySelector('#host-open').attachShadow({ mode: 'open' });
    open.innerHTML = tpl('sh');

    const outer = document.querySelector('#host-nested').attachShadow({ mode: 'open' });
    outer.innerHTML = '<div id="inner-host"></div>';
    const inner = outer.querySelector('#inner-host').attachShadow({ mode: 'open' });
    inner.innerHTML = tpl('deep');

    const closed = document.querySelector('#host-closed').attachShadow({ mode: 'closed' });
    closed.innerHTML = tpl('cl');
    window.__closedRoot = closed;

    const slotRoot = document.querySelector('#host-slot').attachShadow({ mode: 'open' });
    slotRoot.innerHTML = '<div><slot name="s"></slot></div>';
  </script>
</body></html>`;

const LINK_ITEMS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const IMG_ITEMS = ['Copia immagine', 'Salva immagine come…', 'Copia URL immagine', 'Cerca immagine'];

async function itemLabels(page) {
  return page.$$eval('.sn-menu .sn-menu-item', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter(Boolean));
}

async function menuText(page) {
  return (await page.locator('.sn-menu').textContent()) || '';
}

async function rightClickAndRead(page, sel) {
  await page.keyboard.press('Escape').catch(() => {});
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error('no box for ' + sel);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  return itemLabels(page);
}

test('link/immagine dentro un blocco isolato: il menu offre le voci giuste', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Riferimento light DOM
  const lightLink = await rightClickAndRead(page, '#light-link');
  for (const l of LINK_ITEMS) expect(lightLink, `light link: ${l}`).toContain(l);

  // Shadow root aperto — LINK
  const shLink = await rightClickAndRead(page, '#sh-link');
  for (const l of LINK_ITEMS) expect(shLink, `shadow link: ${l}`).toContain(l);

  // Shadow root aperto — IMMAGINE
  const shImg = await rightClickAndRead(page, '#sh-img');
  for (const l of IMG_ITEMS) expect(shImg, `shadow img: ${l}`).toContain(l);

  // Shadow annidato (shadow dentro shadow)
  const deepLink = await rightClickAndRead(page, '#deep-link');
  for (const l of LINK_ITEMS) expect(deepLink, `nested link: ${l}`).toContain(l);
  const deepImg = await rightClickAndRead(page, '#deep-img');
  for (const l of IMG_ITEMS) expect(deepImg, `nested img: ${l}`).toContain(l);

  // Contenuto light proiettato in uno slot
  const slotLink = await rightClickAndRead(page, '#slot-link');
  for (const l of LINK_ITEMS) expect(slotLink, `slotted link: ${l}`).toContain(l);

  await page.screenshot({ path: 'tests/.shots/v406-menu-shadow-link.png' }).catch(() => {});
});

test('selezione dentro un blocco isolato: Copia/Cerca/Leggi e risposta inline', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Selezione reale con il mouse dentro lo shadow root
  const box = await page.locator('#sh-text').boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const labels = await itemLabels(page);
  for (const l of ['Copia', 'Cerca', 'Leggi']) expect(labels, `shadow sel: ${l}`).toContain(l);
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();

  await page.screenshot({ path: 'tests/.shots/v406-menu-shadow-sel.png' }).catch(() => {});
});

test('stress: url speciali, xss, click ripetuti, campo di testo, root chiuso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  // link javascript: dentro lo shadow — il menu si apre e NON esegue nulla
  const js = await rightClickAndRead(page, '#sh-js');
  expect(js.length).toBeGreaterThan(3);

  // testo del link con markup: nessuna esecuzione, nessun tag iniettato nel menu
  const xss = await rightClickAndRead(page, '#sh-xss');
  expect(xss.length).toBeGreaterThan(3);
  const menuHtml = await page.locator('.sn-menu').innerHTML();
  expect(menuHtml).not.toContain('<script');
  expect(dialogs).toEqual([]);

  // doppio tasto destro rapido sullo stesso elemento: un solo menu, voci giuste
  const b = await page.locator('#sh-img').boundingBox();
  await page.mouse.click(b.x + 5, b.y + 5, { button: 'right' });
  await page.mouse.click(b.x + 8, b.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu')).toHaveCount(1);
  const twice = await itemLabels(page);
  for (const l of IMG_ITEMS) expect(twice, `dbl-click img: ${l}`).toContain(l);

  // campo di testo dentro lo shadow: il menu deve offrire Incolla
  const ta = await rightClickAndRead(page, '#sh-ta');
  expect(ta, 'textarea in shadow: Incolla').toContain('Incolla');

  // shadow root CHIUSO: il menu deve almeno aprirsi senza rompersi
  const cb = await page.evaluate(() => {
    const r = window.__closedRoot.querySelector('#cl-link').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(cb.x + cb.w / 2, cb.y + cb.h / 2, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const closedLabels = await itemLabels(page);
  console.log('[closed-root menu]', JSON.stringify(closedLabels));

  // niente errori JS in pagina
  await page.screenshot({ path: 'tests/.shots/v406-stress.png' }).catch(() => {});
});
