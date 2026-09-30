// #430 — passando il puntatore su una scheda compare la carta con l'anteprima di cosa contiene, e la foto è già
// lì quando la carta compare: la scheda lasciata dietro, quella aperta in secondo piano e quella nascosta prima di
// finire di caricare. Si guarda la carta vera (la finestra figlia), coi suoi pixel.

import { test, expect } from './fixtures/electron.mjs';

const pagina = (colore, titolo) => `<!doctype html><title>${titolo}</title>
<style>html,body{margin:0;height:100%;background:${colore}}</style><h1 style="margin:0;padding:40px;font:40px sans-serif">${titolo}</h1>`;

async function apri(app, url, activate = true) {
  return app.evaluate(({ BrowserWindow }, { url, activate }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.openTab(url, { activate });
  }, { url, activate });
}

async function attiva(app, id) {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activate(id);
  }, id);
}

async function caricata(app, id) {
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === id);
    return !!t && !t.loading && /^http/.test(t.url);
  }, id), { timeout: 15_000 }).toBe(true);
}

// Stato della carta: visibile, cosa dice, e il colore al centro della sua foto (null se la foto non c'è).
async function carta(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return { esiste: false, visibile: false };
    const dom = await c.webContents.executeJavaScript(`(() => {
      const carta = document.getElementById('carta');
      const img = document.querySelector('#foto img');
      const r = img ? img.getBoundingClientRect() : null;
      return {
        mostrata: !carta.hidden,
        titolo: document.getElementById('titolo').textContent,
        indirizzo: document.getElementById('indirizzo').textContent,
        pronta: !!img && img.complete && img.naturalWidth > 0,
        foto: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
        dpr: devicePixelRatio,
      };
    })()`);
    let colore = null;
    if (dom.foto && dom.mostrata) {
      const shot = await c.webContents.capturePage();
      const s = shot.getSize();
      const px = Math.round(dom.foto.x * dom.dpr);
      const py = Math.round(dom.foto.y * dom.dpr);
      if (px < s.width && py < s.height) {
        const b = shot.toBitmap();
        const i = (py * s.width + px) * 4;
        colore = [b[i + 2], b[i + 1], b[i]];
      }
    }
    return { esiste: true, visibile: c.isVisible(), ...dom, colore };
  });
}

const tinta = (c) => {
  if (!c) return 'nessuna';
  const [r, g, b] = c;
  if (r > 180 && g < 90 && b < 90) return 'rosso';
  if (b > 180 && r < 90 && g < 120) return 'blu';
  if (g > 100 && r < 90 && b < 90) return 'verde';
  return `altro ${c.join(',')}`;
};

test('la scheda lasciata dietro mostra la sua anteprima appena ci passi sopra', async ({ app, shell, testServer }) => {
  const rossa = await apri(app, testServer.html(pagina('#e01010', 'Pagina rossa')));
  await caricata(app, rossa);
  // Il tempo che la pagina si disegni davvero prima di cambiare scheda, come per chi l'ha guardata.
  await new Promise((r) => setTimeout(r, 400));
  const blu = await apri(app, testServer.html(pagina('#1030e0', 'Pagina blu')));
  await caricata(app, blu);

  await shell.locator(`.tab[data-id="${rossa}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const vista = await carta(app);
  expect(vista.titolo).toBe('Pagina rossa');
  expect(vista.indirizzo).toBe('127.0.0.1');
  // Alla comparsa la foto è già decodificata: niente da aspettare.
  expect(vista.pronta).toBe(true);
  expect(tinta(vista.colore)).toBe('rosso');

  // Dalla scheda davanti la pagina si vede già: la carta dice cos'è, senza foto.
  await shell.locator(`.tab[data-id="${blu}"]`).hover();
  await expect.poll(async () => (await carta(app)).titolo, { timeout: 3000 }).toBe('Pagina blu');
  expect((await carta(app)).foto).toBeNull();

  // Lasciata la barra, la carta se ne va.
  await shell.mouse.move(600, 20);
  await shell.locator('#tab-new').hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(false);

  // Ci si torna: la carta cambia foto con la scheda, e quella che era davanti ha ora la sua.
  await attiva(app, rossa);
  await caricata(app, rossa);
  await new Promise((r) => setTimeout(r, 300));
  await shell.locator(`.tab[data-id="${blu}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('blu');
});

test('una scheda aperta in secondo piano ha l\'anteprima senza essere mai stata aperta', async ({ app, shell, testServer }) => {
  const davanti = await apri(app, testServer.html(pagina('#e01010', 'Davanti')));
  await caricata(app, davanti);
  const dietro = await apri(app, testServer.html(pagina('#10a020', 'Dietro')), false);
  await caricata(app, dietro);
  // Ancora non aperta, e intanto la pagina davanti è rimasta quella.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId)).toBe(davanti);

  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) =>
    !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.anteprime.get(id), dietro), { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
  expect((await carta(app)).titolo).toBe('Dietro');
});

test('una scheda nascosta prima di finire di caricare ha comunque la sua anteprima', async ({ app, shell, testServer }) => {
  const prima = await apri(app, testServer.html(pagina('#e01010', 'Prima')));
  await caricata(app, prima);
  // Come al ripristino della sessione: si aprono dietro e subito dopo se ne porta davanti un'altra.
  const ids = await app.evaluate(({ BrowserWindow }, urls) => {
    const tabs = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const a = tabs.openTab(urls[0], { activate: false });
    const b = tabs.openTab(urls[1], { activate: false });
    tabs.activate(b);
    return [a, b];
  }, [testServer.html(pagina('#10a020', 'Verde nascosta')), testServer.html(pagina('#1030e0', 'Blu davanti'))]);
  await caricata(app, ids[0]);
  await caricata(app, ids[1]);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) =>
    !!BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.anteprime.get(id), ids[0]), { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${ids[0]}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
});

test('dalle Preferenze l\'anteprima si spegne e torna il suggerimento col titolo', async ({ app, shell, testServer }) => {
  const a = await apri(app, testServer.html(pagina('#e01010', 'Uno')));
  await caricata(app, a);
  await new Promise((r) => setTimeout(r, 300));
  const b = await apri(app, testServer.html(pagina('#1030e0', 'Due')));
  await caricata(app, b);

  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: false } } }));
  await expect(shell.locator(`.tab[data-id="${a}"]`)).toHaveAttribute('data-tip', 'Uno', { timeout: 5000 });
  await expect(shell.locator(`.tab[data-id="${a}"]`)).not.toHaveAttribute('data-anteprima', /.+/);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await new Promise((r) => setTimeout(r, 800));
  expect((await carta(app)).visibile).toBe(false);

  // Riaccesa, e più grande.
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: true, size: 'grande' } } }));
  await expect(shell.locator(`.tab[data-id="${a}"]`)).toHaveAttribute('data-anteprima', a, { timeout: 5000 });
  await shell.mouse.move(5, 5);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const larga = await app.evaluate(({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'filo://shell/anteprima.html');
    return c.webContents.executeJavaScript('document.getElementById("carta").getBoundingClientRect().width');
  });
  expect(Math.round(larga)).toBe(360);
});
