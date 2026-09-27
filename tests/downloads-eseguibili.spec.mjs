// #588 — un file che il sistema ESEGUE non entra nella cartella Download senza
// una risposta, e "Apri file" su un programma non lo esegue senza una seconda.
//
// Si asserisce il SUCCESSO dal punto di vista di chi usa Filo:
//   1. un PDF scende come sempre, senza domande (l'attrito va solo dove serve);
//   2. un .exe si ferma: si apre SOPRA la pagina la domanda che dice che è un
//      programma e da quale sito arriva, e nella cartella Download non c'è;
//   3. "Non scaricare" lo chiude e il file non compare mai;
//   4. "Scarica" lo fa arrivare davvero nella cartella;
//   5. "Apri file" su un programma NON chiama shell.openPath prima della
//      seconda conferma, e la chiama dopo.
//
// Senza il fix: (2) e (3) trovano l'exe in cartella subito, (5) apre al primo
// clic → rossi.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));
const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

// Mini server che serve qualunque nome come allegato: `.exe` → finto eseguibile,
// tutto il resto → finto PDF. Il nome del file è quello nell'indirizzo.
async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'file.pdf';
    const exe = nome.endsWith('.exe');
    res.writeHead(200, {
      'Content-Type': exe ? 'application/octet-stream' : 'application/pdf',
      'Content-Length': exe ? EXE.length : PDF.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(exe ? EXE : PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const base = `http://127.0.0.1:${porta}`;
  return {
    base,
    porta,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// UNA pagina con entrambi i link: le schede del mini server condividono
// l'hostname, e la fixture seleziona il WebContentsView per hostname — aprirne
// due nello stesso test restituisce la prima, e il clic finisce sul link
// sbagliato senza che nulla lo dica.
async function apriPagina(base, { openTab, testServer }, extra = '') {
  return testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <a id="pdf" href="${base}/report.pdf">Scarica il report</a>
    <a id="exe" href="${base}/setup.exe">Scarica il programma</a>${extra}</body></html>`);
}

const elenco = (shell) => shell.evaluate(() => window.filoShell.downloads.list());
const voce = async (shell, nome) => {
  const r = await elenco(shell);
  return ((r && r.items) || []).find((it) => it.filename === nome) || null;
};
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;

// La domanda è la riga del pannello scaricamenti, che la barra apre da sola
// sopra la pagina: un avviso della barra nell'area pagina resterebbe sotto la
// vista nativa, presente nel DOM ma invisibile a schermo.
const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: `«${nome}»` });
const risposta = (riga, testo) => riga.locator('.dl-row-btn', { hasText: testo });
async function apriPannello(shell) {
  if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
  await expect(shell.locator('#dl-panel')).toBeVisible({ timeout: 10000 });
}
// Vero se nessun pezzo del riquadro cade sotto la pagina attiva.
async function sopraLaPagina(app, loc) {
  const box = await loc.boundingBox();
  const vista = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    if (!t || (t.view.getVisible && !t.view.getVisible())) return null;
    return t.view.getBounds();
  });
  if (!box) return false;
  if (!vista) return true;
  return !(box.x < vista.x + vista.width && vista.x < box.x + box.width
    && box.y < vista.y + vista.height && vista.y < box.y + box.height);
}

async function cartellaDownload(app) {
  return app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
}
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

test('un PDF scende senza domande, un programma si ferma e chiede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);

    const page = await apriPagina(srv.base, { openTab, testServer });

    // 1) Il file di tutti i giorni non cambia di una virgola.
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('report.pdf');

    // 2) Il programma si ferma PRIMA della cartella.
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const rec = await voce(shell, 'setup.exe');
    expect(rec.exe).toBe(true);
    expect(rec.site).toBe('127.0.0.1');
    // Il percorso della quarantena non esce verso le superfici.
    expect(rec.savePath).toBe('');

    // La domanda si apre da sola, SOPRA la pagina: dice che è un programma e
    // da dove arriva, e offre le due risposte.
    const avviso = domanda(shell, 'setup.exe');
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('programma');
    await expect(avviso).toContainText('127.0.0.1');
    await expect.poll(() => sopraLaPagina(app, avviso), { timeout: 10000, message: 'la domanda c’è ma la pagina la copre' }).toBe(true);
    await expect(risposta(avviso, /^Scarica$/)).toBeVisible();
    await expect(risposta(avviso, 'Non scaricare')).toBeVisible();

    // 3) Senza conferma il file NON è nella cartella Download. È il cuore del
    //    feedback: l'attesa non deve essere solo un avviso sopra un file già lì.
    expect(contenuto(dir)).not.toContain('setup.exe');

    // 4) "Non scaricare": la voce si chiude e il file non compare mai.
    await risposta(avviso, 'Non scaricare').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('cancelled');
    expect(contenuto(dir)).not.toContain('setup.exe');
  } finally {
    await srv.close();
  }
});

test('«Scarica» fa arrivare davvero il programma, e aprirlo chiede una seconda volta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);

    // Spia su shell.openPath: è la chiamata che su Windows ESEGUE il file.
    // Deve restare a zero finché non c'è la seconda conferma.
    await app.evaluate(({ shell }) => {
      globalThis.__aperti = [];
      shell.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const aperti = () => app.evaluate(() => globalThis.__aperti.slice());

    const page = await apriPagina(srv.base, { openTab, testServer });
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const avviso = domanda(shell, 'setup.exe');
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await risposta(avviso, /^Scarica$/).click();

    // Il sì fa arrivare il file dove l'utente lo cercherà.
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect.poll(() => contenuto(dir), { timeout: 10000 }).toContain('setup.exe');
    const rec = await voce(shell, 'setup.exe');
    expect(rec.savePath).toBe(join(dir, 'setup.exe'));

    // "Apri file" senza conferma: NON esegue, e dice perché.
    const primo = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(primo.ok).toBe(false);
    expect(primo.needsConfirm).toBe(true);
    expect(primo.text).toContain('setup.exe');
    expect(await aperti()).toEqual([]);

    // Il cammino vero: il pannello della barra in alto. Marca "Programma" a
    // vista, e "Apri file" porta alla seconda conferma invece di eseguire.
    await apriPannello(shell);
    const riga = shell.locator('.dl-row', { hasText: 'setup.exe' });
    await expect(riga).toBeVisible({ timeout: 10000 });
    await expect(riga.locator('.dl-row-tag')).toHaveText('Programma');
    await riga.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
    expect(await aperti()).toEqual([]);

    // La seconda conferma, nella riga e sopra la pagina, con le vie d'uscita.
    const conferma = domanda(shell, 'setup.exe').filter({ hasText: 'eseguirlo' });
    await expect(conferma).toBeVisible({ timeout: 10000 });
    await expect.poll(() => sopraLaPagina(app, conferma), { timeout: 10000, message: '«Apri file»: la domanda sta sotto la pagina' }).toBe(true);
    await expect(risposta(conferma, 'Apri comunque')).toBeVisible();
    await expect(risposta(conferma, 'Apri cartella')).toBeVisible();

    // «Annulla» ritira la domanda senza aprire niente; chiesta di nuovo, il sì apre.
    await risposta(conferma, 'Annulla').click();
    await expect(conferma).toHaveCount(0);
    expect(await aperti()).toEqual([]);
    await riga.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
    await risposta(conferma, 'Apri comunque').click();
    await expect.poll(aperti, { timeout: 10000 }).toEqual([rec.savePath]);
  } finally {
    await srv.close();
  }
});

test('la pagina Scaricamenti marca i programmi e sa rispondere all’attesa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    const page = await apriPagina(srv.base, { openTab, testServer });
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(riga).toBeVisible({ timeout: 15000 });
    // Si distingue a vista, e dice da dove arriva.
    await expect(riga.locator('.dl-tag')).toHaveText('Programma');
    await expect(riga.locator('.dl-meta')).toContainText('In attesa di conferma');
    await expect(riga.locator('.dl-meta')).toContainText('127.0.0.1');
    // Il percorso su disco non si mostra: il file non è ancora da nessuna parte
    // che riguardi l'utente.
    await expect(riga.locator('.dl-path')).toHaveCount(0);

    // Le stesse due risposte dell'avviso, per chi l'avviso l'ha già chiuso.
    await expect(riga.locator('.dl-btn', { hasText: 'Non scaricare' })).toBeVisible();
    await riga.locator('.dl-btn', { hasText: /^Scarica$/ }).click();

    const finita = dl.locator('.dl-item[data-state="completed"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(finita).toBeVisible({ timeout: 20000 });
    await expect(finita.locator('.dl-tag')).toHaveText('Programma');
    expect(contenuto(dir)).toContain('setup.exe');
  } finally {
    await srv.close();
  }
});

test('la domanda si toglie dalle impostazioni: per un sito fidato, o del tutto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);

    // Acceso di default: è la difesa, non un'opzione da scoprire.
    const sec = await openTab('filo://security/');
    await expect(sec.locator('#sec-dl-exe')).toBeChecked({ timeout: 10000 });

    // 1) "Mai per questo sito": il dominio va nell'elenco dei fidati.
    //    `blocked.test` risolve sul loopback (vedi la fixture), quindi è un
    //    dominio VERO servito dal mini server locale.
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(async () => {
      const s = await sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites));
      return s;
    }, { timeout: 10000 }).toEqual(['blocked.test']);

    // Una pagina sola con entrambi i link: il mini server delle pagine ha un
    // hostname unico, e una seconda scheda tornerebbe a essere la prima.
    const page = await apriPagina(srv.base, { openTab, testServer },
      `<a id="fidato" href="http://blocked.test:${srv.porta}/fidato.exe">Dal sito fidato</a>
       <a id="spento" href="${srv.base}/spento.exe">Con la domanda spenta</a>`);

    await page.locator('#fidato').click();
    // Scende come un PDF: nessuna attesa, il file è in cartella.
    await expect.poll(() => statoDi(shell, 'fidato.exe'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('fidato.exe');

    // Un altro sito resta sotto conferma: la deroga vale per chi l'ha ricevuta.
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    // 2) Spenta del tutto: anche il sito di prima scende senza domande.
    await sec.locator('#sec-dl-exe').uncheck();
    await expect.poll(async () => {
      const v = await sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.confirmExecutables));
      return v;
    }, { timeout: 10000 }).toBe(false);

    await page.locator('#spento').click();
    await expect.poll(() => statoDi(shell, 'spento.exe'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('spento.exe');
  } finally {
    await srv.close();
  }
});

// Il sito può consegnare il programma senza passare da un indirizzo: se lo
// fabbrica nella pagina (blob:) o lo incolla dentro il link (data:). Per chi
// usa Filo è lo stesso gesto, quindi deve fermarsi alla stessa domanda, e la
// domanda deve dire da dove arriva: è la cosa su cui si decide, e il sito non
// deve poterla togliere scegliendo COME consegnare il file.
// Senza il fix l'avviso è «è un programma, scaricarlo?» e basta → rosso.
const PAGINA_FABBRICA = `<!doctype html><html><body style="padding:40px">
<button id="blob">blob</button>
<button id="data">data</button>
<script>
  function scarica(href, nome) {
    const a = document.createElement('a');
    a.href = href; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  }
  document.getElementById('blob').onclick = () => {
    const b = new Blob([new Uint8Array([77, 90, 1, 2, 3, 4])], { type: 'application/octet-stream' });
    scarica(URL.createObjectURL(b), 'daBlob.exe');
  };
  document.getElementById('data').onclick = () => scarica('data:application/octet-stream;base64,TVoBAgME', 'daData.exe');
</script></body></html>`;

test('un programma fabbricato dalla pagina si ferma, e la domanda dice da quale sito arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dir = await cartellaDownload(app);
  const page = await testServer.openReady(openTab, PAGINA_FABBRICA);
  const sito = new URL(page.url()).hostname;

  for (const [bottone, nome] of [['blob', 'daBlob.exe'], ['data', 'daData.exe']]) {
    await page.locator(`#${bottone}`).click();
    await expect.poll(() => statoDi(shell, nome), { timeout: 20000 }).toBe('pending');
    expect(contenuto(dir)).not.toContain(nome);

    const rec = await voce(shell, nome);
    expect(rec.exe).toBe(true);
    expect(rec.site, `«${nome}»: la domanda non nomina il sito`).toBe(sito);

    const avviso = domanda(shell, nome);
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText(sito);

    await risposta(avviso, 'Non scaricare').click();
    await expect.poll(() => statoDi(shell, nome), { timeout: 10000 }).toBe('cancelled');
  }
  expect(contenuto(dir)).toEqual([]);
});

// Chiudere il pannello senza rispondere è facile quanto rispondere. Da quel
// momento l'unico segno che la domanda è ancora aperta è l'indicatore in alto,
// che deve dirlo invece di somigliare a un elenco fermo.
test('chiuso il pannello, l’indicatore dice ancora che una risposta è in sospeso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await apriPagina(srv.base, { openTab, testServer });
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    await expect(domanda(shell, 'setup.exe')).toBeVisible({ timeout: 10000 });
    const indicatore = shell.locator('#dl-indicator');
    await indicatore.click();
    await expect(shell.locator('#dl-panel')).toBeHidden({ timeout: 10000 });

    await expect(indicatore).toBeVisible();
    await expect(indicatore.locator('#dl-ind-count')).toHaveText('1', { timeout: 10000 });
    await expect(indicatore).toHaveAttribute('data-tip', /aspetta la tua risposta/);
    // Niente barra: un file fermo in attesa non sta scaricando.
    await expect(indicatore).not.toHaveClass(/\bactive\b/);

    // E da lì le due risposte sono a un clic.
    await indicatore.click();
    await expect(risposta(domanda(shell, 'setup.exe'), /^Scarica$/)).toBeVisible({ timeout: 10000 });
  } finally {
    await srv.close();
  }
});

