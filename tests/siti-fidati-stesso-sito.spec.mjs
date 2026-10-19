// #876 — i siti fidati seguono la regola di «stesso sito» (src/shared/stessoSito.js) ovunque: in Privacy massima un
// fidato scritto come sottodominio o come indirizzo resta connesso dopo il riavvio e la lista mostra il sito vero; fra i
// programmi fidati una piattaforma che ospita i siti di chiunque non entra, e la pagina propone il sito preciso; un
// riquadro di un sottodominio non rende incerta la provenienza di un programma.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

// Ogni host risponde con la stessa pagina, che mostra i cookie che ha.
async function serverSiti(pagine = {}) {
  const srv = createServer((req, res) => {
    const percorso = String(req.url || '').split('?')[0];
    if (pagine[percorso]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pagine[percorso]);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><p id="c"></p><script>document.getElementById("c").textContent = document.cookie;</script></body></html>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    porta: srv.address().port,
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP *.test 127.0.0.1', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  const apri = async (url) => {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url() === url); return !!page; }, { timeout: 15_000 }).toBe(true);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return page;
  };
  return { app, shell, apri };
}

const fidatiSalvati = (sec) => sec.evaluate(() => window.SN_STORAGE.getSettings().then((s) => s.security.cookies.trustedSites));

test('in Privacy massima un fidato scritto come sottodominio o come indirizzo tiene connesso il suo sito dopo il riavvio', async () => {
  test.setTimeout(180_000);
  const srv = await serverSiti();
  const userData = cartellaTemporanea('filo-test-');
  const sito = (host, q = '') => `http://${host}:${srv.porta}/${q}`;
  const posta = sito('posta.due.test', 'mail/u/0/');
  try {
    let run = await avvia(userData);
    try {
      const sec = await run.apri('filo://security/');
      await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
      await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
      await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });

      // Come lo scrive l'utente: il nome che vede in una pagina, o l'indirizzo copiato dalla barra.
      for (const scritto of ['posta.uno.test', posta]) {
        await sec.locator('#cookie-wl-input').fill(scritto);
        await sec.locator('#cookie-wl-input').press('Enter');
      }
      await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['due.test', 'uno.test']);
      await expect.poll(() => fidatiSalvati(sec), { timeout: 10_000 }).toEqual(['due.test', 'uno.test']);
      await expect(sec.locator('#cookie-wl-error')).toBeHidden();
      // Lo stesso sito scritto con un altro sottodominio è già nell'elenco.
      await sec.locator('#cookie-wl-input').fill('www.uno.test');
      await sec.locator('#cookie-wl-input').press('Enter');
      await expect(sec.locator('#cookie-wl-error')).toContainText('"uno.test" è già nell\'elenco');
      await expect(sec.locator('#cookie-wl-list li span')).toHaveCount(2);
      // Una piattaforma non è il sito di nessuno: non entra, la pagina dice perché e il testo resta da correggere.
      await sec.locator('#cookie-wl-input').fill('github.io');
      await sec.locator('#cookie-wl-input').press('Enter');
      await expect(sec.locator('#cookie-wl-error')).toContainText('«github.io» raccoglie i siti di chiunque');
      await expect(sec.locator('#cookie-wl-input')).toHaveValue('github.io');
      await expect(sec.locator('#cookie-wl-list li span')).toHaveCount(2);
      await sec.locator('#cookie-wl-input').fill('');

      // Una voce salvata come sottodominio prima della correzione vale senza riscriverla, e la lista la mostra al suo sito.
      await sec.evaluate(() => chrome.runtime.sendMessage({
        type: 'update_settings', settings: { security: { cookies: { trustedSites: ['due.test', 'uno.test', 'posta.tre.test'] } } },
      }));
      await sec.reload();
      await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['due.test', 'uno.test', 'tre.test'], { timeout: 10_000 });

      // Il cookie lo scrive la pagina già aperta: una scheda riaperta dopo il riavvio lo rilegge, non lo riscrive.
      for (const [url, v] of [[sito('posta.uno.test'), 'uno'], [posta, 'due'], [sito('posta.tre.test'), 'tre'],
        [sito('posta.quattro.test'), 'quattro']]) {
        const p = await run.apri(url);
        await p.evaluate((x) => { document.cookie = `sessione=${x}; max-age=86400; path=/`; }, v);
        await expect.poll(() => p.evaluate(() => document.cookie)).toBe(`sessione=${v}`);
      }
      await run.app.evaluate(async ({ session }) => {
        for (const s of ['uno', 'due', 'tre']) await session.fromPartition(`persist:filo-priv-${s}.test`).cookies.flushStore();
      });
    } finally {
      await chiudiApp(run.app);
    }

    run = await avvia(userData);
    try {
      for (const [url, atteso] of [[sito('posta.uno.test'), 'sessione=uno'], [posta, 'sessione=due'],
        [sito('posta.tre.test'), 'sessione=tre'], [sito('posta.quattro.test'), '']]) {
        const p = await run.apri(url);
        await expect(p.locator('#c')).toHaveText(atteso, { timeout: 10_000 });
      }
    } finally {
      await chiudiApp(run.app);
    }
  } finally {
    await srv.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// Una piattaforma salvata prima che la si rifiutasse resta in elenco ma non tiene connesso nessun sito ospitato: la
// lista lo dice accanto alla voce, come la casella dei programmi. Un suffisso salvato prima (gov.it) vale ancora: niente avviso.
test('fra i siti dove resti connesso una piattaforma salvata prima porta il suo avviso', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
  await sec.evaluate(() => chrome.runtime.sendMessage({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: ['github.io', 'gov.it', 'uno.test'] } } },
  }));
  await sec.reload();
  const voce = (nome) => sec.locator('#cookie-wl-list li', { has: sec.locator('span', { hasText: new RegExp(`^${nome.replace('.', '\\.')}$`) }) });
  await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['github.io', 'gov.it', 'uno.test'], { timeout: 10_000 });
  await expect(voce('github.io').locator('.sn-cookie-wl-nota')).toHaveText(
    '«github.io» raccoglie i siti di chiunque, quindi fidarsi di lui vorrebbe dire fidarsi di tutti. Scrivi il sito preciso, come nome.github.io.');
  await expect(voce('gov.it').locator('.sn-cookie-wl-nota')).toHaveCount(0);
  await expect(voce('uno.test').locator('.sn-cookie-wl-nota')).toHaveCount(0);
  mkdirSync(SHOTS, { recursive: true });
  await sec.locator('#cookie-wl-list').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: join(SHOTS, 'siti-fidati-piattaforma-salvata.png') });
  await voce('github.io').locator('button').click();
  await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['gov.it', 'uno.test']);
  await expect.poll(() => fidatiSalvati(sec), { timeout: 10_000 }).toEqual(['gov.it', 'uno.test']);
});

