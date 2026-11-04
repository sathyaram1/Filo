// #1808 giro 2: la pulizia rifatta punto per punto sulla spec del pacchetto, coi passi dell'utente.
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
    req.on('data', () => {});
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
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
    if (modo === 'battito' || modo === 'battito-ack') timer = setInterval(() => { try { sock.write(frame('{"type":"presenza","online":3}')); } catch (_) {} }, 200);
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
        if (modo === 'eco') sock.write(frame(dati.toString()));
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

// 824.3 A — moduli mandati da uno script della pagina e respinti.
test('824.3A un modulo mandato da script e respinto tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      'collegamento che manda il modulo': { azione: '/err500', corpo: `<a href="#" id="pub" onclick="f.submit();return false">Pubblica</a>` },
      'invio trattenuto e mandato dopo un’attesa': { azione: '/err403', corpo: `<button id="pub">Invia</button><script>f.addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => f.submit(), 1500); });</script>` },
      'sessione scaduta': { azione: '/scaduta', corpo: `<a href="#" id="pub" onclick="f.submit();return false">Pubblica</a>` },
      'modulo costruito al volo da uno script': { azione: null, corpo: `<a href="#" id="pub" onclick="const g=document.createElement('form');g.method='post';g.action='/err500';const h=document.createElement('input');h.type='hidden';h.name='m';h.value=c.value;g.append(h);document.body.append(g);g.submit();return false">Pubblica</a>` },
    };
    let k = 0;
    for (const [nome, { azione, corpo }] of Object.entries(casi)) {
      const titolo = `Forum${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="${azione || '/nulla'}"><textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea>${azione ? corpo : ''}</form>${azione ? '' : corpo}`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await lasciaTitolo(shell, ids[nome], titolo);
      await page.waitForTimeout(600);
    }
    // Editor in un riquadro: il testo sta nel riquadro e si copia nel campo nascosto all'invio.
    const ed = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Editor</title>
      <iframe id="ed" style="width:420px;height:140px" srcdoc="<body contenteditable=true style='min-height:100px'></body>"></iframe>
      <form id="f" method="post" action="/err500"><input type="hidden" name="m" id="h"></form>
      <a href="#" id="pub" onclick="h.value=ed.contentDocument.body.innerText;f.submit();return false">Pubblica</a>`));
    await ed.frameLocator('#ed').locator('body').click();
    await ed.keyboard.type(LETTERA);
    ids['editor in un riquadro'] = await sporca(shell, 'Editor');
    await ed.locator('#pub').click();
    await lasciaTitolo(shell, ids['editor in un riquadro'], 'Editor');
    await ed.waitForTimeout(600);

    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

// 824.4 A — caselle del messaggio con nomi da ricerca.
test('824.4A una casella del messaggio con un nome da ricerca protegge la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      '«Your query» in un’area di testo': '<textarea id="c" name="query" placeholder="Your query" style="width:400px;height:100px"></textarea>',
      '«q» in un’area di testo': '<textarea id="c" name="q" style="width:400px;height:100px"></textarea>',
      '«s» in un’area di testo': '<textarea id="c" name="s" style="width:400px;height:100px"></textarea>',
      '«search» nell’id di un’area di testo': '<textarea id="c" name="search_text" aria-label="Search" style="width:400px;height:100px"></textarea>',
      '«cercasi» nel suggerimento di una riga': '<input id="c" placeholder="Cercasi: descrivi chi cerchi" style="width:400px">',
      '«research» nel suggerimento di una riga': '<input id="c" placeholder="Describe your research project" style="width:400px">',
      'testo lungo in una riga chiamata q': '<input id="c" name="q" style="width:400px">',
    };
    let k = 0;
    for (const [nome, campo] of Object.entries(casi)) {
      const titolo = `Contatti${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title><form method="post" action="/ok">${campo}<button>Send</button></form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      await page.waitForTimeout(900);
      ids[nome] = await idDi(shell, titolo);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.4A una casella di ricerca vera non trattiene la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Negozio</title><form action="/traccia"><input id="c" type="search" name="q" placeholder="Cerca"></form><p>prodotti'));
    await page.locator('#c').click();
    await page.keyboard.type('scarpe rosse');
    await page.waitForTimeout(900);
    const id = await idDi(shell, 'Negozio');
    const aperte = await archiviaTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});

