// #824 giro 6: esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

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

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}

// Un sito con le sue risposte: pagine, rifiuti, connessione che cade, anteprime, suggerimenti.
async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso, qs] = req.url.split('?');
    const params = new URLSearchParams(qs || '');
    let corpo = '';
    req.on('data', (c) => { if (corpo.length < 100_000) corpo += c; });
    req.on('end', () => {
      if (percorso === '/api/rispondi') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errore: 'Devi accedere per rispondere' }));
        return;
      }
      if (percorso === '/api/manda') { req.socket.destroy(); return; }
      if (percorso === '/api/anteprima') {
        let t = '';
        try { t = JSON.parse(corpo).testo || ''; } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>' + t.replace(/[<&]/g, '').replace(/\n/g, '<br>') + '</p>');
        return;
      }
      if (percorso === '/api/carica') { res.writeHead(200); res.end('ok'); return; }
      if (percorso === '/suggerimenti') {
        const q = (params.get('q') || '').toLowerCase();
        const tutti = [['Milano Malpensa (MXP)', 'MXP'], ['Milano Linate (LIN)', 'LIN'], ['Parigi Charles de Gaulle (CDG)', 'CDG']];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tutti.filter(([nome]) => nome.toLowerCase().startsWith(q))));
        return;
      }
      if (percorso === '/voli') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ prezzo: 49 }]));
        return;
      }
      const html = pagine.get(percorso.replace(/^\//, ''));
      if (!html) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(html) { const id = `p${++n}`; pagine.set(id, html); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

test('rifiuto del server, connessione caduta, anteprima dal server: il testo non è partito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const sito = await apriSito();
  try {
    const rifiutata = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Rifiutata</title></head><body>
      <textarea id="corpo" style="width:400px;height:100px"></textarea><button id="pub">Pubblica la risposta</button><p id="err"></p>
      <script>pub.onclick = async () => { const r = await fetch('/api/rispondi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: corpo.value }) });
        if (!r.ok) err.textContent = (await r.json()).errore; };</script>
      </body></html>`));
    await rifiutata.locator('#corpo').click();
    await rifiutata.keyboard.type('Il problema nasce dal ciclo che non si ferma mai');
    await expect.poll(() => moduloDi(shell, 'Rifiutata'), { timeout: 8_000 }).toBe(true);
    await rifiutata.locator('#pub').click();
    await expect(rifiutata.locator('#err')).toHaveText('Devi accedere per rispondere');
    await rifiutata.waitForTimeout(800);

    const caduta = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Caduta</title></head><body>
      <textarea id="mail" style="width:400px;height:100px"></textarea><button id="invia">Invia</button><p id="err"></p>
      <script>invia.onclick = async () => { try { await fetch('/api/manda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corpo: mail.value }) }); }
        catch (_) { err.textContent = 'Non sono riuscito a inviare: controlla la connessione'; } };</script>
      </body></html>`));
    await caduta.locator('#mail').click();
    await caduta.keyboard.type('Ciao Marco, ti mando il riepilogo della riunione di ieri');
    await expect.poll(() => moduloDi(shell, 'Caduta'), { timeout: 8_000 }).toBe(true);
    await caduta.locator('#invia').click();
    await expect(caduta.locator('#err')).toHaveText(/controlla la connessione/);
    await caduta.waitForTimeout(800);

    const anteprima = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Commento</title></head><body>
      <textarea id="c" style="width:400px;height:100px"></textarea><button id="ant">Anteprima</button><button id="com">Commenta</button><div id="vista"></div>
      <script>ant.onclick = async () => { const r = await fetch('/api/anteprima', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: c.value }) });
        vista.innerHTML = await r.text(); };</script>
      </body></html>`));
    await anteprima.locator('#c').click();
    await anteprima.keyboard.type('Ho provato la patch e il crash sparisce');
    await anteprima.keyboard.press('Enter');
    await anteprima.keyboard.type('resta solo il problema del tema scuro');
    await expect.poll(() => moduloDi(shell, 'Commento'), { timeout: 8_000 }).toBe(true);
    await anteprima.locator('#ant').click();
    await expect(anteprima.locator('#vista')).toContainText('Ho provato la patch');
    await anteprima.waitForTimeout(800);

    const stati = { Rifiutata: await moduloDi(shell, 'Rifiutata'), Caduta: await moduloDi(shell, 'Caduta'), Commento: await moduloDi(shell, 'Commento') };
    console.log('formDirty prima della pulizia', JSON.stringify(stati));
    await pulisciTutto(app, shell, sito);
    const aperte = await titoliAperti(shell);
    console.log('aperte', JSON.stringify(aperte));
    expect.soft(aperte).toContain('Rifiutata');
    expect.soft(aperte).toContain('Caduta');
    expect.soft(aperte).toContain('Commento');
  } finally { await sito.chiudi(); }
});

test('voli scelti dai suggerimenti: la ricerca parte coi codici e la scheda resta protetta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const sito = await apriSito();
  try {
    const voli = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Voli</title></head><body>
      <div><input id="da" placeholder="Da dove parti?" autocomplete="off"><input id="a" placeholder="Dove vuoi andare?" autocomplete="off"><button id="cerca">Cerca voli</button></div>
      <ul id="sug"></ul><ul id="ris"></ul>
      <script>const codici = {};
        for (const campo of [da, a]) campo.addEventListener('input', async () => {
          const l = await (await fetch('/suggerimenti?q=' + encodeURIComponent(campo.value))).json();
          sug.innerHTML = ''; for (const [nome, cod] of l) { const li = document.createElement('li'); li.textContent = nome;
            li.onclick = () => { campo.value = nome; codici[campo.id] = cod; sug.innerHTML = ''; }; sug.append(li); } });
        cerca.onclick = async () => { await fetch('/voli?da=' + codici.da + '&a=' + codici.a + '&data=2026-11-03');
          ris.innerHTML = '<li>' + da.value + ' → ' + a.value + ' 49 €</li>'; };</script>
      </body></html>`));
    await voli.locator('#da').click();
    await voli.keyboard.type('Mil');
    await voli.locator('#sug li', { hasText: 'Malpensa' }).click();
    await voli.locator('#a').click();
    await voli.keyboard.type('Par');
    await voli.locator('#sug li', { hasText: 'Charles' }).click();
    await voli.locator('#cerca').click();
    await expect(voli.locator('#ris li')).toContainText('49 €');
    await voli.waitForTimeout(800);
    console.log('formDirty voli', await moduloDi(shell, 'Voli'));
    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Voli');
  } finally { await sito.chiudi(); }
});

