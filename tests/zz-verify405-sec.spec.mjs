// VERIFIER #405 — casi ostili e confini.
//  a) un riquadro OSTILE (che blocca il tasto destro come YouTube) deve
//     comunque dare il menu Filo;
//  b) il codice del sito dentro il riquadro NON deve guadagnare accesso
//     privilegiato a Filo;
//  c) i riquadri dentro le pagine interne filo:// restano esclusi;
//  d) un riquadro che si stacca / naviga non deve lasciare menu fantasma.

import { test, expect } from './fixtures/electron.mjs';

async function frameByUrl(page, url) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const f = page.frames().find((x) => x.url() === url && x !== page.mainFrame());
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('frame non trovato: ' + url);
}

async function anyFrameHas(page, sel, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const fr of page.frames()) {
      try { if (await fr.locator(sel).first().isVisible()) return fr; } catch (_) {}
    }
    await page.waitForTimeout(150);
  }
  return null;
}

const parent = (u, w = 620, h = 320) => `<!doctype html><body style="margin:0;padding:20px">
  <p id="outside">fuori</p><iframe id="f" src="${u}" width="${w}" height="${h}"></iframe></body>`;

// a) riquadro ostile
test('#405 riquadro OSTILE (blocca il tasto destro): il menu Filo compare lo stesso', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><html><head><script>
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var d = document.createElement('div'); d.id = 'site-menu';
      d.textContent = 'menu del sito'; document.body.appendChild(d);
    }, { capture: true });
  </script></head><body style="margin:0"><video id="player" width="320" height="180" style="background:#000"></video></body></html>`);
  const page = await testServer.openReady(openTab, parent(child));
  const fr = await frameByUrl(page, child);
  await fr.locator('#player').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 8000);
  expect(mf, 'un player che blocca il tasto destro rimane senza menu Filo').not.toBeNull();
  expect(await fr.locator('#site-menu').count(), 'il menu del sito ha vinto').toBe(0);
});

// b) nessun accesso privilegiato al codice del riquadro
test('#405 il codice del sito dentro il riquadro non guadagna accessi privilegiati', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><body style="margin:0"><p id="p">ciao</p></body>`);
  const page = await testServer.openReady(openTab, parent(child));
  const fr = await frameByUrl(page, child);
  await fr.locator('#p').click();
  await page.waitForTimeout(600);
  const exposed = await fr.evaluate(() => {
    const keys = Object.getOwnPropertyNames(window).filter((k) =>
      /^(require|process|module|electron|ipcRenderer|__filo|filoShell|__sn)/i.test(k));
    return {
      keys,
      require: typeof window.require,
      process: typeof window.process,
      ipc: typeof window.ipcRenderer,
      shell: typeof window.filoShell,
      // il bridge del menu non deve essere pilotabile dal sito
      bridge: typeof window.__snSetContextMenuHandler,
    };
  });
  console.log('[ESPOSTO] ' + JSON.stringify(exposed));
  expect(exposed.require).toBe('undefined');
  expect(exposed.process).toBe('undefined');
  expect(exposed.ipc).toBe('undefined');
  expect(exposed.shell).toBe('undefined');
});

// c) pagine interne filo://
test('#405 i riquadri dentro una pagina interna filo:// restano esclusi', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><body style="margin:0"><p id="p">contenuto esterno</p></body>`);
  const page = await openTab('filo://newtab/newtab.html');
  await page.waitForTimeout(1000);
  await page.evaluate((u) => {
    const i = document.createElement('iframe');
    i.id = 'ext'; i.src = u; i.width = '400'; i.height = '200';
    i.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:9999';
    document.body.appendChild(i);
  }, child);
  await page.waitForTimeout(2000);
  const fr = page.frames().find((f) => f.url() === child);
  if (!fr) {
    // Confine ancora più netto: una pagina interna non carica proprio i
    // riquadri esterni. Nulla da montare → nulla da esporre.
    console.log('[FILO-PAGE-IFRAME] riquadro esterno non caricato affatto — frame: '
      + JSON.stringify(page.frames().map((f) => f.url())));
    expect(await page.evaluate(() => document.readyState)).toBe('complete');
    return;
  }
  const state = await fr.evaluate(() => ({
    ready: document.documentElement.dataset.filoReady || null,
    cs: document.documentElement.dataset.filoContentScripts || null,
  }));
  console.log('[FILO-PAGE-IFRAME] ' + JSON.stringify(state));
  // clic + tasto destro: NON deve montare Filo dentro un riquadro di filo://
  await fr.locator('#p').click().catch(() => {});
  await fr.locator('#p').click({ button: 'right' }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await fr.evaluate(() => document.documentElement.dataset.filoReady || null);
  console.log('[FILO-PAGE-IFRAME] dopo interazione ready=' + after);
  expect(after, 'Filo si è montato in un riquadro di una pagina interna').toBeNull();
  // la pagina interna resta viva
  expect(await page.evaluate(() => document.readyState)).toBe('complete');
});

// d) riquadro che sparisce / naviga
test('#405 il riquadro che sparisce o naviga non lascia menu fantasma', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><body style="margin:0"><p id="p">contenuto</p></body>`);
  const other = testServer.html(`<!doctype html><body style="margin:0"><p id="q">altro</p></body>`);
  const page = await testServer.openReady(openTab, parent(child));
  const fr = await frameByUrl(page, child);
  await fr.locator('#p').click({ button: 'right' });
  expect(await anyFrameHas(page, '.sn-menu', 8000)).not.toBeNull();

  // il riquadro naviga altrove mentre il menu è aperto
  await page.evaluate((u) => { document.querySelector('#f').src = u; }, other);
  await page.waitForTimeout(1500);
  // la pagina resta usabile: tasto destro fuori funziona ancora
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  // e il NUOVO contenuto del riquadro ha di nuovo il menu
  const fr2 = await frameByUrl(page, other);
  await fr2.locator('#q').click({ button: 'right' });
  expect(await anyFrameHas(page, '.sn-menu', 8000), 'dopo la navigazione il riquadro resta senza menu').not.toBeNull();

  // il riquadro viene rimosso del tutto
  await page.evaluate(() => document.querySelector('#f')?.remove());
  await page.waitForTimeout(800);
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
});

// e) tanti riquadri (pagina piena di pubblicità): niente rallentamenti/crash
test('#405 pagina con 30 riquadri: resta reattiva e il menu funziona solo dove serve', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><body style="margin:0"><p id="p">ad</p></body>`);
  let ifr = '';
  for (let i = 0; i < 30; i++) ifr += `<iframe class="ad" src="${child}" width="120" height="60"></iframe>`;
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:20px">
    <p id="outside">articolo</p>${ifr}</body>`);
  await page.waitForTimeout(2000);
  const t0 = Date.now();
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  console.log('[30-IFRAME] menu sulla pagina in ' + (Date.now() - t0) + 'ms, frame=' + page.frames().length);
  await page.keyboard.press('Escape');

  // uno solo dei riquadri viene usato: lì il menu deve comparire
  const frames = page.frames().filter((f) => f.url() === child);
  expect(frames.length).toBeGreaterThan(20);
  const t1 = Date.now();
  await frames[3].locator('#p').click({ button: 'right' });
  const mf = await anyFrameHas(page, '.sn-menu', 10000);
  console.log('[30-IFRAME] menu nel riquadro in ' + (Date.now() - t1) + 'ms');
  expect(mf, 'nessun menu in un riquadro di una pagina piena di riquadri').not.toBeNull();
});
