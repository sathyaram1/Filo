// #814 — tre segnali che non dipendono da chi è il sito arrivano dalla scheda vera al rilevatore e cambiano l'avviso:
// un programma partito senza un clic, un file col nome di un documento, un modulo https che manda i dati in chiaro.
// L'origine del link arriva al giudizio AI. Pagine servite intercettando http e https, come in safebrowse.spec.mjs;
// senza il passaggio dei segnali nessun avviso compare e il giudizio legge «sconosciuta».

import { test, expect } from './fixtures/electron.mjs';

const EXE = 'MZ finto eseguibile di prova\n' + 'z'.repeat(2048);

// Ogni indirizzo in `pagine` è HTML; un .exe che non c'è scende come allegato, col suo nome. Il giudice AI annota cosa
// riceve; l'età del dominio la dà `eta`.
async function servi(app, pagine, { eta = {} } = {}) {
  await app.evaluate(async ({ session, net }, { pg, eta, exe }) => {
    globalThis.__sbMeta = [];
    const nostri = new Set(Object.keys(pg).map((k) => k.split('/')[0]));
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (/\.exe$/i.test(u.pathname)) {
        const nome = decodeURIComponent(u.pathname.split('/').pop());
        return new Response(exe, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${nome}"` } });
      }
      if (nostri.has(u.hostname)) return new Response('', { status: 404 });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: null, ct: null, sandbox: null,
      rdap: async (reg) => (reg in eta ? eta[reg] : null),
      llm: async (meta) => { globalThis.__sbMeta.push(meta); return { suspicious: false, reason: null }; },
    });
  }, { pg: pagine, eta, exe: EXE });
}

// L'avviso della scheda che mostra `host`: aspetta che compaia (fino a `ms`), o che arrivi `livello`.
async function avvisoDi(app, host, { ms = 9000, livello = null } = {}) {
  const fine = Date.now() + ms;
  let a = null;
  for (;;) {
    a = await app.evaluate(({ BrowserWindow }, h) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
          let qui = '';
          try { qui = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
          if (qui !== h) continue;
          const m = t.sbAvviso && t.sbAvviso.message;
          return { level: t.sbLevel || 'safe', title: m ? m.title : '', body: m ? m.body : '' };
        }
      }
      return { level: 'nessuna scheda', title: '', body: '' };
    }, host);
    const arrivato = livello ? a.level === livello : (a.level === 'sospetto' || a.level === 'pericoloso');
    if (arrivato || Date.now() >= fine) return a;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function vistaAvviso(app, ms = 8000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la vista dell\'avviso non è nata');
}

const scaricamenti = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const statoDi = async (shell, nome) => ((await scaricamenti(shell)).find((it) => it.filename === nome) || {}).state ?? null;

const PULSANTE = 'style="display:inline-block;padding:24px;font-size:20px"';

test('una pagina che al caricamento fa partire un programma, senza clic: sospetto col messaggio, e la domanda sugli scaricamenti resta', async ({ app, shell, openTab }) => {
  await servi(app, {
    'scarica-subito.it/': '<title>Download</title><p>Il programma sta arrivando</p>'
      + '<script>addEventListener("load", () => { location.href = "/setup.exe"; });</script>',
  });
  await openTab('https://scarica-subito.it/');
  const a = await avvisoDi(app, 'scarica-subito.it');
  expect(a.level).toBe('sospetto');
  expect(a.body).toContain('ha avviato da sola lo scaricamento di un programma («setup.exe»)');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Scaricamento partito da solo')).toBeVisible({ timeout: 6000 });
  await expect(avviso.getByText(/ha avviato da sola lo scaricamento/)).toBeVisible();
  await avviso.screenshot({ path: 'tests/.shots/814-scaricamento-partito-da-solo.png' }).catch(() => {});
  // La domanda di #588 non cambia: il programma aspetta la risposta fuori dalla cartella Download.
  await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('pending');
});