// La domanda si può risolvere in tre posti (pannello della barra, pagina
// Scaricamenti, tasto destro sulla voce): chi risponde altrove non deve
// ritrovarsi nel pannello una domanda che non aspetta più niente.
test('risposto altrove, la domanda nel pannello si ritira', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const srv = await apriServer();
  try {
    const page = await apriPagina(srv.base, { openTab, testServer },
      ['uno', 'due', 'tre'].map((n) => `<a id="${n}" href="${srv.base}/${n}.exe">${n}</a>`).join('\n'));

    for (const n of ['uno', 'due', 'tre']) {
      await page.locator(`#${n}`).click();
      await expect.poll(() => statoDi(shell, `${n}.exe`), { timeout: 20000 }).toBe('pending');
      await expect(domanda(shell, `${n}.exe`)).toBeVisible({ timeout: 10000 });
    }

    // 1) «Non scaricare» dalla pagina Scaricamenti.
    const dl = await openTab('filo://downloads/downloads.html');
    await apriPannello(shell);
    const rigaDl = (nome) => dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: nome }) });
    await expect(rigaDl('uno.exe')).toBeVisible({ timeout: 15000 });
    await rigaDl('uno.exe').locator('.dl-btn', { hasText: 'Non scaricare' }).click();
    await expect.poll(() => statoDi(shell, 'uno.exe'), { timeout: 10000 }).toBe('cancelled');
    await expect(domanda(shell, 'uno.exe')).toHaveCount(0, { timeout: 10000 });

    // 2) «Scarica» dal pannello della barra in alto.
    await risposta(domanda(shell, 'due.exe'), /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'due.exe'), { timeout: 20000 }).toBe('completed');
    await expect(domanda(shell, 'due.exe')).toHaveCount(0, { timeout: 10000 });

    // 3) Voce tolta dall'elenco col tasto destro, senza rispondere.
    await expect(rigaDl('tre.exe')).toBeVisible({ timeout: 15000 });
    await rigaDl('tre.exe').click({ button: 'right' });
    await dl.locator('.dl-ctxmenu .sn-select-option', { hasText: 'Rimuovi dalla lista' }).click();
    await expect.poll(() => voce(shell, 'tre.exe'), { timeout: 10000 }).toBeNull();
    await expect(domanda(shell, 'tre.exe')).toHaveCount(0, { timeout: 10000 });
  } finally {
    await srv.close();
  }
});