// gmail.com vale google.com: chi li scrive tutti e due trova una voce sola, e togliendola non resta connesso a Gmail.
test('fra i siti dove resti connesso gmail.com e google.com sono una voce sola', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  await sec.locator('#cookie-wl-input').fill('gmail.com');
  await sec.locator('#cookie-wl-input').press('Enter');
  await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['google.com']);
  await sec.locator('#cookie-wl-input').fill('google.com');
  await sec.locator('#cookie-wl-input').press('Enter');
  await expect(sec.locator('#cookie-wl-error')).toHaveText('"google.com" è già nell\'elenco dei siti fidati.');
  await expect(sec.locator('#cookie-wl-list li button')).toHaveCount(1);
  await sec.locator('#cookie-wl-list li button').click();
  await expect.poll(() => fidatiSalvati(sec), { timeout: 10_000 }).toEqual([]);

  // Una voce di Google salvata prima, sotto un altro nome, si vede e si toglie come google.com.
  await sec.evaluate(() => chrome.runtime.sendMessage({
    type: 'update_settings', settings: { security: { cookies: { trustedSites: ['gmail.com', 'youtube.com', 'uno.test'] } } },
  }));
  await sec.reload();
  await expect(sec.locator('#cookie-wl-list li span')).toHaveText(['google.com', 'uno.test'], { timeout: 10_000 });
  await sec.locator('#cookie-wl-list li', { hasText: 'google.com' }).locator('button').click();
  await expect.poll(() => fidatiSalvati(sec), { timeout: 10_000 }).toEqual(['uno.test']);
});