// Le altre strade con cui una pagina fa partire un programma da sola: una scheda nuova che diventa subito il file, un
// riquadro nascosto. Il sito da avvisare è sempre la pagina.
test('un programma partito da solo da una scheda aperta dalla pagina o da un riquadro nascosto: sospetto sulla pagina', async ({ app, openTab }) => {
  await servi(app, {
    'apre-schede.it/': '<p>Offerta</p><script>addEventListener("load", () => { window.open("/regalo.exe"); });</script>',
    'riquadro-nascosto.it/': '<p>Notizie</p><iframe src="/lettore.exe" style="display:none"></iframe>',
  });
  await openTab('https://apre-schede.it/');
  const scheda = await avvisoDi(app, 'apre-schede.it');
  expect(scheda.level).toBe('sospetto');
  expect(scheda.body).toContain('ha avviato da sola lo scaricamento di un programma («regalo.exe»)');

  await openTab('https://riquadro-nascosto.it/');
  const riquadro = await avvisoDi(app, 'riquadro-nascosto.it');
  expect(riquadro.level).toBe('sospetto');
  expect(riquadro.body).toContain('ha avviato da sola lo scaricamento di un programma («lettore.exe»)');
});

test('un programma partito da solo su un dominio registrato da pochi giorni: pericoloso', async ({ app, openTab }) => {
  await servi(app, {
    'scarica-giovane.it/': '<p>Download</p><script>setTimeout(() => { location.href = "/aggiorna.exe"; }, 300);</script>',
  }, { eta: { 'scarica-giovane.it': 3 } });
  await openTab('https://scarica-giovane.it/');
  const a = await avvisoDi(app, 'scarica-giovane.it', { livello: 'pericoloso' });
  expect(a.level).toBe('pericoloso');
  expect(a.body).toContain('ha avviato da sola lo scaricamento di un programma («aggiorna.exe»)');
  expect(a.body).toContain('registrato 3 giorni fa');
});

test('un clic su «Scarica» che porta alla pagina di ringraziamento, o un clic diretto sul file: nessun avviso', async ({ app, shell, openTab }) => {
  await servi(app, {
    'programmi-buoni.it/': `<a id="scarica" href="/grazie" ${PULSANTE}>Scarica</a>`,
    'programmi-buoni.it/grazie': '<p>Grazie! Il download partirà a breve.</p>'
      + '<script>setTimeout(() => { location.href = "/setup.exe"; }, 1000);</script>',
    'programmi-diretti.it/': `<a id="diretto" href="/installa.exe" ${PULSANTE}>Scarica il programma</a>`,
  });
  const ringrazia = await openTab('https://programmi-buoni.it/');
  await ringrazia.click('#scarica');
  await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('pending');
  await ringrazia.waitForTimeout(1500);
  expect((await avvisoDi(app, 'programmi-buoni.it', { ms: 0 })).level).toBe('safe');

  const diretta = await openTab('https://programmi-diretti.it/');
  await diretta.click('#diretto');
  await expect.poll(() => statoDi(shell, 'installa.exe'), { timeout: 10000 }).toBe('pending');
  await diretta.waitForTimeout(1500);
  expect((await avvisoDi(app, 'programmi-diretti.it', { ms: 0 })).level).toBe('safe');
});

test('doppia estensione: aprire /fattura.pdf.exe, o scaricare fattura.pdf.exe con un clic, mostra l\'avviso', async ({ app, shell, openTab }) => {
  await servi(app, {
    'documenti-fattura.it/fattura.pdf.exe': '<title>Fattura</title><p>Visualizza la fattura</p>',
    'archivio-fatture.it/': `<a id="fattura" href="/fattura.pdf.exe" ${PULSANTE}>Fattura di marzo</a>`,
  });
  await openTab('https://documenti-fattura.it/fattura.pdf.exe');
  const aperta = await avvisoDi(app, 'documenti-fattura.it');
  expect(aperta.level).toBe('sospetto');
  expect(aperta.body).toContain('finisce con «fattura.pdf.exe», che sembra un documento ma è un programma');

  const archivio = await openTab('https://archivio-fatture.it/');
  await archivio.click('#fattura');
  const scaricata = await avvisoDi(app, 'archivio-fatture.it');
  expect(scaricata.level).toBe('sospetto');
  expect(scaricata.title).toBe('Programma travestito da documento');
  expect(scaricata.body).toContain('ti fa scaricare «fattura.pdf.exe»');
  // Il clic c'è stato: il file non è partito da solo.
  expect(scaricata.body).not.toContain('da sola');
  await expect.poll(() => statoDi(shell, 'fattura.pdf.exe'), { timeout: 10000 }).toBe('pending');
});

