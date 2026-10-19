// #824 giro 10: r1 una casella del messaggio chiamata come una ricerca, r2 un modulo in un riquadro mandato e respinto,
// r3 un post partito su un collegamento sempre aperto col sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, formDirty: t.formDirty })));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

// Due nomi per lo stesso server: 127.0.0.1 e localhost sono due siti.
async function apriSito() {
  const pagine = new Map();
  const prese = new Set();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.on('data', () => {});
    req.on('end', () => {
      if (percorso === '/invia-500') { res.writeHead(500, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Errore</title><p>Errore del server'); return; }
      const html = pagine.get(percorso.replace(/^\//, ''));
      if (!html) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  server.on('upgrade', (req, socket) => {
    prese.add(socket);
    const acc = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    pagina(html, host = '127.0.0.1') { const id = `p${++n}`; pagine.set(id, html); return `http://${host}:${porta}/${id}`; },
    async chiudi() {
      for (const s of prese) s.destroy();
      try { server.closeAllConnections(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

const LETTERA = 'Buongiorno, vorrei sapere se il divano grigio è ancora disponibile e quanto costa la consegna a Torino';

test('r1 la lettera scritta in una casella che il sito chiama «query» tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Contatti</title><form method="post" action="/invia-500">
      Name <input name="name"> Your query <textarea id="c" name="query" style="width:400px;height:100px"></textarea><button>Send</button></form>`));
    await page.locator('#c').click();
    await page.keyboard.type(LETTERA);
    await page.waitForTimeout(1000);
    const id = (await schede(shell)).find((t) => t.title === 'Contatti').id;
    const aperte = await pulisciTutto(app, shell, sito);
    expect(aperte).toContain(id);
  } finally { await sito.chiudi(); }
});

test('r2 un modulo in un riquadro di un altro sito, mandato e respinto, tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const dentro = sito.pagina(`<!doctype html><title>Modulo</title><form method="post" action="/invia-500"><textarea id="c" name="m" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`, 'localhost');
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Ospite</title><iframe id="f" src="${dentro}" style="width:500px;height:200px"></iframe>`));
    const fr = page.frameLocator('#f');
    await fr.locator('#c').click();
    await page.keyboard.type(LETTERA);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Ospite')?.formDirty, { timeout: 8_000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Ospite').id;
    await fr.locator('#pub').click();
    await expect(fr.locator('body')).toContainText('Errore del server');
    await page.waitForTimeout(800);
    const aperte = await pulisciTutto(app, shell, sito);
    expect(aperte).toContain(id);
  } finally { await sito.chiudi(); }
});

test('r3 un post mandato su un collegamento sempre aperto col sito, con la finestrella tolta, non protegge la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Social</title>
      <div id="box"><textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Pubblica</button></div><p id="esito"></p>
      <script>const ws = new WebSocket('ws://' + location.host + '/ws'); window.pronto = new Promise((r) => ws.onopen = () => r(true));
        pub.onclick = () => { ws.send(JSON.stringify({ testo: c.value })); box.remove(); esito.textContent = 'Post pubblicato'; };</script>`));
    expect(await page.evaluate(() => window.pronto)).toBe(true);
    await page.locator('#c').click();
    await page.keyboard.type(LETTERA);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Social')?.formDirty, { timeout: 8_000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Social').id;
    await page.locator('#pub').click();
    await expect(page.locator('#esito')).toHaveText('Post pubblicato');
    await page.waitForTimeout(800);
    const aperte = await pulisciTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});
