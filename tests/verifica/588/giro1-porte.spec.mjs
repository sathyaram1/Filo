// Verifica #588, giro 1 — le porte che la consegna non prova.
//
// Il lavoro consegnato ha già uno spec sul cammino principale (pdf muto, exe in
// attesa, seconda conferma sull'apertura). Qui si provano le strade laterali:
//   1. nomi che ingannano l'occhio (doppia estensione, punto in coda, nome che
//      si legge al contrario) e le estensioni di Mac e Linux nominate dal
//      feedback: la domanda deve arrivare per tutte;
//   2. il programma in attesa non resta su disco quando l'utente lo toglie
//      dall'elenco invece di rispondere;
//   3. clic ripetuti di fretta: ogni scaricamento ha la sua risposta, e un «no»
//      non lascia niente in giro;
//   4. la marca «Programma» si legge in tema chiaro E in tema scuro.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CORPO = Buffer.from('MZ finto contenuto di prova\n' + 'z'.repeat(1024));

// Serve QUALUNQUE nome come allegato: il nome sta nel parametro `n`, così può
// contenere punti in coda e caratteri che in un percorso non passerebbero.
async function apriServer() {
  const srv = createServer((req, res) => {
    let nome = 'file.bin';
    try { nome = new URL(req.url, 'http://x').searchParams.get('n') || nome; } catch (_) {}
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': CORPO.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(CORPO);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return {
    base: `http://127.0.0.1:${porta}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const elenco = async (shell) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (r && r.items) || [];
};
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const cartellaDownload = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const cartellaQuarantena = async (app) => join(
  await app.evaluate(({ app: a }) => a.getPath('userData')), 'quarantena');

// Una pagina sola con tutti i link: la fixture seleziona il WebContentsView per
// hostname, e una seconda scheda dello stesso mini server tornerebbe la prima.
async function apriPagina(base, { openTab, testServer }, nomi) {
  const link = nomi
    .map((n, i) => `<a id="l${i}" href="${base}/scarica?n=${encodeURIComponent(n)}">${i}</a>`)
    .join('\n');
  return testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <a id="innocuo" href="${base}/scarica?n=relazione.pdf">pdf</a>
    ${link}</body></html>`);
}

test('un nome che inganna l’occhio chiede comunque, e anche le estensioni di Mac e Linux', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    // fattura.pdf.exe  → l'occhio legge «pdf», il sistema esegue
    // aggiorna.exe.    → Windows apre `aggiorna.exe`: il punto in coda si ignora
    // nota‮txt.exe → si legge «notaexe.txt», resta un programma
    // patch.sh / app.dmg / tool.jar → le estensioni di Mac e Linux del feedback
    const nomi = ['fattura.pdf.exe', 'aggiorna.exe.', 'nota‮txt.exe', 'patch.sh', 'app.dmg', 'tool.jar'];
    const page = await apriPagina(srv.base, { openTab, testServer }, nomi);

    // Il file di tutti i giorni non cambia: è la metà che dice che l'attrito sta
    // solo dove serve.
    await page.locator('#innocuo').click();
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === 'relazione.pdf')?.state,
      { timeout: 30000 }).toBe('completed');

    for (let i = 0; i < nomi.length; i++) {
      await page.locator(`#l${i}`).click();
      // La voce in attesa si riconosce: è marcata come programma e dice il sito.
      await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'pending').length,
        { timeout: 30000 }).toBe(1);
      const rec = (await elenco(shell)).find((r) => r.state === 'pending');
      expect(rec, `«${nomi[i]}» non si è fermato`).toBeTruthy();
      expect(rec.exe, `«${nomi[i]}» non è marcato come programma`).toBe(true);
      expect(rec.site).toBe('127.0.0.1');
      // Rispondi no e passa al prossimo, così l'attesa resta una sola per giro.
      await shell.evaluate((id) => window.filoShell.downloads.confirm(id, false), rec.id);
      await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'pending').length,
        { timeout: 20000 }).toBe(0);
    }

    // Niente di tutto questo è arrivato nella cartella Download: c'è solo il pdf.
    expect(contenuto(dir).filter((n) => n !== 'relazione.pdf')).toEqual([]);
  } finally {
    await srv.close();
  }
});

test('togliere dall’elenco un programma in attesa lo toglie anche dal disco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    const quarantena = await cartellaQuarantena(app);
    const page = await apriPagina(srv.base, { openTab, testServer }, ['setup.exe']);

    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === 'setup.exe')?.state,
      { timeout: 30000 }).toBe('pending');

    // Il file non è in Download, e il suo percorso non esce verso le superfici.
    const rec = (await elenco(shell)).find((r) => r.filename === 'setup.exe');
    expect(rec.savePath).toBe('');
    expect(contenuto(dir)).not.toContain('setup.exe');

    // Via dalla lista col tasto destro, senza rispondere alla domanda: è la
    // terza risposta possibile, e non deve lasciare un programma su disco in un
    // posto che nessuno guarda più.
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await riga.click({ button: 'right' });
    await dl.locator('.dl-ctxmenu .sn-select-option', { hasText: 'Rimuovi dalla lista' }).click();

    await expect.poll(async () => (await elenco(shell)).some((r) => r.filename === 'setup.exe'),
      { timeout: 20000 }).toBe(false);
    expect(contenuto(dir)).not.toContain('setup.exe');
    // La cartella riservata non deve conservare il programma orfano.
    await expect.poll(() => contenuto(quarantena), { timeout: 10000 }).toEqual([]);
  } finally {
    await srv.close();
  }
});

