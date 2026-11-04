// #1808 giro 1: prove avversariali della pulizia schede su testo inviato e respinto (#824.3, .4, .6).

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
      if (percorso === '/traccia') return html(200, '<!doctype html><title>Spedizione</title><p>La spedizione è in viaggio');
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      html(200, p);
    });
  });
  // Collegamento sempre aperto minimo: ?modo=ack risponde al post, muto tace, errore risponde con un errore,
  // battito manda presenze di continuo e ignora il post.
  server.on('upgrade', (req, sock) => {
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
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
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

test('824.3 A: invii da script respinti, sessione scaduta, accesso chiesto a chi risponde', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const p1 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Scuola</title>
      <form id="f" method="post" action="/scaduta"><textarea name="corpo" id="c" style="width:400px;height:100px"></textarea></form>
      <a href="#" id="pub" onclick="f.submit();return false">Consegna</a>`));
    ids['sessione scaduta da script'] = await scriviEPubblica(shell, p1, 'Scuola', p1.locator('#c'));
    const p2 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Dinamico</title>
      <textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Rispondi</button>
      <script>pub.onclick = () => { const f = document.createElement('form'); f.method = 'post'; f.action = '/err403';
        const h = document.createElement('input'); h.type = 'hidden'; h.name = 'm'; h.value = c.value; f.append(h); document.body.append(f); f.submit(); };</script>`));
    ids['modulo creato dallo script'] = await scriviEPubblica(shell, p2, 'Dinamico', p2.locator('#c'));
    const p3 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Forum</title>${TESTATA}
      <form method="post" action="/rispondi-anonimo"><textarea name="corpo" id="c" style="width:400px;height:100px"></textarea><button id="pub">Rispondi</button></form>`));
    ids['accesso in testata, risposta che chiede di accedere'] = await scriviEPubblica(shell, p3, 'Forum', p3.locator('#c'));
    const p4 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Richiesto</title>
      <form id="f" method="post" action="/err500"><textarea name="corpo" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>
      <script>f.addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => f.requestSubmit(), 50); }, { once: true });</script>`));
    ids['requestSubmit dopo attesa'] = await scriviEPubblica(shell, p4, 'Richiesto', p4.locator('#c'));
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.3 B: modulo mandato bene con l’accesso in testata o di lato non tiene la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const p1 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Scrivici</title>${LATO}
      <form method="post" action="/contatto-lato"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`));
    ids['accesso di lato'] = await scriviEPubblica(shell, p1, 'Scrivici', p1.locator('#c'));
    const p2 = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Contattaci</title>${TESTATA}
      <form id="f" method="post" action="/contatto"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea></form>
      <a href="#" id="pub" onclick="f.submit();return false">Invia</a>`));
    ids['accesso in testata, invio da script'] = await scriviEPubblica(shell, p2, 'Contattaci', p2.locator('#c'));
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.4 A e B: casella con nome da ricerca e moduli in un riquadro di un altro sito', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const q = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Contact</title>
      <form onsubmit="event.preventDefault()"><input name="name" placeholder="Your name"><textarea name="your-query" placeholder="Your query" id="c" style="width:400px;height:100px"></textarea><button>Send</button></form>`));
    await q.locator('#c').click();
    await q.keyboard.type('Hello, I ordered a lamp two weeks ago and it still has not arrived');
    ids['Your query'] = await sporca(shell, 'Contact');
    const s = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Domanda</title>
      <form onsubmit="event.preventDefault()"><textarea name="s" id="c" style="width:400px;height:100px"></textarea><button>Invia</button></form>`));
    await s.locator('#c').click();
    await s.keyboard.type('Qualcuno sa come si cambia la batteria?');
    ids['area di testo chiamata s'] = await sporca(shell, 'Domanda');

    for (const [nome, azione, script] of [['Riq500', '/err500', false], ['RiqCade', '/cade', false], ['RiqScript', '/err403', true]]) {
      const interno = sito.pagina(`<!doctype html><title>modulo</title><form id="f" method="post" action="${azione}">
        <textarea name="corpo" id="c" style="width:380px;height:90px"></textarea>${script ? '<a href="#" id="pub" onclick="f.submit();return false">Invia</a>' : '<button id="pub">Invia</button>'}</form>`, { altra: true });
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${nome}</title><h1>Contatti</h1><iframe id="ifr" src="${interno}" style="width:420px;height:200px"></iframe>`));
      const fr = page.frameLocator('#ifr');
      await fr.locator('#c').click();
      await page.keyboard.type(POST);
      ids[nome] = await sporca(shell, nome);
      await fr.locator('#pub').click();
      await page.waitForTimeout(1500);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.4 B al contrario: modulo in un riquadro di un altro sito mandato bene', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const interno = sito.pagina(`<!doctype html><title>modulo</title><form method="post" action="/ok">
      <textarea name="corpo" id="c" style="width:380px;height:90px"></textarea><button id="pub">Invia</button></form>`, { altra: true });
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>RiqOk</title><iframe id="ifr" src="${interno}" style="width:420px;height:200px"></iframe>`));
    const fr = page.frameLocator('#ifr');
    await fr.locator('#c').click();
    await page.keyboard.type(POST);
    const id = await sporca(shell, 'RiqOk');
    await fr.locator('#pub').click();
    await expect(fr.locator('body')).toContainText('Ricevuto');
    await page.waitForTimeout(800);
    const aperte = await archiviaTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});

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