const MODULO = (azione, extra = '') => `<title>Accedi</title><form action="${azione}" method="post">`
  + '<input name="utente" placeholder="Utente"><input type="password" name="pw" placeholder="Password">'
  + `${extra}<button>Entra</button></form>`;

test('un modulo password su https che invia a http: sospetto coi dati in chiaro, anche su un sito in whitelist', async ({ app, openTab }) => {
  await servi(app, {
    'banca-esempio.it/accesso': MODULO('http://banca-esempio.it/entra'),
    'www.amazon.it/accesso': MODULO('http://www.amazon.it/entra'),
    'negozio-esempio.it/paga': '<form action="/paga"><input autocomplete="cc-number" placeholder="Numero della carta">'
      + '<button formaction="http://negozio-esempio.it/paga">Paga</button></form>',
    'banca-sicura.it/accesso': MODULO('https://banca-sicura.it/entra'),
  });
  for (const [url, host] of [
    ['https://banca-esempio.it/accesso', 'banca-esempio.it'],
    ['https://www.amazon.it/accesso', 'www.amazon.it'],
    ['https://negozio-esempio.it/paga', 'negozio-esempio.it'],
  ]) {
    const page = await openTab(url);
    const a = await avvisoDi(app, host);
    expect(a.level, host).toBe('sospetto');
    expect(a.title, host).toBe('Dati in chiaro');
    expect(a.body, host).toContain('I dati che scrivi qui viaggiano in chiaro');
    if (host === 'banca-esempio.it') {
      const avviso = await vistaAvviso(app);
      await expect(avviso.getByText('Dati in chiaro')).toBeVisible({ timeout: 6000 });
      await avviso.screenshot({ path: 'tests/.shots/814-dati-in-chiaro.png' }).catch(() => {});
    }
    await page.close().catch(() => {});
  }
  // Lo stesso modulo che invia in https non dice niente.
  await openTab('https://banca-sicura.it/accesso');
  expect((await avvisoDi(app, 'banca-sicura.it', { ms: 2500 })).level).toBe('safe');
});