test('cinque clic di fretta: ogni programma ha la sua risposta e un no non lascia niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    const quarantena = await cartellaQuarantena(app);
    const page = await apriPagina(srv.base, { openTab, testServer }, ['setup.exe']);

    for (let i = 0; i < 5; i++) await page.locator('#l0').click();

    await expect.poll(async () => (await elenco(shell)).filter((r) => r.state === 'pending').length,
      { timeout: 40000 }).toBe(5);

    // Nessuno dei cinque è in cartella: cinque attese, zero file.
    expect(contenuto(dir)).toEqual([]);

    const attese = (await elenco(shell)).filter((r) => r.state === 'pending');
    // Uno solo passa: le risposte sono indipendenti, non un interruttore unico.
    await shell.evaluate((id) => window.filoShell.downloads.confirm(id, true), attese[0].id);
    for (const r of attese.slice(1)) {
      await shell.evaluate((id) => window.filoShell.downloads.confirm(id, false), r.id);
    }

    await expect.poll(async () => {
      const l = await elenco(shell);
      return {
        attesa: l.filter((r) => r.state === 'pending').length,
        finiti: l.filter((r) => r.state === 'completed').length,
      };
    }, { timeout: 40000 }).toEqual({ attesa: 0, finiti: 1 });

    // In cartella c'è esattamente il file per cui è stato detto sì.
    await expect.poll(() => contenuto(dir).length, { timeout: 20000 }).toBe(1);
    await expect.poll(() => contenuto(quarantena), { timeout: 20000 }).toEqual([]);
  } finally {
    await srv.close();
  }
});

test('la marca «Programma» si legge in tema chiaro e in tema scuro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const page = await apriPagina(srv.base, { openTab, testServer }, ['setup.exe']);
    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === 'setup.exe')?.state,
      { timeout: 30000 }).toBe('pending');

    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await expect(riga.locator('.dl-tag')).toHaveText('Programma');

    // Contrasto di un elemento sul fondo vero della riga (il primo antenato con
    // un colore opaco): sotto 3 non si legge.
    const rapporto = (sel) => dl.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 0;
      const num = (v) => (String(v).match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      let fondo = [255, 255, 255];
      for (let n = el; n; n = n.parentElement) {
        const c = num(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { fondo = c.slice(0, 3); break; }
      }
      const a = lum(num(getComputedStyle(el).color).slice(0, 3));
      const b = lum(fondo);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, sel);

    const mirini = [
      ['.dl-item[data-state="pending"] .dl-tag', 'la marca «Programma»'],
      ['.dl-item[data-state="pending"] .dl-meta', 'la riga «In attesa di conferma · da …»'],
    ];

    for (const tema of ['light', 'dark']) {
      // Il tema VERO: themeTokens riscrive html[data-sn-theme] al cambio, e
      // forzare l'attributo a mano lascerebbe indietro i token generati.
      await dl.evaluate(async (t) => {
        await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
      }, tema);
      await expect.poll(() => dl.evaluate(() => document.documentElement.getAttribute('data-sn-theme')),
        { timeout: 15000 }).toBe(tema);
      await dl.waitForTimeout(400);
      await dl.screenshot({ path: `tests/.shots/588-programma-${tema}.png` });
      for (const [sel, nome] of mirini) {
        const r = await rapporto(sel);
        expect(r, `${nome}, tema ${tema}: contrasto ${r.toFixed(2)}`).toBeGreaterThan(3);
      }
      // I due pulsanti della risposta devono restare leggibili: è lì che si
      // decide se un programma entra nel computer.
      for (const etichetta of ['Scarica', 'Non scaricare']) {
        const b = riga.locator('.dl-btn', { hasText: new RegExp(`^${etichetta}$`) });
        await expect(b, `pulsante «${etichetta}», tema ${tema}`).toBeVisible();
      }
    }
  } finally {
    await srv.close();
  }
});

test('chiuso l’avviso, l’indicatore dice ancora che una risposta è in sospeso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const page = await apriPagina(srv.base, { openTab, testServer }, ['setup.exe']);
    await page.locator('#l0').click();
    await expect.poll(async () => (await elenco(shell)).find((r) => r.filename === 'setup.exe')?.state,
      { timeout: 30000 }).toBe('pending');

    // L'avviso ha una × accanto alle due risposte: chiuderlo è facile quanto
    // rispondere, e da quel momento la domanda esce dagli occhi.
    const avviso = shell.locator('.shell-notif', { hasText: 'setup.exe' });
    await expect(avviso).toBeVisible({ timeout: 15000 });
    await avviso.locator('.shell-notif-close').click();
    await expect(avviso).toBeHidden({ timeout: 10000 });

    // Lo scaricamento è fermo e aspetta l'utente: l'indicatore in alto deve
    // dirlo, altrimenti per chi guarda non è successo niente e il file non
    // arriverà mai.
    const indicatore = shell.locator('#dl-indicator');
    await expect(indicatore).toBeVisible();
    await expect(indicatore.locator('#dl-ind-count')).toBeVisible({ timeout: 10000 });
  } finally {
    await srv.close();
  }
});