// Il pannello si apre dove la pagina ha appena mandato il cursore: il «sì»
// non deve poter arrivare dal secondo clic di un doppio clic sulla pagina.
async function vistaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    return t ? t.view.getBounds() : null;
  });
}
const clicNellaFinestra = (app, x, y) => app.evaluate(({ BrowserWindow }, [cx, cy]) => {
  const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
  w.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
}, [Math.round(x), Math.round(y)]);

test('un doppio clic sulla pagina non risponde «Scarica» né «Apri comunque»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    await app.evaluate(({ shell: sh }) => {
      globalThis.__aperti = [];
      sh.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const page = await apriPagina(srv.base, { openTab, testServer },
      `<a id="trappola" href="${srv.base}/trappola.exe" style="position:absolute;left:-100px;top:-100px;width:12px;height:12px;display:block"></a>`);
    const v0 = await vistaAttiva(app);

    // Dove comparirà «Scarica»: lo misura un primo programma, rifiutato.
    await page.locator('#exe').click();
    const prima = domanda(shell, 'setup.exe');
    await expect(risposta(prima, /^Scarica$/)).toBeEnabled({ timeout: 10000 });
    const b = await risposta(prima, /^Scarica$/).boundingBox();
    await risposta(prima, 'Non scaricare').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('cancelled');
    await shell.locator('#dl-indicator').click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => (await vistaAttiva(app)).y).toBe(v0.y);

    // La pagina mette un suo pulsante esattamente lì, e l'utente ci fa doppio clic.
    const cx = b.x + b.width / 2; const cy = b.y + b.height / 2;
    await page.evaluate(([x, y]) => {
      const t = document.getElementById('trappola');
      t.style.left = `${x - 6}px`; t.style.top = `${y - 6}px`;
    }, [cx - v0.x, cy - v0.y]);
    await page.mouse.click(cx - v0.x, cy - v0.y);
    const dopo = domanda(shell, 'trappola.exe');
    await expect(dopo).toBeVisible({ timeout: 10000 });
    await clicNellaFinestra(app, cx, cy);
    await shell.waitForTimeout(600);
    expect(await statoDi(shell, 'trappola.exe')).toBe('pending');
    expect(contenuto(dir)).not.toContain('trappola.exe');

    // Chi ha letto la domanda risponde, un attimo dopo, come sempre.
    await risposta(dopo, /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'trappola.exe'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('trappola.exe');

    // Stessa regola sulla seconda domanda: «Apri comunque» appena comparso non apre.
    const finito = shell.locator('#dl-panel .dl-row', { hasText: 'trappola.exe' });
    await finito.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
    const apri = finito.locator('.dl-row-btn', { hasText: 'Apri comunque' });
    await expect(apri).toBeVisible({ timeout: 5000 });
    const a = await apri.boundingBox();
    await clicNellaFinestra(app, a.x + a.width / 2, a.y + a.height / 2);
    await shell.waitForTimeout(600);
    expect(await app.evaluate(() => globalThis.__aperti.length)).toBe(0);
    await apri.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length), { timeout: 10000 }).toBe(1);
  } finally {
    await srv.close();
  }
});

