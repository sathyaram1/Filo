// #1808: la pulizia delle schede e il testo respinto dal sito. Un no del sito vince sugli altri segni d'arrivo (la pagina
// che mostra il testo, una risposta qualunque sul collegamento sempre aperto), anche nei riquadri e a sessione scaduta;
// l'accesso fisso del sito non è una sessione scaduta. Le altre prove della pulizia: tab-auto-archive.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';
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
    let corpo = '';
    req.on('data', (d) => { if (corpo.length < 100_000) corpo += d; });
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
      if (percorso === '/accesso/inviato') { res.writeHead(302, { Location: '/accesso/grazie' }); res.end(); return; }
      if (percorso === '/accesso/grazie') return html(200, '<!doctype html><title>Grazie | Accesso clienti</title><p>Grazie, ti risponderemo presto');
      if (percorso === '/contatto-lato-dopo') { res.writeHead(302, { Location: '/grazie-lato' }); res.end(); return; }
      if (percorso === '/rifai') { const m = new URLSearchParams(corpo).get('messaggio') || ''; return html(200, `<!doctype html><title>Rispondi</title><p>Il codice di verifica non è corretto, riprova</p><form method="post" action="/rifai"><textarea name="messaggio" style="width:400px;height:100px">${m.replace(/</g, '&lt;')}</textarea><input name="captcha"><button>Invia</button></form>`); }
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
    pagina(html, { altra = false, percorso = '' } = {}) { const id = percorso || `p${++n}`; pagine.set(id, html); return `${altra ? `http://sito-pubblico.test:${port}` : origine}/${id}`; },
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

// `svuota`: la casella resta nella pagina, vuota, come nelle chat; senza, la pagina la toglie.
const PAGINA_WS = (titolo, url, binario = false, svuota = false) => `<!doctype html><title>${titolo}</title>
  <div id="box"><textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Pubblica</button></div><p id="esito"></p>
  <script>const ws = new WebSocket(${JSON.stringify(url)}); window.pronto = new Promise((r) => { ws.onopen = () => r(true); });
    pub.onclick = () => { const m = JSON.stringify({ type: 'post', testo: c.value }); ws.send(${binario ? 'new TextEncoder().encode(m)' : 'm'}); ${svuota ? "c.value = ''" : 'box.remove()'}; esito.textContent = 'Post pubblicato'; };</script>`;

async function postaWs(app, shell, sito, titolo, modo, { binario = false, testo = POST, svuota = false } = {}) {
  const page = await apriEsatta(app, shell, sito.pagina(PAGINA_WS(titolo, `${sito.ws}?modo=${modo}`, binario, svuota)));
  expect(await page.evaluate(() => window.pronto)).toBe(true);
  await page.locator('#c').click();
  for (const [i, riga] of testo.split('\n').entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(riga); }
  const id = await sporca(shell, titolo);
  await page.locator('#pub').click();
  await expect(page.locator('#esito')).toHaveText('Post pubblicato');
  await page.waitForTimeout(1200);
  return id;
}

test('un post su un collegamento sempre aperto vale come arrivato solo se il server lo conferma (#1808)', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const arrivati = {
      'risposta e poi silenzio': await postaWs(app, shell, sito, 'WsAck', 'ack'),
      'due righe con virgolette ed emoji': await postaWs(app, shell, sito, 'WsRighe', 'ack', { testo: 'Oggi ho finito la maratona di Firenze\nGrazie a "tutti" voi 🙂' }),
      'in binario': await postaWs(app, shell, sito, 'WsBin', 'ack', { binario: true }),
      'casella svuotata, confermato': await postaWs(app, shell, sito, 'WsSvuotaAck', 'ack', { svuota: true }),
    };
    const respinti = {
      'risposta d’errore': await postaWs(app, shell, sito, 'WsErrore', 'errore'),
      // Senza la casella tolta a fare da orfano, protegge solo il no del server.
      'casella svuotata, risposta d’errore': await postaWs(app, shell, sito, 'WsSvuotaErrore', 'errore', { svuota: true }),
      'solo presenze, il post ignorato': await postaWs(app, shell, sito, 'WsBattito', 'battito'),
    };
    await shell.waitForTimeout(1000);
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
  } finally { await sito.chiudi(); }
});

