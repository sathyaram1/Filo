// #430 — passando il puntatore su una scheda compare la carta con l'anteprima di cosa contiene, con la foto già lì.
// Si guarda la carta vera (la finestra figlia), coi suoi pixel; le schede si aprono e si cambiano dalle strade
// dell'utente, il main si interroga soltanto. I casi coperti li elenca patterns/l-anteprima-di-una-scheda-si-scatta-prima-che-serva.md.

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

// Feed, posta, video: il contenuto arriva dopo il caricamento. La prima foto è ancora vuota, la seconda no.
test('una scheda aperta dietro che si riempie dopo il caricamento mostra il contenuto arrivato', async ({ app, shell, testServer }) => {
  const url = testServer.html(`<!doctype html><title>Tarda</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<script>addEventListener('load',()=>setTimeout(()=>{document.documentElement.style.background=document.body.style.background='#10a020'},1200))</script><body></body>`);
  const davantiUrl = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${url}">link</a>`));
  await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const dietro = await caricata(app, url);
  await haFoto(app, dietro);
  await new Promise((r) => setTimeout(r, 4000));
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
});

// Un rimando («Apertura in corso…») o un aggiornamento della pagina mentre la scheda sta dietro: la foto segue.
test('una scheda dietro che passa da sola a un\'altra pagina ha la foto della pagina nuova, come il titolo', async ({ app, shell, testServer }) => {
  const finale = testServer.html(pagina('#10a020', 'Articolo'));
  const ponte = (dopo) => testServer.html(`<!doctype html><title>Apertura…</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p id="vai">Apertura in corso…</p><script>addEventListener('load',()=>setTimeout(()=>location.replace(${JSON.stringify(finale)}),${dopo}))</script>`);

  // Nata dietro con Ctrl+clic.
  const primo = ponte(900);
  const davantiUrl = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${primo}">link</a>`));
  const davanti = await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const nata = await caricata(app, finale);
  await new Promise((r) => setTimeout(r, 1500));
  await shell.locator(`.tab[data-id="${nata}"]`).hover();
  await expect.poll(async () => (await carta(app)).titolo, { timeout: 3000 }).toBe('Articolo');
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
  await shell.locator('#tab-new').hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(false);

  // Guardata e lasciata prima che cambi pagina.
  const secondo = ponte(2500);
  const vista = await apri(app, shell, secondo);
  await guardata();
  await shell.locator(`.tab[data-id="${davanti}"]`).click();
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(davanti);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === vista)?.url, { timeout: 10_000 }).toBe(finale);
  await new Promise((r) => setTimeout(r, 1500));
  await shell.locator(`.tab[data-id="${vista}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
});

// La barra si ridisegna a ogni titolo che cambia: l'attesa della prima carta non deve ripartire a ogni ridisegno.
test('con una scheda che cambia titolo più volte al secondo la carta compare lo stesso', async ({ app, shell, testServer }) => {
  await apri(app, shell, testServer.html(pagina('#e0e010', 'Caricamento', `<script>let n=0;setInterval(()=>{document.title='Caricamento '+(++n)+'%'},150)</script>`)));
  const rossa = await apri(app, shell, testServer.html(pagina('#e01010', 'Rossa')));
  await guardata();
  await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu')));
  await haFoto(app, rossa);
  await shell.mouse.move(600, 500);
  await new Promise((r) => setTimeout(r, 900));
  await shell.locator(`.tab[data-id="${rossa}"]`).hover();
  await expect.poll(async () => { const c = await carta(app); return c.visibile && c.titolo === 'Rossa'; }, { timeout: 2000 }).toBe(true);
  expect(tinta((await carta(app)).colore)).toBe('rosso');
});

// Una posta o un'app pesante su una rete lenta: il contenuto arriva ben dopo la seconda foto. La foto segue il cambio.
test('una scheda aperta dietro che si riempie cinque secondi dopo il caricamento mostra il contenuto', async ({ app, shell, testServer }) => {
  const url = testServer.html(`<!doctype html><title>Posta</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.documentElement.style.background=document.body.style.background='#10a020'},5000))</script>`);
  const davantiUrl = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${url}">link</a>`));
  await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const dietro = await caricata(app, url);
  await new Promise((r) => setTimeout(r, 9000));
  await shell.mouse.move(600, 500);
  await new Promise((r) => setTimeout(r, 900));
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
});