// Pagine su richiesta, `/lento.exe` che scende in una ventina di secondi, e
// qualunque altro nome come programma allegato.
async function serverPagine(pagine) {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (pagine[p]) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(pagine[p]); return; }
    if (p === '/lento.exe') {
      const tot = 64 * 1024 * 200;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': tot, 'Content-Disposition': 'attachment; filename="lento.exe"' });
      let mandati = 0;
      const t = setInterval(() => {
        if (mandati >= tot || res.destroyed) { clearInterval(t); res.end(); return; }
        res.write(Buffer.alloc(64 * 1024, 1)); mandati += 64 * 1024;
      }, 100);
      return;
    }
    const nome = p.split('/').pop() || 'x.exe';
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': EXE.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return { porta, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

// Un riquadro di un altro sito (la pubblicità) dentro un sito fidato: il
// programma che consegna scritto nell'indirizzo può venire da lui.
test('un programma data: da un riquadro di altri non prende la fiducia del sito che lo ospita, e la domanda lo dice', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await serverPagine(pagine);
  try {
    const dir = await cartellaDownload(app);
    pagine['/top.html'] = `<!doctype html><html><body><h1>Forum</h1>
      <iframe id="ad" src="http://127.0.0.1:${srv.porta}/ad.html" width="400" height="200"></iframe></body></html>`;
    pagine['/ad.html'] = `<!doctype html><html><body>
      <a id="data" download="dalriquadro.exe" href="data:application/octet-stream;base64,TVoBAgME">data</a>
      <a id="http" href="/dalriquadro-http.exe">http</a></body></html>`;

    const sec = await openTab('filo://security/');
    await sec.locator('#sec-dl-trusted').fill('blocked.test');
    await sec.locator('#sec-dl-trusted').press('Tab');
    await expect.poll(() => sec.evaluate(() => window.SN_STORAGE.getSettings().then((x) => x.security.downloads.trustedSites)), { timeout: 10000 }).toEqual(['blocked.test']);

    const page = await openTab(`http://blocked.test:${srv.porta}/top.html`);
    const ad = page.frameLocator('#ad');

    await ad.locator('#http').click();
    await expect.poll(() => statoDi(shell, 'dalriquadro-http.exe'), { timeout: 20000 }).toBe('pending');
    await expect(domanda(shell, 'dalriquadro-http.exe')).toContainText('da 127.0.0.1');

    await ad.locator('#data').click();
    await expect.poll(() => statoDi(shell, 'dalriquadro.exe'), { timeout: 20000 }).toBe('pending');
    expect(contenuto(dir)).not.toContain('dalriquadro.exe');
    const avviso = domanda(shell, 'dalriquadro.exe');
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('altri siti');
    await expect(avviso).not.toContainText('programma da blocked.test.');
  } finally { await srv.close(); }
});

