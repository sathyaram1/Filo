// #967 — «Continua» sull'avviso sospetto vale per sempre: il sito entra fra i «Siti di cui ti fidi» (Sicurezza) e
// l'avviso non torna in nessuna scheda, nemmeno dopo un riavvio, finché non lo togli. Il «confermo» del pericoloso
// resta della scheda. L'«Apri comunque» di «Non trovo» porta il sito nello stesso elenco. Logica: tests/unit/sitiFidati.test.mjs.

import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// team.com dista una lettera da Steam (il falso allarme della segnalazione); paypa1.com è un sosia stretto di PayPal.
const NOMI = ['team.com', 'paypa1.com'];

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>SITO967 ${req.url}</title><h1>Una pagina qualunque</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    porta: server.address().port,
    chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

const apri = (shell, url) => shell.evaluate((u) => window.filoShell.tabs.open(u), url);

// Lo stato della scheda il cui indirizzo contiene `pezzo`: il livello che Filo ha deciso e l'avviso a schermo.
const statoScheda = (app, pezzo) => app.evaluate(({ BrowserWindow }, f) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (!u.includes(f)) continue;
      return { livello: t.sbLevel || null, avviso: t.sbAvviso ? t.sbAvviso.level : null, coperta: w._filoTabs.avvisoSito.coperta() === t };
    }
  }
  return null;
}, pezzo);

// Una scheda nuova sul sito fidato: il controllo è passato (livello deciso) e l'avviso non c'è, nemmeno un attimo dopo.
async function senzaAvviso(app, pezzo) {
  await expect.poll(async () => (await statoScheda(app, pezzo))?.livello, { timeout: 12_000 }).toBe('safe');
  await new Promise((r) => setTimeout(r, 1500));
  expect(await statoScheda(app, pezzo)).toEqual({ livello: 'safe', avviso: null, coperta: false });
}

async function vistaAvviso(app) {
  return aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avviso-sito.html'), 'la vista dell\'avviso non è nata');
}

const fidatiSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.safeBrowse.trustedSites);

test.describe('con i nomi dei siti portati al server di prova', () => {
  test.use({ hostInPiu: NOMI });

  test('il «confermo» del pericoloso resta della scheda: in una scheda nuova l\'avviso torna', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await apri(shell, `http://paypa1.com:${srv.porta}/uno`);
      const avviso = await vistaAvviso(app);
      await expect(avviso.getByPlaceholder('confermo')).toBeVisible({ timeout: 12_000 });
      await avviso.getByPlaceholder('confermo').fill('confermo');
      await avviso.getByRole('button', { name: 'Procedi comunque' }).click();
      await expect.poll(async () => (await statoScheda(app, '/uno'))?.avviso).toBe(null);

      await apri(shell, `http://paypa1.com:${srv.porta}/due`);
      await expect.poll(async () => (await statoScheda(app, '/due'))?.avviso, { timeout: 12_000 }).toBe('pericoloso');
      expect(await fidatiSalvati(app)).toEqual([]);
    } finally {
      await srv.chiudi();
    }
  });

  test('«Annulla» nell\'avviso in basso toglie la fiducia, e l\'avviso sospetto torna sulla pagina', async ({ app, shell, avvisi }) => {
    const srv = await miniServer();
    try {
      await apri(shell, `http://team.com:${srv.porta}/annulla`);
      const avviso = await vistaAvviso(app);
      const continua = avviso.getByRole('button', { name: 'Continua' });
      await expect(continua).toBeEnabled({ timeout: 12_000 });
      await continua.click();
      const vista = await avvisi();
      const nota = vista.locator('.shell-notif.show', { hasText: 'team.com è fra i siti di cui ti fidi' });
      await expect(nota).toBeVisible({ timeout: 8_000 });
      await expect.poll(() => fidatiSalvati(app)).toEqual(['team.com']);
      await nota.locator('button', { hasText: 'Annulla' }).click();
      await expect.poll(() => fidatiSalvati(app)).toEqual([]);
      await expect.poll(async () => (await statoScheda(app, '/annulla'))?.avviso).toBe('sospetto');
    } finally {
      await srv.chiudi();
    }
  });

  test('dalla chat: togliere un sito parte subito, aggiungerlo aspetta la parola «conferma»', async ({ app }) => {
    const esegui = (valore, opzioni = {}) => app.evaluate(async (_e, a) => {
      const r = await globalThis.__filoHandlers.executeFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'siti_di_cui_ti_fidi', valore: a.valore }, a.opzioni);
      return { executed: !!(r && r.executed) };
    }, { valore, opzioni });
    await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['team.com', 'area967.it'] } } }));
    expect(await esegui('togli team.com')).toEqual({ executed: true });
    expect(await fidatiSalvati(app)).toEqual(['area967.it']);
    expect(await esegui('aggiungi team.com')).toEqual({ executed: false });
    expect(await fidatiSalvati(app)).toEqual(['area967.it']);
  });
});