test('post con una parola in grassetto, mandato in Markdown dalla finestrella: la scheda resta protetta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const sito = await apriSito();
  try {
    const social = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Social</title></head><body>
      <main><p>Il tuo feed</p></main>
      <div id="modale" role="dialog"><div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div><button id="pub">Pubblica</button></div><p id="toast"></p>
      <script>const md = (n) => [...n.childNodes].map((c) => c.nodeType === 3 ? c.textContent : (/^(b|strong)$/i.test(c.tagName) ? '**' + md(c) + '**' : md(c))).join('');
        pub.onclick = () => { fetch('/api/carica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post: md(ed) }) }); modale.remove(); toast.textContent = 'Post pubblicato'; };</script>
      </body></html>`));
    await social.locator('#ed').click();
    await social.keyboard.type('Oggi ho ');
    await social.keyboard.press('Control+b');
    await social.keyboard.type('finito');
    await social.keyboard.press('Control+b');
    await social.keyboard.type(' la maratona di Firenze');
    await social.waitForTimeout(600);
    console.log('html editor', await social.locator('#ed').innerHTML());
    await social.locator('#pub').click();
    await expect(social.locator('#toast')).toHaveText('Post pubblicato');
    await social.waitForTimeout(800);
    console.log('formDirty social', await moduloDi(shell, 'Social'));
    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Social');
  } finally { await sito.chiudi(); }
});

test('modulo di contatto mandato a un servizio di moduli su un altro sito e sostituito dal grazie', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const sito = await apriSito();
  try {
    const servizio = testServer.originPubblico + '/f/abc';
    const contatti = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Contatti</title></head><body>
      <form id="f"><input id="nome" placeholder="Nome"><textarea id="msg" style="width:400px;height:100px"></textarea><button>Invia</button></form>
      <script>f.addEventListener('submit', async (e) => { e.preventDefault();
        await fetch('${servizio}', { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ nome: nome.value, messaggio: msg.value }) }).catch(() => {});
        f.outerHTML = '<p id="grazie">Grazie, ti risponderemo presto</p>'; });</script>
      </body></html>`));
    await contatti.locator('#nome').click();
    await contatti.keyboard.type('Laura');
    await contatti.locator('#msg').click();
    await contatti.keyboard.type('Vorrei un preventivo per la cucina');
    await contatti.locator('button').click();
    await expect(contatti.locator('#grazie')).toBeVisible();
    await contatti.waitForTimeout(800);
    console.log('formDirty contatti', await moduloDi(shell, 'Contatti'));
    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Contatti');
  } finally { await sito.chiudi(); }
});

test('caricamento grande da una scheda con una bozza: quanto si ferma Filo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const sito = await apriSito();
  try {
    const pagina = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Carica</title></head><body>
      <textarea id="t" style="width:400px;height:100px"></textarea>
      <script>window.carica = async (tipo, volte) => { const b = new Uint8Array(4 * 1024 * 1024); for (let i = 0; i < b.length; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536));
        for (let i = 0; i < volte; i++) await fetch('/api/carica', { method: 'POST', body: tipo === 'blob' ? new Blob([b]) : b }); };</script>
      </body></html>`));
    const misura = async (fn) => {
      await app.evaluate(() => { globalThis.__lag = 0; let ult = Date.now(); clearInterval(globalThis.__lagT);
        globalThis.__lagT = setInterval(() => { const ora = Date.now(); globalThis.__lag = Math.max(globalThis.__lag, ora - ult - 20); ult = ora; }, 20); });
      const t0 = Date.now();
      await fn();
      const ms = Date.now() - t0;
      const lag = await app.evaluate(() => { clearInterval(globalThis.__lagT); return globalThis.__lag; });
      return { ms, lag };
    };
    const senza = await misura(() => pagina.evaluate(() => window.carica('bytes', 5)));
    await pagina.locator('#t').click();
    await pagina.keyboard.type('Bozza della didascalia per il video');
    await expect.poll(() => moduloDi(shell, 'Carica'), { timeout: 8_000 }).toBe(true);
    const con = await misura(() => pagina.evaluate(() => window.carica('bytes', 5)));
    const blob = await misura(() => pagina.evaluate(() => window.carica('blob', 5)));
    console.log('carica senza bozza', JSON.stringify(senza), 'con bozza', JSON.stringify(con), 'blob con bozza', JSON.stringify(blob));
  } finally { await sito.chiudi(); }
});
