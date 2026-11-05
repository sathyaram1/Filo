// Esplorazione della verifica #1808.2 giro 1.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.describe.configure({ timeout: 300_000 });

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
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    let corpo = '';
    req.on('data', (d) => { if (corpo.length < 100_000) corpo += d; });
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
      const q = new URLSearchParams(corpo);
      const m = q.get('messaggio') || q.get('corpo') || '';
      if (percorso === '/err500') return html(500, '<!doctype html><title>Errore</title><p>Errore del server');
      if (percorso === '/err403') return html(403, '<!doctype html><title>Errore</title><p>Il modulo è scaduto, riprova');
      if (percorso === '/scaduta') { res.writeHead(302, { Location: '/accedi' }); res.end(); return; }
      if (percorso === '/accedi') return html(200, '<!doctype html><title>Accedi</title><h1>La sessione è scaduta</h1><form action="/entra" method="post"><input name="u"><input type="password" name="p"><button>Accedi</button></form>');
      if (percorso === '/ok') { res.writeHead(302, { Location: '/fatto' }); res.end(); return; }
      if (percorso === '/fatto') return html(200, '<!doctype html><title>Fatto</title><p>Ricevuto');
      if (percorso === '/rifai') return html(200, `<!doctype html><title>Rispondi</title><p>Il codice di verifica non è corretto, riprova</p><form method="post" action="/rifai"><textarea name="messaggio" style="width:400px;height:100px">${esc(m)}</textarea><input name="captcha"><button>Invia</button></form>`);
      // Come un forum classico con l'editor in un riquadro: rimanda la pagina col testo nel campo nascosto e l'errore.
      if (percorso === '/rifai-editor') return html(200, `<!doctype html><title>Rispondi</title><p>Il messaggio è troppo corto</p><form id="f" method="post" action="/rifai-editor"><textarea name="corpo" id="nasc" style="display:none">${esc(m)}</textarea><iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style='min-height:100px'>${esc(m)}</body>"></iframe><button id="pub">Invia</button></form>`);
      // Errore 200 senza il testo: la casella torna vuota.
      if (percorso === '/corto') return html(200, '<!doctype html><title>Rispondi</title><p class="errore">Il messaggio è troppo corto, riprova</p><form method="post" action="/corto"><textarea name="messaggio" style="width:400px;height:100px"></textarea><button>Invia</button></form>');
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      html(200, p);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origine = `http://127.0.0.1:${port}`;
  return {
    origine,
    pagina(h) { const id = `p${++n}`; pagine.set(id, h); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';

async function attendiSporca(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  return (await schede(shell)).find((t) => t.title === titolo).id;
}

// Strade d'invio del modulo `f`. `prima` è lo script che copia il testo prima dell'invio.
const INVII = {
  bottone: (prima) => ['<button id="pub">Invia</button>', `f.addEventListener('submit', () => { ${prima} });`],
  script: (prima) => ['<a href="#" id="pub">Pubblica</a>', `pub.onclick = (e) => { e.preventDefault(); ${prima} f.submit(); };`],
  requestSubmit: (prima) => ['<a href="#" id="pub">Pubblica</a>', `pub.onclick = (e) => { e.preventDefault(); ${prima} f.requestSubmit(); };`],
  scriptDifferito: (prima) => ['<a href="#" id="pub">Pubblica</a>', `pub.onclick = (e) => { e.preventDefault(); ${prima} setTimeout(() => f.submit(), 300); };`],
};

const titoloAtteso = { '/err500': 'Errore', '/err403': 'Errore', '/scaduta': 'Accedi', '/ok': 'Fatto', '/rifai': 'Rispondi', '/rifai-editor': 'Rispondi', '/corto': 'Rispondi' };

test('area di testo: ogni strada d’invio per ogni risposta', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ris = {};
    let k = 0;
    for (const azione of ['/rifai', '/err500', '/scaduta', '/corto', '/ok']) {
      for (const [ni, f] of Object.entries(INVII)) {
        const [el, script] = f('');
        const titolo = `Area${++k}`;
        const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
          <form id="f" method="post" action="${azione}"><textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea>${el}</form><script>${script}</script>`));
        await page.locator('#c').click();
        await page.keyboard.type(LETTERA);
        const id = await attendiSporca(shell, titolo);
        await page.locator('#pub').click();
        await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).toBe(titoloAtteso[azione]);
        await page.waitForTimeout(700);
        ris[`${azione} ${ni}`] = id;
      }
    }
    const aperte = await archiviaTutto(app, shell, sito);
    const esito = Object.fromEntries(Object.entries(ris).map(([k2, id]) => [k2, aperte.includes(id) ? 'aperta' : 'archiviata']));
    console.log('AREA', JSON.stringify(esito, null, 1));
  } finally { await sito.chiudi(); }
});

test('area di testo: invio in fretta, subito dopo l’ultimo tasto', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ris = {};
    let k = 0;
    for (const azione of ['/rifai', '/err500']) {
      for (const ni of ['bottone', 'script', 'tastiera']) {
        const titolo = `Fretta${++k}`;
        const el = ni === 'bottone' ? '<button id="pub">Invia</button>' : '';
        const script = ni === 'script' ? "c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); f.submit(); } });" : '';
        const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
          <form id="f" method="post" action="${azione}"><textarea id="c" name="messaggio" style="width:400px;height:100px"></textarea>${el}${ni === 'tastiera' ? '<input id="t" name="titolo">' : ''}</form><script>${script}</script>`));
        if (ni === 'tastiera') {
          await page.locator('#c').click();
          await page.keyboard.type(LETTERA);
          await page.locator('#t').click();
          await page.keyboard.type('Rimborso');
          await page.keyboard.press('Enter');
        } else {
          await page.locator('#c').click();
          await page.keyboard.type(LETTERA);
          if (ni === 'bottone') await page.locator('#pub').click(); else await page.keyboard.press('Control+Enter');
        }
        let id = null;
        await expect.poll(async () => { const t = (await schede(shell)).find((x) => x.url.includes(azione.replace('/', '')) || x.title === titoloAtteso[azione] && !Object.values(ris).includes(x.id)); id = t?.id; return !!t; }, { timeout: 10_000 }).toBe(true);
        await page.waitForTimeout(700);
        ris[`${azione} ${ni}`] = id;
      }
    }
    const aperte = await archiviaTutto(app, shell, sito);
    const esito = Object.fromEntries(Object.entries(ris).map(([k2, id]) => [k2, aperte.includes(id) ? 'aperta' : 'archiviata']));
    console.log('FRETTA', JSON.stringify(esito, null, 1));
  } finally { await sito.chiudi(); }
});