test('824.4 C: post su un collegamento sempre aperto', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const arrivati = {
      'ack': await postaWs(app, shell, sito, 'WsAck', 'ack'),
      'ack, due righe con virgolette': await postaWs(app, shell, sito, 'WsRighe', 'ack', { testo: 'Oggi ho finito la maratona di Firenze\nGrazie a "tutti" voi 🙂' }),
      'ack, binario': await postaWs(app, shell, sito, 'WsBin', 'ack', { binario: true }),
    };
    const respinti = {
      'muto': await postaWs(app, shell, sito, 'WsMuto', 'muto'),
      'errore': await postaWs(app, shell, sito, 'WsErrore', 'errore'),
      'battito ignora il post': await postaWs(app, shell, sito, 'WsBattito', 'battito'),
    };
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.6: risultato in un’altra scheda e dialoghi', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const via = {};
    const resta = {};
    const tr = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Traccia</title>
      <form action="/traccia" target="_blank"><input name="n" id="n" placeholder="Numero di spedizione"><input name="cap" id="cap" placeholder="CAP"><button id="pub">Traccia</button></form>`));
    await tr.locator('#n').click(); await tr.keyboard.type('RR123456789IT');
    await tr.locator('#cap').click(); await tr.keyboard.type('50123');
    via['risultato in scheda nuova'] = await sporca(shell, 'Traccia');
    await tr.locator('#pub').click();
    await expect.poll(async () => (await schede(shell)).some((t) => t.title === 'Spedizione'), { timeout: 10_000 }).toBe(true);
    await tr.bringToFront().catch(() => {});

    const DIALOGO = (titolo, tipo) => `<!doctype html><title>${titolo}</title><h1>Le mie liste</h1><ul id="liste"><li>Lavoro</li></ul>
      <button id="nuova">Nuova lista</button>
      ${tipo === 'dialog' ? '<dialog id="d"><input id="nome"><button id="crea">Crea</button><button id="annulla">Annulla</button></dialog>' : ''}
      <script>
        const apri = () => {
          ${tipo === 'dialog' ? 'd.showModal();' : `const d = document.createElement('div'); d.id = 'd'; d.setAttribute('role', 'dialog');
            d.innerHTML = '<input id="nome"><button id="crea">Crea</button><button id="annulla">Annulla</button>'; document.body.append(d);`}
          document.getElementById('crea').onclick = () => { const li = document.createElement('li'); li.textContent = document.getElementById('nome').value; liste.append(li); chiudi(); };
          document.getElementById('annulla').onclick = chiudi;
        };
        const chiudi = () => { ${tipo === 'dialog' ? 'd.close();' : 'document.getElementById(\'d\').remove();'} };
        nuova.onclick = apri;
      </script>`;
    for (const [titolo, tipo, azione] of [['DivCrea', 'div', 'crea'], ['DlgCrea', 'dialog', 'crea'], ['DivAnnulla', 'div', 'annulla'], ['DlgAnnulla', 'dialog', 'annulla']]) {
      const p = await apriEsatta(app, shell, sito.pagina(DIALOGO(titolo, tipo)));
      await p.locator('#nuova').click();
      await p.locator('#nome').click();
      await p.keyboard.type('Spesa della settimana al mercato');
      const id = await sporca(shell, titolo);
      await p.locator(`#${azione}`).click();
      if (azione === 'crea') await expect(p.locator('#liste li').last()).toHaveText('Spesa della settimana al mercato');
      await p.waitForTimeout(800);
      (azione === 'crea' ? via : resta)[`${tipo} ${azione}`] = id;
    }

    // Procedura a passi: l'indirizzo si vede nel riepilogo, ma «Paga» non è ancora premuto.
    const w = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Cassa</title>
      <div id="passo"><input id="via" placeholder="Indirizzo"><input id="citta" placeholder="Città"><button id="avanti">Avanti</button></div>
      <script>avanti.onclick = () => { const v = via.value, c = citta.value; passo.innerHTML = '<h2>Riepilogo</h2><p id="rie"></p><button>Paga</button>'; rie.textContent = v + ', ' + c; };</script>`));
    await w.locator('#via').click(); await w.keyboard.type('Via dei Servi 12, scala B, interno 4');
    await w.locator('#citta').click(); await w.keyboard.type('Firenze');
    resta['riepilogo prima di pagare'] = await sporca(shell, 'Cassa');
    await w.locator('#avanti').click();
    await expect(w.locator('#rie')).toContainText('Via dei Servi');
    await w.waitForTimeout(800);

    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(via)) expect.soft(aperte, `via: ${nome}`).not.toContain(id);
    for (const [nome, id] of Object.entries(resta)) expect.soft(aperte, `resta: ${nome}`).toContain(id);
  } finally { await sito.chiudi(); }
});