test('l\'origine del link arriva al giudizio AI: link cliccato su un altro sito (anche in una scheda nuova), pagina aperta da Filo, indirizzo scritto', async ({ app, openTab }) => {
  await servi(app, {
    'partenza-notizie.it/': `<a id="nuova" href="http://scheda-nuova-esempio.it/accesso" target="_blank" ${PULSANTE}>Offerte</a>`
      + `<a id="vai" href="http://area-clienti-esempio.it/accesso" ${PULSANTE}>Area clienti</a>`,
    'scheda-nuova-esempio.it/accesso': MODULO('/entra'),
    'area-clienti-esempio.it/accesso': MODULO('/entra'),
    'aperto-da-filo.it/accesso': MODULO('/entra'),
    'scritto-a-mano.it/accesso': MODULO('/entra'),
  });
  const metaDi = (host) => app.evaluate((_e, h) => (globalThis.__sbMeta || []).find((m) => m.host === h) || null, host);

  const partenza = await openTab('https://partenza-notizie.it/');
  // Un link che apre una scheda nuova vale come quello che resta nella scheda.
  await partenza.click('#nuova');
  await expect.poll(() => metaDi('scheda-nuova-esempio.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('scheda-nuova-esempio.it')).linkOrigin).toBe('link cliccato su un altro sito (partenza-notizie.it)');
  await partenza.click('#vai');
  await expect.poll(() => metaDi('area-clienti-esempio.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('area-clienti-esempio.it')).linkOrigin).toBe('link cliccato su un altro sito (partenza-notizie.it)');

  await openTab('http://aperto-da-filo.it/accesso');
  await expect.poll(() => metaDi('aperto-da-filo.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('aperto-da-filo.it')).linkOrigin).toBe('pagina aperta da Filo');

  // La barra della home manda quello che l'utente ha scritto insieme all'indirizzo.
  const home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
  await home.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'open_url', url: 'http://scritto-a-mano.it/accesso', parole: ['scritto-a-mano.it/accesso'] }, ok)));
  await expect.poll(() => metaDi('scritto-a-mano.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('scritto-a-mano.it')).linkOrigin).toBe('indirizzo scritto a mano');
});

// Le schede che Filo apre per conto d'altri portano il clic che le ha chieste e il sito da cui arrivano: chi non lo dice
// non diventa «aperta da Filo», la provenienza più rassicurante per il giudice.
test('un clic su un collegamento in una pagina di Filo verso una pagina di ringraziamento: nessun avviso', async ({ app, shell }) => {
  await servi(app, {
    'programmi-filo.it/grazie': '<p>Grazie, il download partirà a breve</p>'
      + '<script>setTimeout(() => { location.href = "/setup.exe"; }, 1000);</script>',
  });
  let home = null;
  for (let i = 0; i < 100 && !home; i++) {
    home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!home && i === 0) await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    if (!home) await new Promise((r) => setTimeout(r, 100));
  }
  await home.waitForLoadState('domcontentloaded');
  await home.evaluate((stile) => {
    const a = document.createElement('a');
    a.id = 'link-prova'; a.href = 'https://programmi-filo.it/grazie'; a.target = '_blank'; a.textContent = 'Scarica';
    a.setAttribute('style', `${stile};position:fixed;top:120px;left:120px;z-index:99999;background:#fff`);
    document.body.appendChild(a);
  }, 'display:inline-block;padding:24px;font-size:20px');
  await home.click('#link-prova');
  await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('pending');
  const a = await avvisoDi(app, 'programmi-filo.it', { ms: 2500 });
  expect(a.level, a.body).toBe('safe');
});

test('un popup fermato e aperto con «Apri» arriva al giudizio AI dal sito che l\'ha chiesto, non da Filo', async ({ app, shell, openTab }) => {
  await servi(app, {
    'apre-popup.it/': `<button id="b" ${PULSANTE} onclick="window.open('http://popup-accesso-esempio.it/accesso','p','width=400,height=400')">Apri</button>`,
    'popup-accesso-esempio.it/accesso': MODULO('/entra'),
  });
  const p = await openTab('https://apre-popup.it/');
  await p.click('#b');
  const tabId = await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        try { if (new URL(t.view.webContents.getURL()).hostname === 'apre-popup.it') return t.id; } catch (_) {}
      }
    }
    return null;
  });
  await shell.evaluate(({ id }) => window.filoShell.tabs.openBlockedPopup('http://popup-accesso-esempio.it/accesso', false, id), { id: tabId });
  const metaDi = (host) => app.evaluate((_e, h) => (globalThis.__sbMeta || []).find((m) => m.host === h) || null, host);
  await expect.poll(() => metaDi('popup-accesso-esempio.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('popup-accesso-esempio.it')).linkOrigin).toBe('reindirizzamento automatico da un altro sito (apre-popup.it)');
});

// Quello che fa l'assistente della pagina quando l'utente gli chiede di aprire un indirizzo: l'azione parte dalla pagina.
async function assistenteApre(app, daHost, url, parole) {
  return app.evaluate(async ({ BrowserWindow }, { daHost, url, parole }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        const wc = t.view.webContents;
        let h = '';
        try { h = new URL(wc.getURL()).hostname; } catch (_) {}
        if (h !== daHost) continue;
        const codice = `new Promise((ok) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'NAVIGA', url: ${JSON.stringify(url)} }, parole: [${JSON.stringify(parole)}] }, (x) => ok(x || null)))`;
        return wc.executeJavaScriptInIsolatedWorld(999, [{ code: codice }]);
      }
    }
    return null;
  }, { daHost, url, parole });
}