// 824.4 B — modulo in un riquadro di un altro sito.
test('824.4B un modulo in un riquadro di un altro sito mandato e respinto tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      'risposta d’errore': { azione: '/err500', invio: '<button id="pub">Invia</button>' },
      'rete caduta': { azione: '/cade', invio: '<button id="pub">Invia</button>' },
      'sessione scaduta': { azione: '/scaduta', invio: '<button id="pub">Invia</button>' },
      'mandato da script e respinto': { azione: '/err403', invio: '<a href="#" id="pub" onclick="f.submit();return false">Invia</a>' },
    };
    let k = 0;
    for (const [nome, { azione, invio }] of Object.entries(casi)) {
      const titolo = `Incorporato${++k}`;
      const dentro = sito.pagina(`<!doctype html><title>modulo</title><form id="f" method="post" action="${azione}"><textarea id="c" name="m" style="width:380px;height:90px"></textarea>${invio}</form>`, { altra: true });
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title><h1>Contattaci</h1><iframe id="r" src="${dentro}" style="width:460px;height:200px"></iframe>`));
      const fl = page.frameLocator('#r');
      await fl.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await fl.locator('#pub').click();
      await page.waitForTimeout(2000);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.4B un modulo in un riquadro di un altro sito mandato bene non trattiene la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const dentro = sito.pagina('<!doctype html><title>modulo</title><form method="post" action="/ok"><textarea id="c" name="m" style="width:380px;height:90px"></textarea><button id="pub">Invia</button></form>', { altra: true });
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>IncorporatoOk</title><iframe id="r" src="${dentro}" style="width:460px;height:200px"></iframe>`));
    const fl = page.frameLocator('#r');
    await fl.locator('#c').click();
    await page.keyboard.type(LETTERA);
    const id = await sporca(shell, 'IncorporatoOk');
    await fl.locator('#pub').click();
    await expect(fl.locator('body')).toContainText('Ricevuto');
    await page.waitForTimeout(1000);
    const aperte = await archiviaTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});

// 824.4 C — collegamento sempre aperto.
const PAGINA_WS = (titolo, url) => `<!doctype html><title>${titolo}</title>
  <div id="box"><textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Pubblica</button></div><p id="esito"></p>
  <script>const ws = new WebSocket(${JSON.stringify(url)}); window.pronto = new Promise((r) => { ws.onopen = () => r(true); });
    pub.onclick = () => { ws.send(JSON.stringify({ type: 'post', testo: c.value })); box.remove(); esito.textContent = 'Post pubblicato'; };</script>`;

async function postaWs(app, shell, sito, titolo, modo, testo) {
  const page = await apriEsatta(app, shell, sito.pagina(PAGINA_WS(titolo, `${sito.ws}?modo=${modo}`)));
  expect(await page.evaluate(() => window.pronto)).toBe(true);
  await page.locator('#c').click();
  for (const [i, riga] of testo.split('\n').entries()) { if (i) await page.keyboard.press('Enter'); await page.keyboard.type(riga); }
  const id = await sporca(shell, titolo);
  await page.locator('#pub').click();
  await expect(page.locator('#esito')).toHaveText('Post pubblicato');
  await page.waitForTimeout(1500);
  return id;
}

const POST = 'Un post lungo scritto con calma sul consiglio di quartiere di ieri sera';

