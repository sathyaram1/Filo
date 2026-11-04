// #1808 giro 2, rilievo 2: un modulo mandato da script che il sito rimanda indietro col testo e un errore tiene aperta la scheda, come dal bottone.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

test.describe.configure({ timeout: 240_000 });

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

async function idDi(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.id, { timeout: 8_000 }).toBeTruthy();
  return (await schede(shell)).find((t) => t.title === titolo).id;
}

async function sporca(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  return (await schede(shell)).find((t) => t.title === titolo).id;
}

async function lasciaTitolo(shell, id, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).not.toBe(titolo);
}

const TESTATA = '<header><form action="/entra" method="post">Utente <input name="u"> Password <input type="password" name="p"><button>Entra</button></form></header>';
const LATO = '<aside><h3>Area riservata</h3><form action="/entra" method="post"><input name="u" placeholder="Utente"><input type="password" name="p" placeholder="Password"><button>Entra</button></form></aside>';
const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';

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
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
      if (percorso === '/rifai') { const m = new URLSearchParams(corpo).get('messaggio') || ''; return html(200, `<!doctype html><title>Rispondi</title><p class="errore">Il codice di verifica non è corretto, riprova</p><form method="post" action="/rifai"><textarea name="messaggio">${m.replace(/</g, '&lt;')}</textarea><input name="captcha"><button>Invia</button></form>`); }
      if (percorso === '/scaduta-sso') { res.writeHead(302, { Location: `http://sito-pubblico.test:${server.address().port}/accedi` }); res.end(); return; }
      if (percorso === '/accesso-qui') return html(200, '<!doctype html><title>Piattaforma</title><h1>Accedi per continuare</h1><form action="/entra" method="post"><input name="u"><input type="password" name="p"><button>Accedi</button></form>');
      if (percorso === '/err500') return html(500, '<!doctype html><title>Errore</title><p>Errore del server');
      if (percorso === '/err403') return html(403, '<!doctype html><title>Vietato</title><p>Il modulo è scaduto, riprova');
      if (percorso === '/cade') { req.socket.destroy(); return; }
      if (percorso === '/scaduta') { res.writeHead(302, { Location: '/accedi' }); res.end(); return; }
      if (percorso === '/accedi') return html(200, '<!doctype html><title>Accedi</title><h1>La sessione è scaduta</h1><form action="/entra" method="post"><input name="u"><input type="password" name="p"><button>Accedi</button></form>');
      if (percorso === '/rispondi-anonimo') { res.writeHead(302, { Location: '/entra-per-rispondere' }); res.end(); return; }
      if (percorso === '/entra-per-rispondere') return html(200, `<!doctype html><title>Forum - Accedi</title>${TESTATA}<h1>Devi accedere per rispondere</h1><form action="/entra" method="post">Utente <input name="u2"> Password <input type="password" name="p2"><button>Accedi</button></form>`);
      if (percorso === '/ok') { res.writeHead(302, { Location: '/fatto' }); res.end(); return; }
      if (percorso === '/fatto') return html(200, '<!doctype html><title>Fatto</title><p>Ricevuto');
      if (percorso === '/contatto') { res.writeHead(302, { Location: '/grazie' }); res.end(); return; }
      if (percorso === '/grazie') return html(200, `<!doctype html><title>Grazie</title>${TESTATA}<p>Grazie, ti risponderemo presto`);
      if (percorso === '/contatto-lato') { res.writeHead(302, { Location: '/grazie-lato' }); res.end(); return; }
      if (percorso === '/grazie-lato') return html(200, `<!doctype html><title>Grazie</title>${LATO}<p>Grazie, ti risponderemo presto`);
      if (percorso === '/contatto-accesso') { res.writeHead(302, { Location: '/login-servizi/grazie' }); res.end(); return; }
      if (percorso === '/login-servizi/grazie') return html(200, '<!doctype html><title>Accesso ai servizi - Grazie</title><p>Grazie, ti risponderemo presto');
      if (percorso === '/api/rifiuta') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"errore":"Devi accedere"}'); return; }
      if (percorso === '/api/err') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"errore":"guasto"}'); return; }
      if (percorso === '/api/ok') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (percorso === '/traccia') return html(200, '<!doctype html><title>Spedizione</title><p>La spedizione è in viaggio');
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      html(200, p);
    });
  });
  const prese = new Set();
  server.on('upgrade', (req, sock) => {
    prese.add(sock);
    const modo = new URL(req.url, 'http://x').searchParams.get('modo') || 'ack';
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let timer = null;
    if (modo.startsWith('battito')) timer = setInterval(() => { try { sock.write(frame('{"type":"presenza","online":3}')); } catch (_) {} }, 200);
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
        if (modo === 'ack' || modo === 'battito-ack') sock.write(frame('{"type":"ok","id":17}'));
        if (modo === 'eco' || modo === 'battito-eco') sock.write(frame(dati.toString()));
        if (modo === 'errore') sock.write(frame('{"type":"error","message":"Devi accedere per pubblicare"}'));
        if (modo === 'chiude') sock.destroy();
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
    pagina(html, { altra = false, nome } = {}) { const id = nome || `p${++n}`; pagine.set(id, html); return `${altra ? `http://sito-pubblico.test:${port}` : origine}/${id}`; },
    async chiudi() { for (const s of prese) s.destroy(); try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}


test('r2 un modulo mandato da script e rimandato indietro col testo e un errore tiene aperta la scheda, come dal bottone', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      'modulo rimandato col testo e un errore (bottone)': ['/rifai', '<button id="pub">Invia</button>'],
      'modulo rimandato col testo e un errore (script)': ['/rifai', '<a href="#" id="pub" onclick="f.submit();return false">Pubblica</a>'],
    };
    let k = 0;
    for (const [nome, [azione, invio]] of Object.entries(casi)) {
      const titolo = `Forma${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title><form id="f" method="post" action="${azione}"><textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea>${invio}</form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await page.waitForTimeout(2500);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});