// Chiedere a parole a Filo, nella home o all'assistente della pagina, vale un clic; e l'indirizzo che l'assistente apre
// arriva dal sito della pagina, non da Filo.
test('una pagina aperta da Filo su richiesta: la pagina di ringraziamento non dà avvisi, e il link dell\'assistente arriva dal suo sito', async ({ app, openTab }) => {
  await servi(app, {
    'pagina-con-link.it/': `<a href="http://dest-assistente.it/accesso" ${PULSANTE}>Offerta</a>`,
    'dest-assistente.it/accesso': MODULO('/entra'),
    'programmi-assistente.it/': `<a href="/grazie" ${PULSANTE}>Scarica</a>`,
    'programmi-assistente.it/grazie': '<p>Grazie</p><script>setTimeout(() => { location.href = "/setup.exe"; }, 1000);</script>',
    'programmi-chat.it/grazie': '<p>Grazie</p><script>setTimeout(() => { location.href = "/installa.exe"; }, 1000);</script>',
  });
  const metaDi = (host) => app.evaluate((_e, h) => (globalThis.__sbMeta || []).find((m) => m.host === h) || null, host);
  const livelliGrazie = () => app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      if (/\/grazie/.test(t.view.webContents.getURL())) out.push([t.view.webContents.getURL(), t.sbLevel || 'safe']);
    }
    return out;
  });

  await openTab('https://pagina-con-link.it/');
  expect((await assistenteApre(app, 'pagina-con-link.it', 'http://dest-assistente.it/accesso', 'apri il link offerta')).opened).toBe(true);
  await expect.poll(() => metaDi('dest-assistente.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('dest-assistente.it')).linkOrigin).toBe('link cliccato su un altro sito (pagina-con-link.it)');

  await openTab('https://programmi-assistente.it/');
  expect((await assistenteApre(app, 'programmi-assistente.it', 'https://programmi-assistente.it/grazie', 'scarica il programma')).opened).toBe(true);

  const home = await openTab('filo://newtab/');
  const r = await home.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'filo_run_action', action: { type: 'NAVIGA', url: 'https://programmi-chat.it/grazie' }, parole: ['scaricami il programma'] }, ok)));
  expect(r && r.opened).toBe(true);

  await expect.poll(async () => (await livelliGrazie()).length, { timeout: 8000 }).toBe(2);
  await new Promise((ok) => setTimeout(ok, 3000));
  for (const [url, livello] of await livelliGrazie()) expect(livello, url).toBe('safe');
});

async function riquadro(p, pezzo) {
  for (let i = 0; i < 80; i++) {
    const f = p.frames().find((x) => x.url().includes(pezzo));
    if (f) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`riquadro ${pezzo} non trovato`);
}

async function clicNelRiquadro(p, pezzo, sel) {
  const fr = await riquadro(p, pezzo);
  await fr.waitForSelector(sel);
  const box = await (await fr.$(sel)).boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Il clic vale per la scheda, in qualunque riquadro e attraverso le pagine di passaggio: è la regola sola del «voluto».
test('un clic su «Scarica» dentro un riquadro di un altro sito, o seguito da una pagina di passaggio, non dà avvisi; il link del riquadro arriva come cliccato', async ({ app, shell, openTab }) => {
  await servi(app, {
    'pagina-con-riquadro.it/': '<h1>Editor</h1><iframe src="https://widget-download.it/w" style="width:500px;height:300px;border:0"></iframe>',
    'widget-download.it/w': `<a id="d" href="/editor.exe" ${PULSANTE}>Scarica</a>`,
    'ponte-programmi.it/': `<a id="s" href="/go?to=grazie" ${PULSANTE}>Scarica</a>`,
    'ponte-programmi.it/go': '<script>location.replace("/grazie")</script>',
    'ponte-programmi.it/grazie': '<p>Grazie</p><script>setTimeout(() => { location.href = "/setup.exe"; }, 1500);</script>',
    'giornale-riquadro.it/': '<h1>Notizie</h1><iframe src="https://annunci-riquadro.it/w" style="width:500px;height:300px;border:0"></iframe>',
    'annunci-riquadro.it/w': `<a id="d" href="http://offerta-riquadro.it/accesso" target="_top" ${PULSANTE}>Offerta</a>`,
    'offerta-riquadro.it/accesso': MODULO('/entra'),
  });
  const conRiquadro = await openTab('https://pagina-con-riquadro.it/');
  await clicNelRiquadro(conRiquadro, 'widget-download.it', '#d');
  await expect.poll(() => statoDi(shell, 'editor.exe'), { timeout: 10000 }).toBe('pending');
  await conRiquadro.waitForTimeout(1500);
  const a = await avvisoDi(app, 'pagina-con-riquadro.it', { ms: 0 });
  expect(a.level, a.body).toBe('safe');

  const ponte = await openTab('https://ponte-programmi.it/');
  await ponte.click('#s');
  await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 12000 }).toBe('pending');
  await ponte.waitForTimeout(1500);
  const b = await avvisoDi(app, 'ponte-programmi.it', { ms: 0 });
  expect(b.level, b.body).toBe('safe');

  const giornale = await openTab('https://giornale-riquadro.it/');
  await clicNelRiquadro(giornale, 'annunci-riquadro.it', '#d');
  const metaDi = (host) => app.evaluate((_e, h) => (globalThis.__sbMeta || []).find((m) => m.host === h) || null, host);
  await expect.poll(() => metaDi('offerta-riquadro.it'), { timeout: 10000 }).not.toBeNull();
  expect((await metaDi('offerta-riquadro.it')).linkOrigin).toBe('link cliccato su un altro sito (annunci-riquadro.it)');
});