test('824.4C un post su un collegamento sempre aperto conta come arrivato se il sito lo conferma', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {
      'conferma': await postaWs(app, shell, sito, 'WsAck', 'ack', POST),
      'eco del messaggio': await postaWs(app, shell, sito, 'WsEco', 'eco', POST),
      'conferma, testo su due righe': await postaWs(app, shell, sito, 'WsRighe', 'ack', 'Prima riga del post sul quartiere\nseconda riga con «virgolette» e "doppie"'),
      'conferma in mezzo alle presenze': await postaWs(app, shell, sito, 'WsBattAck', 'battito-ack', POST),
    };
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.4C un post su un collegamento sempre aperto senza conferma tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {
      'errore': await postaWs(app, shell, sito, 'WsErr', 'errore', POST),
      'silenzio': await postaWs(app, shell, sito, 'WsMuto', 'muto', POST),
      'solo presenze': await postaWs(app, shell, sito, 'WsBatt', 'battito', POST),
      'collegamento chiuso dal server': await postaWs(app, shell, sito, 'WsChiude', 'chiude', POST),
    };
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

// 824.6 — campi di una riga mandati senza cambiare pagina.
test('824.6 risultato in una scheda nuova e dialogo «Crea» non trattengono la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const tr = await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Traccia</title><form action="/traccia" target="_blank"><input id="c" name="codice" placeholder="Numero di spedizione"><input id="e" name="email" placeholder="Email"><button id="pub">Traccia la spedizione</button></form>'));
    await tr.locator('#c').click();
    await tr.keyboard.type('RR123456789IT');
    await tr.locator('#e').click();
    await tr.keyboard.type('mario.rossi@example.com');
    ids['risultato in una scheda nuova'] = await sporca(shell, 'Traccia');
    await tr.locator('#pub').click();
    await idDi(shell, 'Spedizione');
    await tr.waitForTimeout(800);

    const li = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Liste</title><ul id="liste"><li>Lavoro</li></ul><button id="nuova">Nuova lista</button>
      <script>nuova.onclick = () => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.innerHTML = '<input id="nome"><button id="crea">Crea</button>'; document.body.append(d);
        crea.onclick = () => { const li = document.createElement('li'); li.textContent = nome.value; liste.append(li); d.remove(); }; };</script>`));
    await li.locator('#nuova').click();
    await li.locator('#nome').click();
    await li.keyboard.type('Spesa della settimana');
    ids['dialogo «Crea»'] = await sporca(shell, 'Liste');
    await li.locator('#crea').click();
    await expect(li.locator('#liste li').last()).toHaveText('Spesa della settimana');
    await li.waitForTimeout(800);

    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.6 dialogo chiuso con Annulla, testo sparito senza ricomparire e risultato d’errore tengono aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const dialogo = (titolo, azione) => `<!doctype html><title>${titolo}</title><ul id="liste"><li>Lavoro</li></ul><button id="nuova">Nuova lista</button>
      <script>nuova.onclick = () => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.innerHTML = '<input id="nome"><button id="crea">Crea</button><button id="annulla">Annulla</button>'; document.body.append(d);
        annulla.onclick = () => d.remove(); crea.onclick = () => { ${azione} d.remove(); }; };</script>`;
    const an = await apriEsatta(app, shell, sito.pagina(dialogo('ListeAnnulla', '')));
    await an.locator('#nuova').click();
    await an.locator('#nome').click();
    await an.keyboard.type('Regali di Natale per la famiglia');
    ids['Annulla'] = await sporca(shell, 'ListeAnnulla');
    await an.locator('#annulla').click();
    await an.waitForTimeout(800);

    const sp = await apriEsatta(app, shell, sito.pagina(dialogo('ListeSparita', '')));
    await sp.locator('#nuova').click();
    await sp.locator('#nome').click();
    await sp.keyboard.type('Regali di Natale per la famiglia');
    ids['Crea senza che il nome ricompaia'] = await sporca(shell, 'ListeSparita');
    await sp.locator('#crea').click();
    await sp.waitForTimeout(800);

    const tr = await apriEsatta(app, shell, sito.pagina('<!doctype html><title>TracciaErr</title><form action="/err500" target="_blank"><input id="c" name="codice" placeholder="Numero di spedizione" style="width:400px"><button id="pub">Traccia</button></form>'));
    await tr.locator('#c').click();
    await tr.keyboard.type('Richiesta di reso per il pacco arrivato rotto, ordine 4471');
    ids['risultato in una scheda nuova con errore'] = await sporca(shell, 'TracciaErr');
    await tr.locator('#pub').click();
    await idDi(shell, 'Errore');
    await tr.waitForTimeout(800);

    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

// 824.3 B e giri passati — accesso in testata, sessione scaduta vera, parole d'accesso nella pagina di partenza.
test('824.3B moduli mandati bene in siti con l’accesso in pagina non trattengono la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      'accesso in testata': ['ContattiT', `${TESTATA}<form method="post" action="/contatto">`],
      'accesso in una colonna solo nel ringraziamento': ['ContattiL', '<form method="post" action="/contatto-lato">'],
      'parola d’accesso nel titolo di partenza': ['Accesso ai servizi - Contatti', '<form method="post" action="/contatto-accesso">'],
    };
    for (const [nome, [titolo, apertura]] of Object.entries(casi)) {
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>${apertura}<textarea id="c" name="m" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await lasciaTitolo(shell, ids[nome], titolo);
      await page.waitForTimeout(800);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('824.3B una sessione scaduta vera tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    const casi = {
      'pagina d’accesso semplice': ['Scuola', '', '/scaduta'],
      'forum con l’accesso in testata e «Accedi» nel titolo': ['Forum - Accedi o registrati', TESTATA, '/rispondi-anonimo'],
    };
    for (const [nome, [titolo, testa, azione]] of Object.entries(casi)) {
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>${testa}<form method="post" action="${azione}"><textarea id="c" name="m" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`));
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      ids[nome] = await sporca(shell, titolo);
      await page.locator('#pub').click();
      await lasciaTitolo(shell, ids[nome], titolo);
      await page.waitForTimeout(800);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});

// Giro 1, rilievo 1: messaggio mostrato nella pagina ma respinto; e la sua controparte accettata.
test('giro1 un messaggio mostrato nella pagina e respinto tiene aperta la scheda, accettato no', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const chat = (titolo, api) => `<!doctype html><title>${titolo}</title><ul id="msg"><li>Marco: ci sei stasera?</li></ul>
      <form id="f"><input id="c" style="width:380px" placeholder="Scrivi un messaggio"></form>
      <script>f.addEventListener('submit', (e) => { e.preventDefault(); const t = c.value; const li = document.createElement('li'); li.textContent = 'Io: ' + t; msg.append(li); c.value = '';
        fetch('${api}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) }).then((r) => { li.dataset.esito = r.ok ? 'ok' : 'no'; }); });</script>`;
    const ids = {};
    for (const [titolo, api] of [['ChatNo', '/api/rifiuta'], ['ChatOk', '/api/ok']]) {
      const page = await apriEsatta(app, shell, sito.pagina(chat(titolo, api)));
      await page.locator('#c').click();
      await page.keyboard.type('Ci vediamo alle otto davanti al cinema Odeon');
      ids[titolo] = await sporca(shell, titolo);
      await page.keyboard.press('Enter');
      await expect(page.locator('#msg li').last()).toHaveAttribute('data-esito', /ok|no/);
      await page.waitForTimeout(800);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    expect.soft(aperte, 'respinto').toContain(ids.ChatNo);
    expect.soft(aperte, 'accettato').not.toContain(ids.ChatOk);
  } finally { await sito.chiudi(); }
});
