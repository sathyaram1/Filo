// #1808 giro 1, rilievo 1: un messaggio che il sito respinge non deve contare come arrivato perché la pagina lo mostra
// già (chat, dialogo «Crea») o perché sul collegamento sempre aperto arriva una risposta qualunque.
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

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, formDirty: t.formDirty, url: t.url })));

async function archiviaTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

const TESTATA = '<header><form action="/entra" method="post">Utente <input name="u"> Password <input type="password" name="p"><button>Entra</button></form></header>';
const LATO = '<aside><h3>Area riservata</h3><form action="/entra" method="post"><input name="u" placeholder="Utente"><input type="password" name="p" placeholder="Password"><button>Entra</button></form></aside>';
test.describe.configure({ timeout: 180_000 });

const POST = 'Un post lungo scritto con calma sul consiglio di quartiere di ieri sera';

function frame(testo) {
  const b = Buffer.from(testo);
  const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]);
  return Buffer.concat([h, b]);
}

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.on('data', () => {});
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
      if (percorso === '/err500') return html(500, '<!doctype html><title>Errore</title><p>Errore del server');
      if (percorso === '/err403') return html(403, '<!doctype html><title>Vietato</title><p>Il modulo è scaduto, riprova');
      if (percorso === '/cade') { req.socket.destroy(); return; }
      if (percorso === '/scaduta') { res.writeHead(302, { Location: '/accedi' }); res.end(); return; }
      if (percorso === '/accedi') return html(200, '<!doctype html><title>Accedi</title><h1>La sessione è scaduta</h1><form action="/entra" method="post"><input name="u"><input type="password" name="p"><button>Accedi</button></form>');
      if (percorso === '/rispondi-anonimo') { res.writeHead(302, { Location: '/entra-per-rispondere' }); res.end(); return; }
      if (percorso === '/entra-per-rispondere') return html(200, `<!doctype html><title>Accedi</title>${TESTATA}<h1>Devi accedere per rispondere</h1><form action="/entra" method="post">Utente <input name="u2"> Password <input type="password" name="p2"><button>Accedi</button></form>`);
      if (percorso === '/ok') { res.writeHead(302, { Location: '/fatto' }); res.end(); return; }
      if (percorso === '/fatto') return html(200, '<!doctype html><title>Fatto</title><p>Ricevuto');
      if (percorso === '/contatto') { res.writeHead(302, { Location: '/grazie' }); res.end(); return; }
      if (percorso === '/grazie') return html(200, `<!doctype html><title>Grazie</title>${TESTATA}<p>Grazie, ti risponderemo presto`);
      if (percorso === '/contatto-lato') { res.writeHead(302, { Location: '/grazie-lato' }); res.end(); return; }
      if (percorso === '/grazie-lato') return html(200, `<!doctype html><title>Grazie</title>${LATO}<p>Grazie, ti risponderemo presto`);
      if (percorso === '/api/rifiuta') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"errore":"Devi accedere"}'); return; }
      if (percorso === '/api/err') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"errore":"guasto"}'); return; }
      if (percorso === '/traccia') return html(200, '<!doctype html><title>Spedizione</title><p>La spedizione è in viaggio');
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      html(200, p);
    });
  });
  // Collegamento sempre aperto minimo: ?modo=ack risponde al post, muto tace, errore risponde con un errore,
  // battito manda presenze di continuo e ignora il post.
  const prese = new Set();
  server.on('upgrade', (req, sock) => {
    prese.add(sock);
    const modo = new URL(req.url, 'http://x').searchParams.get('modo') || 'ack';
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let timer = null;
    if (modo === 'battito') timer = setInterval(() => { try { sock.write(frame('{"type":"presenza","online":3}')); } catch (_) {} }, 200);
    sock.on('close', () => clearInterval(timer));
    sock.on('error', () => {});
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127; let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 128;
        const tot = off + (masked ? 4 : 0) + len;
        if (buf.length < tot) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const dati = Buffer.from(buf.subarray(off + (masked ? 4 : 0), tot));
        if (mask) for (let i = 0; i < dati.length; i++) dati[i] ^= mask[i % 4];
        buf = buf.subarray(tot);
        if (op === 8) { sock.end(); return; }
        if (op !== 1 && op !== 2) continue;
        if (modo === 'ack') sock.write(frame('{"type":"ok","id":17}'));
        if (modo === 'errore') sock.write(frame('{"type":"error","message":"Devi accedere per pubblicare"}'));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origine = `http://127.0.0.1:${port}`;
  return {
    origine,
    altra: `http://sito-pubblico.test:${port}`,
    ws: `ws://127.0.0.1:${port}/ws`,
    pagina(html, { altra = false } = {}) { const id = `p${++n}`; pagine.set(id, html); return `${altra ? `http://sito-pubblico.test:${port}` : origine}/${id}`; },
    async chiudi() { for (const s of prese) s.destroy(); try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

async function sporca(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  return (await schede(shell)).find((t) => t.title === titolo).id;
}

async function scriviEPubblica(shell, page, titolo, campo, testo = POST) {
  await campo.click();
  await page.keyboard.type(testo);
  const id = await sporca(shell, titolo);
  await page.locator('#pub').click();
  await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).not.toBe(titolo);
  await page.waitForTimeout(800);
  return id;
}

const PAGINA_WS = (titolo, url, binario = false) => `<!doctype html><title>${titolo}</title>
  <div id="box"><textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Pubblica</button></div><p id="esito"></p>
  <script>const ws = new WebSocket(${JSON.stringify(url)}); window.pronto = new Promise((r) => { ws.onopen = () => r(true); });
    pub.onclick = () => { const m = JSON.stringify({ type: 'post', testo: c.value }); ws.send(${binario ? 'new TextEncoder().encode(m)' : 'm'}); box.remove(); esito.textContent = 'Post pubblicato'; };</script>`;

async function postaWs(app, shell, sito, titolo, modo, { binario = false, testo = POST } = {}) {
  const page = await apriEsatta(app, shell, sito.pagina(PAGINA_WS(titolo, `${sito.ws}?modo=${modo}`, binario)));
  expect(await page.evaluate(() => window.pronto)).toBe(true);
  await page.locator('#c').click();
  for (const [i, riga] of testo.split('\n').entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(riga); }
  const id = await sporca(shell, titolo);
  await page.locator('#pub').click();
  await expect(page.locator('#esito')).toHaveText('Post pubblicato');
  await page.waitForTimeout(1200);
  return id;
}

test('r1 un post su un collegamento sempre aperto a cui il sito risponde con un errore, o che il sito ignora, tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const respinti = {
      'risposta d’errore': await postaWs(app, shell, sito, 'WsErrore', 'errore'),
      'solo presenze, il post ignorato': await postaWs(app, shell, sito, 'WsBattito', 'battito'),
    };
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

test('r1 un messaggio tolto dalla casella e mostrato nella pagina ma respinto dal sito tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const chat = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Chat</title><ul id="msg"><li>Marco: ci sei stasera?</li></ul>
      <form id="f"><input id="c" style="width:380px" placeholder="Scrivi un messaggio"></form>
      <script>f.addEventListener('submit', (e) => { e.preventDefault(); const t = c.value; const li = document.createElement('li'); li.textContent = 'Io: ' + t; msg.append(li); c.value = '';
        fetch('/api/rifiuta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) }).then((r) => { if (!r.ok) li.textContent += ' (non inviato)'; }); });</script>`));
    await chat.locator('#c').click();
    await chat.keyboard.type('Ci vediamo alle otto davanti al cinema Odeon');
    ids['chat in una riga respinta'] = await sporca(shell, 'Chat');
    await chat.keyboard.press('Enter');
    await expect(chat.locator('#msg li').last()).toContainText('(non inviato)');
    await chat.waitForTimeout(800);

    const chat2 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Chat2</title><ul id="msg"><li>Marco: ci sei stasera?</li></ul>
      <textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button>
      <script>pub.onclick = () => { const t = c.value; const li = document.createElement('li'); li.textContent = 'Io: ' + t; msg.append(li); c.value = '';
        fetch('/api/rifiuta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) }).then((r) => { if (!r.ok) li.textContent += ' (non inviato)'; }); };</script>`));
    await chat2.locator('#c').click();
    await chat2.keyboard.type('Ciao Marco, stasera non riesco: ti scrivo domani mattina con calma per il trasloco');
    ids['chat in un’area di testo respinta'] = await sporca(shell, 'Chat2');
    await chat2.locator('#pub').click();
    await expect(chat2.locator('#msg li').last()).toContainText('(non inviato)');
    await chat2.waitForTimeout(800);

    const lista = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>ListeSrv</title><ul id="liste"><li>Lavoro</li></ul><button id="nuova">Nuova lista</button>
      <script>nuova.onclick = () => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.innerHTML = '<input id="nome"><button id="crea">Crea</button>'; document.body.append(d);
        crea.onclick = () => { const t = nome.value; const li = document.createElement('li'); li.textContent = t; liste.append(li); d.remove();
          fetch('/api/err', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: t }) }).then((r) => { if (!r.ok) li.title = 'Non salvata'; }); }; };</script>`));
    await lista.locator('#nuova').click();
    await lista.locator('#nome').click();
    await lista.keyboard.type('Spesa della settimana al mercato');
    ids['dialogo «Crea» respinto dal sito'] = await sporca(shell, 'ListeSrv');
    await lista.locator('#crea').click();
    await expect(lista.locator('#liste li').last()).toHaveAttribute('title', 'Non salvata');
    await lista.waitForTimeout(800);

    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});