test('un messaggio tolto dalla casella e mostrato nella pagina ma respinto dal sito tiene aperta la scheda (#1808)', async ({ app, shell }) => {
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

test('un modulo in un riquadro mandato a sessione scaduta tiene aperta la scheda, mandato bene no (#1808)', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    for (const [nome, azione] of [['RiqScaduta', '/scaduta'], ['RiqOk', '/ok']]) {
      const interno = sito.pagina(`<!doctype html><title>Modulo</title><form method="post" action="${azione}">
        <textarea name="corpo" id="c" style="width:380px;height:90px"></textarea><button id="pub">Invia</button></form>`, { altra: true });
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${nome}</title><h1>Compiti</h1><iframe id="ifr" src="${interno}" style="width:420px;height:220px"></iframe>`));
      const fr = page.frameLocator('#ifr');
      await fr.locator('#c').click();
      await page.keyboard.type(POST);
      ids[nome] = await sporca(shell, nome);
      await fr.locator('#pub').click();
      await expect(fr.locator('body')).toContainText(azione === '/ok' ? 'Ricevuto' : 'La sessione è scaduta');
      await page.waitForTimeout(800);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    expect.soft(aperte, 'sessione scaduta nel riquadro').toContain(ids.RiqScaduta);
    expect.soft(aperte, 'mandato bene nel riquadro').not.toContain(ids.RiqOk);
  } finally { await sito.chiudi(); }
});

test('una parola d’accesso già nella pagina di partenza e l’accesso in una colonna laterale non dicono «sessione scaduta» (#1808)', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    // Percorso e titolo dicono «accesso» già prima dell'invio: mandato bene, la scheda si archivia.
    const area = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Accesso clienti</title>
      <form method="post" action="/accesso/inviato"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`, { percorso: 'accesso/scrivici' }));
    ids.area = await scriviEPubblica(shell, area, 'Accesso clienti', area.locator('#c'));
    // Da una pagina così la sessione scade davvero: la risposta è la pagina d'accesso, la scheda resta aperta.
    const scade = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Reclami | Accesso clienti</title>
      <form method="post" action="/scaduta"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`, { percorso: 'accesso/reclamo' }));
    await scade.locator('#c').click();
    await scade.keyboard.type(POST);
    ids.scade = await sporca(shell, 'Reclami | Accesso clienti');
    await scade.locator('#pub').click();
    await expect.poll(async () => (await schede(shell)).find((t) => t.id === ids.scade)?.title, { timeout: 10_000 }).toBe('Accedi');
    await scade.waitForTimeout(800);
    // L'accesso nella colonna laterale c'è solo nella pagina di ringraziamento.
    const lato = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Scrivici</title>
      <form method="post" action="/contatto-lato-dopo"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`));
    ids.lato = await scriviEPubblica(shell, lato, 'Scrivici', lato.locator('#c'));
    const aperte = await archiviaTutto(app, shell, sito);
    expect.soft(aperte, 'parola d’accesso già prima, mandato bene').not.toContain(ids.area);
    expect.soft(aperte, 'parola d’accesso già prima, sessione scaduta').toContain(ids.scade);
    expect.soft(aperte, 'accesso laterale solo nella pagina dopo').not.toContain(ids.lato);
  } finally { await sito.chiudi(); }
});

// Un editor classico in un riquadro nato con srcdoc ha il suo Filo, ma il modulo che ne porta il testo sta nella pagina.
const EDITOR_SRCDOC = '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style=\'min-height:100px\'></body>"></iframe>';
const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';

test('un editor in un riquadro nato con srcdoc, mandato e respinto, tiene aperta la scheda; mandato bene no (#1808.2)', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const campi = {
      'campo nascosto a più righe': '<textarea name="corpo" id="nasc" style="display:none"></textarea>',
      'campo nascosto di una riga': '<input type="hidden" name="corpo" id="nasc">',
    };
    const invii = {
      bottone: ['<button id="pub">Invia</button>', "f.addEventListener('submit', () => { nasc.value = ifr.contentDocument.body.innerHTML; });"],
      script: ['<a href="#" id="pub">Pubblica</a>', "pub.onclick = (e) => { e.preventDefault(); nasc.value = ifr.contentDocument.body.innerHTML; f.submit(); };"],
    };
    const respinti = {};
    const arrivati = {};
    let k = 0;
    for (const [azione, attesa, dove] of [['/err500', 'Errore', respinti], ['/ok', 'Fatto', arrivati]]) {
      for (const [nc, campo] of Object.entries(campi)) for (const [ni, [el, script]] of Object.entries(invii)) {
        if (dove === arrivati && nc !== 'campo nascosto a più righe') continue;
        const titolo = `Editor${++k}`;
        const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
          <form id="f" method="post" action="${azione}">${campo}${EDITOR_SRCDOC}${el}</form><script>${script}</script>`));
        await page.frameLocator('#ifr').locator('body').click();
        await page.keyboard.type(LETTERA);
        // Il correttore di Filo non deve entrare nell'editor: prendeva il cursore e mangiava le lettere.
        await expect(page.frameLocator('#ifr').locator('body')).toHaveText(LETTERA);
        const id = await sporca(shell, titolo);
        await page.locator('#pub').click();
        await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).toBe(attesa);
        await page.waitForTimeout(600);
        dove[`${nc}, invio da ${ni}`] = id;
      }
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(respinti)) expect.soft(aperte, `respinto: ${nome}`).toContain(id);
    for (const [nome, id] of Object.entries(arrivati)) expect.soft(aperte, `arrivato: ${nome}`).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('un modulo mandato da uno script e rimandato indietro col testo e un errore tiene aperta la scheda come dal bottone (#1808.2)', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    let k = 0;
    // L'invio subito dopo l'ultimo tasto: la pagina se ne va prima della rilettura a riposo.
    for (const [nome, invio] of [
      ['bottone', '<button id="pub">Invia</button>'],
      ['script', '<a href="#" id="pub" onclick="f.submit();return false">Pubblica</a>'],
    ]) {
      const titolo = `Forum${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="/rifai"><textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea>${invio}</form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await expect.poll(async () => (await schede(shell)).find((t) => t.id === ids[nome])?.title, { timeout: 10_000 }).toBe('Rispondi');
      await page.waitForTimeout(800);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, `invio da ${nome}`).toContain(id);
  } finally { await sito.chiudi(); }
});