const COPIA = 'nasc.value = ifr.contentDocument.body.innerHTML;';
const RIQUADRI = {
  srcdoc: '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style=\'min-height:100px\'></body>"></iframe>',
  srcdocParagrafo: '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<!doctype html><html><head><style>body{font:16px serif}</style></head><body contenteditable=true style=\'min-height:100px\'><p><br></p></body></html>"></iframe>',
  srcdocDesignMode: '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body style=\'min-height:100px\'></body><script>document.designMode=\'on\'</script>"></iframe>',
  srcdocDaScript: '<span id="posto"></span>',
  scritto: '<iframe id="ifr" style="width:420px;height:120px"></iframe>',
};
const PREPARA = {
  srcdocDaScript: "const fr = document.createElement('iframe'); fr.id = 'ifr'; fr.style.cssText = 'width:420px;height:120px'; fr.srcdoc = \"<body contenteditable=true style='min-height:100px'></body>\"; posto.replaceWith(fr);",
  scritto: "{ const d = ifr.contentDocument; d.open(); d.write(\"<body contenteditable=true style='min-height:100px'></body>\"); d.close(); }",
};

test('editor in un riquadro: forme del riquadro, strade d’invio, risposte', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ris = {};
    let k = 0;
    const casi = [];
    for (const r of Object.keys(RIQUADRI)) for (const azione of ['/err500']) for (const ni of ['bottone', 'script']) casi.push([r, azione, ni]);
    for (const azione of ['/rifai-editor', '/scaduta', '/ok']) for (const ni of ['bottone', 'script', 'requestSubmit']) casi.push(['srcdoc', azione, ni]);
    casi.push(['srcdoc', '/err500', 'requestSubmit'], ['srcdoc', '/err500', 'scriptDifferito'], ['srcdoc', '/ok', 'scriptDifferito']);
    for (const [r, azione, ni] of casi) {
      const [el, script] = INVII[ni](COPIA);
      const titolo = `Ed${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="${azione}"><textarea name="corpo" id="nasc" style="display:none"></textarea>${RIQUADRI[r]}${el}</form><script>${PREPARA[r] || ''}${script}</script>`));
      await page.waitForTimeout(400);
      await page.frameLocator('#ifr').locator('body').click();
      await page.keyboard.type(LETTERA);
      const testo = await page.frameLocator('#ifr').locator('body').innerText();
      let id;
      try { id = await attendiSporca(shell, titolo); } catch (_) { ris[`${r} ${azione} ${ni}`] = `MAI SPORCA (testo «${testo.slice(0, 40)}»)`; continue; }
      await page.locator('#pub').click();
      await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).toBe(titoloAtteso[azione]);
      await page.waitForTimeout(700);
      ris[`${r} ${azione} ${ni}`] = id;
      if (testo.trim() !== LETTERA) ris[`${r} ${azione} ${ni} TESTO`] = testo;
    }
    const aperte = await archiviaTutto(app, shell, sito);
    const esito = Object.fromEntries(Object.entries(ris).map(([k2, id]) => [k2, typeof id === 'number' || /^[\w-]+$/.test(String(id)) ? (aperte.includes(id) ? 'aperta' : 'archiviata') : id]));
    console.log('EDITOR', JSON.stringify(esito, null, 1));
  } finally { await sito.chiudi(); }
});

test('editor in un riquadro col correttore: il testo mandato non porta segni', async ({ app, shell }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false } });
  });
  const sito = await apriSito();
  try {
    const out = {};
    for (const r of ['srcdoc', 'scritto', 'srcdocDesignMode']) {
      const titolo = `Corr-${r}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="/err500"><textarea name="corpo" id="nasc" style="display:none"></textarea>${RIQUADRI[r]}</form><script>${PREPARA[r] || ''}</script>`));
      await page.waitForTimeout(400);
      await page.frameLocator('#ifr').locator('body').click();
      const T = 'sono andatto al mare con mia sorela e ci siamo divertiti tantissimo';
      await page.keyboard.type(T);
      await page.waitForTimeout(3000);
      await page.keyboard.type(' davvero');
      await page.waitForTimeout(1500);
      const html = await page.frameLocator('#ifr').locator('body').evaluate((b) => b.innerHTML);
      const testo = await page.frameLocator('#ifr').locator('body').evaluate((b) => b.innerText);
      out[r] = { uguale: testo.trim() === `${T} davvero`, testo, html: html.slice(0, 300) };
    }
    console.log('CORRETTORE', JSON.stringify(out, null, 1));
  } finally { await sito.chiudi(); }
});