// Un programma vero pesa decine di megabyte: mentre si legge la domanda sta
// ancora scendendo, e il pannello si aggiorna a ogni avanzamento.
test('«Scarica» risponde al primo clic anche mentre il programma sta ancora scendendo', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await serverPagine(pagine);
  try {
    pagine['/p.html'] = '<!doctype html><html><body style="padding:40px"><a id="l" href="/lento.exe">scarica</a></body></html>';
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    const si = risposta(domanda(shell, 'lento.exe'), /^Scarica$/);
    await expect(si).toBeEnabled({ timeout: 10000 });
    await shell.waitForTimeout(1500);
    const b = await si.boundingBox();
    // Tasto giù più a lungo di un avanzamento: senza la cura il clic si perde sempre.
    await app.evaluate(async ({ BrowserWindow }, [x, y]) => {
      const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
      w.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 650));
      w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }, [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]);
    await expect.poll(() => statoDi(shell, 'lento.exe'), { timeout: 3000, message: 'il primo clic su «Scarica» è andato a vuoto' }).not.toBe('pending');

    // Stessa cosa sulla pagina Scaricamenti, che si aggiorna anche lei da sola.
    await page.evaluate(() => { location.href = '/lento.exe'; });
    await expect.poll(async () => (await elenco(shell)).items.filter((x) => x.state === 'pending').length, { timeout: 20000 }).toBe(1);
    const dl = await openTab('filo://downloads/downloads.html');
    const bottone = dl.locator('.dl-item[data-state="pending"] .dl-btn', { hasText: /^Scarica$/ });
    await expect(bottone).toBeVisible({ timeout: 10000 });
    await dl.waitForTimeout(1000);
    const c = await bottone.boundingBox();
    await dl.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await dl.mouse.down();
    await dl.waitForTimeout(650);
    await dl.mouse.up();
    await expect.poll(async () => (await elenco(shell)).items.filter((x) => x.state === 'pending').length, { timeout: 3000 }).toBe(0);
  } finally { await srv.close(); }
});

test('un nome lungo senza spazi si legge tutto nella domanda, senza scorrere di lato', async ({ shell, openTab }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const srv = await serverPagine(pagine);
  try {
    const lungo = 'Aggiornamento_urgente_del_driver_della_scheda_video_versione_finale_2026_installer_completo.exe';
    pagine['/p.html'] = `<!doctype html><html><body style="padding:40px"><a id="l" href="/${lungo}">scarica</a></body></html>`;
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    await expect(domanda(shell, lungo)).toBeVisible({ timeout: 15000 });
    const misure = await shell.evaluate(() => {
      const a = document.querySelector('#dl-panel .dl-row[data-chiede="1"] .dl-row-ask');
      const l = document.querySelector('#dl-panel-list');
      return { ask: [a.scrollWidth, a.clientWidth], lista: [l.scrollWidth, l.clientWidth] };
    });
    expect(misure.ask[0], 'il nome esce dal bordo della domanda').toBeLessThanOrEqual(misure.ask[1] + 1);
    expect(misure.lista[0], 'il pannello scorre di lato').toBeLessThanOrEqual(misure.lista[1] + 1);
  } finally { await srv.close(); }
});