// Un sito a pagina unica (il video dopo, il messaggio dopo) cambia pagina senza ricaricare: niente caricamento da aspettare.
test('una scheda dietro che cambia pagina senza ricaricarsi ha la foto nuova, come il titolo', async ({ app, shell, testServer }) => {
  const url = testServer.html(`<!doctype html><title>Video 1</title><style>html,body{margin:0;height:100%;background:#e01010}</style>
<h1>Video 1</h1><script>addEventListener('load',()=>setTimeout(()=>{history.pushState({},'','?v=2');document.title='Video 2';document.documentElement.style.background=document.body.style.background='#10a020';document.querySelector('h1').textContent='Video 2'},6000))</script>`);
  const davantiUrl = testServer.html(pagina('#1030e0', 'Davanti', `<a id="vai" href="${url}">link</a>`));
  await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const dietro = await caricata(app, url);
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === dietro)?.url, { timeout: 15_000 }).toMatch(/\?v=2$/);
  await new Promise((r) => setTimeout(r, 4500));
  await shell.mouse.move(600, 500);
  await new Promise((r) => setTimeout(r, 900));
  await shell.locator(`.tab[data-id="${dietro}"]`).hover();
  await expect.poll(async () => (await carta(app)).titolo, { timeout: 3000 }).toBe('Video 2');
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
});

// Chi apre un link dietro e punta subito la scheda nuova per sbirciarla: la foto arriva nella carta già aperta.
test('la carta aperta su una scheda che finisce di caricare, o che riceve la seconda foto, passa alla foto nuova', async ({ app, shell, testServer }) => {
  const lento = createServer((_req, res) => {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(pagina('#10a020', 'Lenta')); }, 2500);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  const lenta = `http://localhost:${lento.address().port}/lenta`;
  try {
    const davantiUrl = testServer.html(pagina('#1030e0', 'Davanti', `<a id="vai" href="${lenta}">link</a>`));
    await apri(app, shell, davantiUrl);
    const page = app.windows().find((w) => w.url() === davantiUrl);
    await page.click('#vai', { modifiers: ['Control'] });
    let dietro = null;
    await expect.poll(async () => { dietro = (await schede(app)).tutte.find((t) => t.url === lenta)?.id; return !!dietro; }, { timeout: 5000 }).toBe(true);
    await shell.mouse.move(600, 500);
    await new Promise((r) => setTimeout(r, 900));
    // Sul bordo sinistro: a caricamento finito il titolo si accorcia e la scheda si stringe.
    await shell.locator(`.tab[data-id="${dietro}"]`).hover({ position: { x: 12, y: 12 } });
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    expect((await carta(app)).foto).toBeNull();
    await haFoto(app, dietro);
    await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 3000 }).toBe('verde');
  } finally {
    lento.closeAllConnections?.();
    await new Promise((r) => lento.close(r));
  }

  const tarda = testServer.html(`<!doctype html><title>Feed</title><style>html,body{margin:0;height:100%;background:#fff}</style>
<p>Caricamento…</p><script>addEventListener('load',()=>setTimeout(()=>{document.documentElement.style.background=document.body.style.background='#10a020'},1200))</script>`);
  const davanti2 = testServer.html(pagina('#1030e0', 'Ancora davanti', `<a id="vai" href="${tarda}">link</a>`));
  await apri(app, shell, davanti2);
  const page2 = app.windows().find((w) => w.url() === davanti2);
  await shell.mouse.move(600, 500);
  await page2.click('#vai', { modifiers: ['Control'] });
  const feed = await caricata(app, tarda);
  await haFoto(app, feed);
  await shell.locator(`.tab[data-id="${feed}"]`).hover({ position: { x: 12, y: 12 } });
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await expect.poll(async () => tinta((await carta(app)).colore), { timeout: 8000 }).toBe('verde');
});

// Col menu del tasto destro di una scheda aperto, la carta di un'altra scheda gli finirebbe sotto, mezza coperta.
test('col menu di una scheda aperto la carta aspetta che il menu si chiuda', async ({ app, shell, testServer }) => {
  const menuAperti = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && w.isVisible() && /^data:text\/html/.test(w.webContents.getURL())).length);
  const rossa = await apri(app, shell, testServer.html(pagina('#e01010', 'Rossa')));
  await guardata();
  const verde = await apri(app, shell, testServer.html(pagina('#10a020', 'Verde')));
  await guardata();
  await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu')));
  await haFoto(app, rossa);
  await shell.mouse.move(600, 500);
  await new Promise((r) => setTimeout(r, 900));
  await shell.locator(`.tab[data-id="${verde}"]`).click({ button: 'right' });
  await expect.poll(menuAperti, { timeout: 3000 }).toBeGreaterThan(0);
  await shell.locator(`.tab[data-id="${rossa}"]`).hover();
  await new Promise((r) => setTimeout(r, 800));
  expect(await menuAperti()).toBeGreaterThan(0);
  expect((await carta(app)).visibile).toBe(false);
  // Chiuso il menu col puntatore ancora sulla scheda, la carta arriva.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && /^data:text\/html/.test(w.webContents.getURL())) w.close();
  });
  await expect.poll(async () => { const c = await carta(app); return c.visibile && c.titolo === 'Rossa'; }, { timeout: 3000 }).toBe(true);
});