// Un indirizzo che è davvero il file: non c'è una pagina, la scheda resta e porta l'avviso.
test('aprire da Filo l\'indirizzo di un fattura.pdf.exe che scende come file: la scheda resta con l\'avviso, pericoloso su un dominio giovane', async ({ app, shell, openTab }) => {
  await servi(app, { 'fatture-online.it/': '<p>Fatture</p>', 'fatture-nuove.it/': '<p>Fatture</p>' }, { eta: { 'fatture-nuove.it': 2 } });
  const avvisi = () => app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      const m = t.sbAvviso && t.sbAvviso.message;
      if (m) out.push({ url: t.sbAvviso.url, level: t.sbAvviso.level, title: m.title, body: m.body, attiva: t.id === w._filoTabs.activeId });
    }
    return out;
  });
  const home = await openTab('filo://newtab/');
  const url = 'https://fatture-online.it/fattura.pdf.exe';
  await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage({ type: 'open_url', url: u, parole: [u] }, ok)), url);
  await expect.poll(() => statoDi(shell, 'fattura.pdf.exe'), { timeout: 10000 }).toBe('pending');
  await expect.poll(async () => (await avvisi()).find((a) => a.url === url) || null, { timeout: 8000 }).not.toBeNull();
  const a = (await avvisi()).find((x) => x.url === url);
  expect(a.level).toBe('sospetto');
  expect(a.attiva).toBe(true);
  expect(a.body).toContain('finisce con «fattura.pdf.exe», che sembra un documento ma è un programma');
  const avviso = await vistaAvviso(app);
  await expect(avviso.getByText('Programma travestito da documento')).toBeVisible({ timeout: 6000 });
  await avviso.screenshot({ path: 'tests/.shots/814-indirizzo-travestito.png' }).catch(() => {});
  // Tenuta solo per l'avviso: andato via l'avviso, la scheda non resta vuota fra le altre.
  const vuote = () => app.evaluate(({ BrowserWindow }) => {
    let n = 0;
    for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (!u || u === 'about:blank') n++;
    }
    return n;
  });
  await avviso.locator('#avanti').click();
  await expect.poll(vuote, { timeout: 6000 }).toBe(0);
  await expect.poll(async () => (await avvisi()).length, { timeout: 6000 }).toBe(0);

  // Chiesto a parole a Filo, su un dominio di due giorni.
  const giovane = 'https://fatture-nuove.it/scarica/fattura.pdf.exe';
  const r = await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'filo_run_action', action: { type: 'NAVIGA', url: u }, parole: ['aprimi la fattura'] }, ok)), giovane);
  expect(r && r.opened).toBe(true);
  await expect.poll(async () => ((await avvisi()).find((x) => x.url === giovane) || {}).level || null, { timeout: 8000 }).toBe('pericoloso');
  const pericolo = await vistaAvviso(app);
  await pericolo.locator('#indietro').click();
  await expect.poll(vuote, { timeout: 6000 }).toBe(0);
  await expect.poll(async () => (await avvisi()).length, { timeout: 6000 }).toBe(0);
});