test('«Continua» su un sito sospetto: niente avviso nelle schede nuove e dopo un riavvio; tolto in Sicurezza, torna', async () => {
  test.setTimeout(150_000);
  const srv = await miniServer();
  const userData = cartellaTemporanea('filo-fidati-');
  const lancia = () => electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${NOMI.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const sito = (p) => `http://team.com:${srv.porta}${p}`;
  let app = await lancia();
  try {
    const shell = await primaFinestra(app);
    await apri(shell, sito('/prima'));
    const avviso = await vistaAvviso(app);
    await expect(avviso.getByText(/assomiglia all'indirizzo di Steam/)).toBeVisible({ timeout: 12_000 });
    const continua = avviso.getByRole('button', { name: 'Continua' });
    await expect(continua).toBeEnabled();
    await continua.click();
    await expect.poll(async () => (await statoScheda(app, '/prima'))?.avviso).toBe(null);

    // Scritto sul disco, non solo in memoria.
    await expect.poll(() => {
      try { return JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).settings.security.safeBrowse.trustedSites; }
      catch (_) { return null; }
    }, { timeout: 10_000 }).toEqual(['team.com']);

    await apri(shell, sito('/nuova-scheda'));
    await senzaAvviso(app, '/nuova-scheda');
  } finally {
    await chiudiApp(app);
  }

  app = await lancia();
  try {
    const shell = await primaFinestra(app);
    await apri(shell, sito('/dopo-il-riavvio'));
    await senzaAvviso(app, '/dopo-il-riavvio');

    // In Sicurezza c'è, e da lì si toglie.
    await apri(shell, 'filo://security/security.html');
    const sicurezza = await aspettaFinestra(app, (w) => w.url().startsWith('filo://security/'), 'la pagina Sicurezza non si è aperta');
    const elenco = sicurezza.locator('#sec-safebrowse-fidati');
    await expect(elenco).toBeVisible({ timeout: 10_000 });
    await expect(elenco.locator('.sn-info-box-title')).toHaveText('Siti di cui ti fidi');
    const voce = elenco.locator('li', { hasText: 'team.com' });
    await expect(voce).toBeVisible();
    await sicurezza.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'siti-fidati-sicurezza.png'), fullPage: true }).catch(() => {});
    await voce.getByRole('button', { name: 'Togli' }).click();
    await expect(elenco).toBeHidden();
    await expect.poll(() => fidatiSalvati(app)).toEqual([]);

    await apri(shell, sito('/dopo-averlo-tolto'));
    await expect.poll(async () => (await statoScheda(app, '/dopo-averlo-tolto'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
    // La scheda aperta prima di toglierlo riprende l'avviso senza ricaricare.
    await expect.poll(async () => (await statoScheda(app, '/dopo-il-riavvio'))?.avviso).toBe('sospetto');
  } finally {
    await chiudiApp(app);
    await srv.chiudi();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// Un nome che il DNS non conosce: dove il DNS non risponde affatto ogni nome «esiste» e la prova non proverebbe niente.
const FINTO = 'nonesistedavvero-967-xyz.io';

test('«Apri comunque» su «Non trovo»: il sito entra fra quelli di cui ti fidi e non viene più messo in dubbio', async ({ app, openTab }) => {
  const casa = await openTab('filo://newtab/');
  const input = casa.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  const r = await casa.evaluate((h) => window.filo.siteResolves({ host: h }), FINTO);
  test.skip(!(r && r.resolves === false), 'nessuna risoluzione DNS su questa macchina');

  await input.fill(`/${FINTO}`);
  await input.press('Enter');
  const bolla = casa.locator('.dash-bubble-filo', { hasText: FINTO });
  await expect(bolla).toBeVisible({ timeout: 8000 });
  await bolla.locator('.dash-action-btn', { hasText: 'Apri comunque' }).click();
  await expect.poll(() => fidatiSalvati(app)).toEqual([FINTO]);

  // Una home nuova (la cache della pagina di prima non c'è): l'indirizzo si apre senza la domanda.
  const altra = await openTab('filo://newtab/?967');
  expect(await altra.evaluate((h) => window.filo.siteResolves({ host: h }), FINTO)).toMatchObject({ resolves: true });
  const campo = altra.locator('#input');
  await campo.waitFor({ state: 'visible', timeout: 8000 });
  await campo.fill(`/${FINTO}`);
  await campo.press('Enter');
  await expect(campo).toHaveValue('', { timeout: 8000 });
  await expect(altra.locator('.dash-bubble-filo', { hasText: FINTO })).toHaveCount(0);
});

test('«Togli» di fila in Sicurezza con un salvataggio lento: ogni clic toglie il sito che l\'utente vede in cima', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['uno967.it', 'due967.it', 'tre967.it', 'quattro967.it'] } } }));
  const sic = await openTab('filo://security/security.html');
  const box = sic.locator('#sec-safebrowse-fidati');
  await expect(box.locator('li')).toHaveCount(4, { timeout: 10_000 });
  // Un disco occupato: la scrittura dura più del tempo fra due clic, e l'elenco di prima arriva a pagina già cambiata.
  await app.evaluate(() => {
    const S = globalThis.SN_STORAGE;
    const vero = S.updateSettings;
    S.updateSettings = async (...a) => { await new Promise((r) => setTimeout(r, 400)); return vero.apply(S, a); };
  });
  const cliccati = [];
  for (let i = 0; i < 3; i++) {
    const riga = box.locator('li').first();
    cliccati.push((await riga.locator('span').textContent()).trim());
    await riga.getByRole('button', { name: 'Togli' }).click();
    await sic.waitForTimeout(250);
  }
  expect(cliccati).toEqual(['uno967.it', 'due967.it', 'tre967.it']);
  await expect.poll(() => fidatiSalvati(app), { timeout: 8000 }).toEqual(['quattro967.it']);
  await expect(box.locator('li')).toHaveText(['quattro967.it']);
});