test.describe('programmi scaricati', () => {
  test.use({ hostInPiu: ['shop.esempio.test', 'cdn.esempio.test', 'alice.github.io', 'bob.github.io'] });

  const elenco = (shell) => shell.evaluate(() => window.filoShell.downloads.list());
  const voce = async (shell, nome) => ((await elenco(shell))?.items || []).find((it) => it.filename === nome) || null;
  // Il nome sta nel riquadro della domanda (#592.7), senza virgolette: si cerca lì, intero.
  const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]')
    .filter({ has: shell.locator('.dl-row-ask-nome', { hasText: new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

  test('un riquadro di un sottodominio è lo stesso sito; quello di un altro utente della piattaforma no', async ({ shell, openTab }) => {
    test.setTimeout(120_000);
    const pagine = {};
    const srv = await serverSiti(pagine);
    try {
      for (const [pagina, riquadro, nome, incerto] of [
        ['shop.esempio.test', 'cdn.esempio.test', 'dalcdn.exe', false],
        ['alice.github.io', 'bob.github.io', 'dabob.exe', true],
      ]) {
        pagine[`/${nome}.html`] = `<!doctype html><html><body>
          <a id="data" download="${nome}" href="data:application/octet-stream;base64,TVoBAgME">scarica</a></body></html>`;
        pagine[`/${pagina}.html`] = `<!doctype html><html><body><h1>Negozio</h1>
          <iframe id="r" src="http://${riquadro}:${srv.porta}/${nome}.html" width="400" height="120"></iframe></body></html>`;
        const page = await openTab(`http://${pagina}:${srv.porta}/${pagina}.html`);
        await page.frameLocator('#r').locator('#data').click();
        await expect.poll(async () => (await voce(shell, nome))?.state ?? null, { timeout: 20_000 }).toBe('pending');
        const v = await voce(shell, nome);
        expect(v.site).toBe(pagina);
        expect(v.siteUncertain).toBe(incerto);
        await expect(domanda(shell, nome)).toContainText(incerto ? `da una pagina di ${pagina} con parti di altri siti`
          : `è un programma da ${pagina}.`, { timeout: 10_000 });
      }
    } finally { await srv.close(); }
  });

  test('fra i programmi fidati una piattaforma non entra: la pagina dice perché e propone il sito da cui hai scaricato', async ({ shell, openTab }) => {
    test.setTimeout(120_000);
    const pagine = {
      '/p.html': '<!doctype html><html><body><a id="data" download="strumento.exe" href="data:application/octet-stream;base64,TVoBAgME">scarica</a></body></html>',
    };
    const srv = await serverSiti(pagine);
    try {
      const page = await openTab(`http://alice.github.io:${srv.porta}/p.html`);
      await page.locator('#data').click();
      await expect.poll(async () => (await voce(shell, 'strumento.exe'))?.state ?? null, { timeout: 20_000 }).toBe('pending');

      const sec = await openTab('filo://security/');
      const casella = sec.locator('#sec-dl-trusted');
      await casella.fill('github.io\nhttps://download.mozilla.org/firefox\nfaceb');
      await casella.press('Tab');
      const errore = sec.locator('#sec-dl-trusted-error');
      await expect(errore).toBeVisible({ timeout: 10_000 });
      await expect(errore).toContainText('«github.io» raccoglie i siti di chiunque');
      await expect(errore).toContainText('Scrivi il sito preciso, come alice.github.io.');
      await expect(errore).toContainText('faceb');
      const salvati = () => sec.evaluate(() => window.SN_STORAGE.getSettings().then((s) => s.security.downloads));
      await expect.poll(async () => (await salvati()).trustedSites, { timeout: 10_000 }).toEqual(['download.mozilla.org']);
      expect((await salvati()).righeScartate.map((x) => x.riga)).toEqual(['github.io', 'faceb']);
      mkdirSync(SHOTS, { recursive: true });
      await sec.locator('#sec-dl-exe-sub').screenshot({ path: join(SHOTS, 'fidati-piattaforma.png') });

      // Riaperta, la pagina rimette la riga scartata al suo posto e ridice il perché.
      await sec.reload();
      await expect(sec.locator('#sec-dl-trusted')).toHaveValue('github.io\ndownload.mozilla.org\nfaceb', { timeout: 10_000 });
      await expect(errore).toContainText('«github.io» raccoglie i siti di chiunque', { timeout: 10_000 });

      // Il sito preciso entra, e copre solo sé.
      await casella.fill('alice.github.io');
      await casella.press('Tab');
      await expect.poll(async () => (await salvati()).trustedSites, { timeout: 10_000 }).toEqual(['alice.github.io']);
      await expect(errore).toBeHidden();
    } finally { await srv.close(); }
  });
});
