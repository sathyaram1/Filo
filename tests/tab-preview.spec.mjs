// #430 — passando il puntatore su una scheda compare la carta con l'anteprima di cosa contiene, e la foto è già
// lì quando la carta compare: la scheda lasciata dietro, quella aperta in secondo piano e quella nascosta prima di
// finire di caricare. Si guarda la carta vera (la finestra figlia), coi suoi pixel. Le schede si aprono e si
// cambiano dalle strade dell'utente: il main si interroga soltanto.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const pagina = (colore, titolo, corpo = '') => `<!doctype html><title>${titolo}</title>
<style>html,body{margin:0;height:100%;background:${colore}}a{display:block;font:30px sans-serif;padding:20px}</style>
<h1 style="margin:0;padding:40px;font:40px sans-serif">${titolo}</h1>${corpo}`;

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, loading: x.loading, foto: !!t.anteprime.get(x.id) })) };
  });
}

// Id della scheda su quell'indirizzo, appena ha finito di caricare.
async function caricata(app, url) {
  let id = null;
  await expect.poll(async () => {
    const s = await schede(app);
    const t = s.tutte.find((x) => x.url === url);
    id = t && !t.loading ? t.id : null;
    return !!id;
  }, { timeout: 15_000 }).toBe(true);
  return id;
}

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const id = await caricata(app, url);
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(id);
  return id;
}

async function haFoto(app, id) {
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === id)?.foto, { timeout: 10_000 }).toBe(true);
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
        larghezza: carta.getBoundingClientRect().width,
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

// Il tempo che una pagina si disegni davvero prima di lasciarla, come per chi l'ha guardata.
const guardata = () => new Promise((r) => setTimeout(r, 400));

test('la scheda lasciata dietro mostra la sua anteprima appena ci passi sopra', async ({ app, shell, testServer }) => {
  const rossa = await apri(app, shell, testServer.html(pagina('#e01010', 'Pagina rossa')));
  await guardata();
  const blu = await apri(app, shell, testServer.html(pagina('#1030e0', 'Pagina blu')));
  await haFoto(app, rossa);

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
  await shell.locator('#tab-new').hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(false);

  // Un clic sulla rossa la porta davanti: da lì la carta della blu ha la sua foto.
  await guardata();
  await shell.locator(`.tab[data-id="${rossa}"]`).click();
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(rossa);
  await haFoto(app, blu);
  await shell.locator(`.tab[data-id="${blu}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('blu');
});

test('una scheda aperta in secondo piano con Ctrl+clic ha l\'anteprima senza essere mai stata aperta', async ({ app, shell, testServer }) => {
  const url = testServer.html(pagina('#10a020', 'Dietro'));
  const davantiUrl = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${url}">link</a>`));
  const davanti = await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const dietro = await caricata(app, url);
  // Aperta dietro: la pagina davanti è rimasta quella.
  expect((await schede(app)).attiva).toBe(davanti);

  await haFoto(app, dietro);
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
  expect((await carta(app)).titolo).toBe('Dietro');
});

test('una scheda nascosta prima di finire di caricare ha comunque la sua anteprima', async ({ app, shell, testServer }) => {
  // Una pagina lenta, come al ripristino della sessione: finisce di caricare quando davanti c'è già un'altra scheda.
  const lento = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagina('#10a020', 'Verde lenta'));
    }, 2500);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${lento.address().port}/lenta`;
    const primaUrl = testServer.html(pagina('#e01010', 'Prima', `<a id="vai" href="${url}">link</a>`));
    const prima = await apri(app, shell, primaUrl);
    const page = app.windows().find((w) => w.url() === primaUrl);
    await page.click('#vai', { modifiers: ['Control'] });
    await expect.poll(async () => (await schede(app)).tutte.some((x) => x.url === url), { timeout: 5000 }).toBe(true);
    const verde = (await schede(app)).tutte.find((x) => x.url === url).id;
    // Cambio di scheda mentre quella dietro sta ancora caricando.
    const altra = await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu davanti')));
    expect((await schede(app)).tutte.find((x) => x.id === verde).loading).toBe(true);
    expect(altra).not.toBe(prima);

    await caricata(app, url);
    await haFoto(app, verde);
    await shell.locator(`.tab[data-id="${verde}"]`).hover();
    await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
  } finally {
    lento.closeAllConnections?.();
    await new Promise((r) => lento.close(r));
  }
});

test('dalle Preferenze l\'anteprima si spegne e torna il suggerimento col titolo', async ({ app, shell, testServer }) => {
  const a = await apri(app, shell, testServer.html(pagina('#e01010', 'Uno')));
  await guardata();
  await apri(app, shell, testServer.html(pagina('#1030e0', 'Due')));
  await haFoto(app, a);

  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: false } } }));
  await expect(shell.locator(`.tab[data-id="${a}"]`)).toHaveAttribute('data-tip', 'Uno', { timeout: 5000 });
  await expect(shell.locator(`.tab[data-id="${a}"]`)).not.toHaveAttribute('data-anteprima', /.+/);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await new Promise((r) => setTimeout(r, 800));
  expect((await carta(app)).visibile).toBe(false);

  // Riaccesa, e più grande.
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { tabPreview: { enabled: true, size: 'grande' } } }));
  await expect(shell.locator(`.tab[data-id="${a}"]`)).toHaveAttribute('data-anteprima', a, { timeout: 5000 });
  await shell.locator('#tab-new').hover();
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  expect(Math.round((await carta(app)).larghezza)).toBe(360);
  expect(tinta((await carta(app)).colore)).toBe('rosso');
});
