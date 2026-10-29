// La pulizia della riapertura (#349) su Filo chiuso e riaperto davvero, sulla stessa cartella dati: giudica solo la
// sessione di prima, e il suo avviso riapre quello che ha chiuso. Le altre garanzie: tab-reorder-reopen.spec.mjs.

import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(RADICE, 'tests', '.shots');
const PAGINE = {
  'blu.test': ['Blu', 'rgb(40,80,200)', 'Il documento su cui lavoro'],
  'vecchia.test': ['Vecchia', 'rgb(230,200,40)', 'Le notizie di tre giorni fa'],
  'verde.test': ['Verde', 'rgb(40,200,80)', 'Una chat aperta'],
  'rosso.test': ['Rosso', 'rgb(200,40,40)', 'Una pagina di lavoro'],
  'nuova.test': ['Nuova', 'rgb(160,60,200)', 'Risultati della ricerca appena fatta'],
};
const HOSTS = Object.keys(PAGINE);
const pagina = ([titolo, colore, testo]) => `<!doctype html><html><head><title>${titolo}</title>`
  + `<meta name="theme-color" content="${colore}"></head><body><h1>${titolo}</h1><p>${testo}</p>`
  + '<div style="height:1500px"></div></body></html>';

function lancia(userData) {
  return electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`, '.'],
    cwd: RADICE,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
}

// `tutte`: un modello deciso fino in fondo, come chiede il prompt della riapertura, che archivia tutto quello che riceve.
async function modelloFinto(app, { tutte = false } = {}) {
  await app.evaluate((_, tutte) => {
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sistema = String((messages[0] && messages[0].content) || '');
      const utente = messages.slice(1).map((m) => String(m.content || '')).join('\n');
      const fine = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (/METADATI/.test(sistema + utente)) return fine('{"suspicious":false,"reason":null,"confidence":"low"}');
      if (!/gestore delle schede/.test(sistema)) return fine('ok');
      const decisions = [];
      for (const riga of utente.split('\n')) {
        const m = /^#(\d+)\s/.exec(riga);
        if (!m) continue;
        const inattiva = /inattiva da (\d+)min/.exec(riga);
        const vecchia = inattiva && Number(inattiva[1]) >= 600;
        decisions.push({ i: Number(m[1]), action: tutte || vecchia ? 'archive' : 'keep', reason: 'test' });
      }
      return fine(JSON.stringify({ decisions }));
    };
  }, tutte);
}

const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('.shell-notif.show .shell-notif-msg')]
  .map((el) => el.textContent));
const titoliTest = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .filter((t) => /\.test:/.test(t.url || '')).map((t) => t.title));

// `lente`: alla riapertura le pagine della sessione di prima ci mettono qualche secondo, come su una connessione vera.
async function servitore() {
  const stato = { lente: false };
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const p = PAGINE[host];
    const rispondi = () => {
      res.writeHead(p ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(p ? pagina(p) : 'no');
    };
    if (stato.lente && host !== 'nuova.test') setTimeout(rispondi, 2500); else rispondi();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, stato, port: server.address().port };
}

// Prima sessione: quattro siti; quello vecchio non toccato da tre giorni. Poi Filo si chiude.
async function primaSessione(userData, port) {
  const app = await lancia(userData);
  const shell = await primaFinestra(app);
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...T.models },
      modelRegistry: { ...T.registry },
      autoArchive: { enabled: true, onClose: true, onIdle: false, idleHours: 6 },
    });
  });
  for (const h of ['blu.test', 'vecchia.test', 'verde.test', 'rosso.test']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${h}:${port}/`);
  }
  await expect.poll(async () => (await titoliTest(shell)).length, { timeout: 20_000 }).toBe(4);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => /blu\.test/.test(t.url)).id);
    tm.tabs.find((t) => /vecchia\.test/.test(t.url)).lastInteractionAt = Date.now() - 3 * 24 * 3600 * 1000;
    tm._persistSession();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await chiudiApp(app);
}

test('una scheda aperta dopo la riapertura non finisce nella pulizia della sessione di prima', async () => {
  test.setTimeout(150_000);
  const { server, stato, port } = await servitore();
  const userData = cartellaTemporanea('filo-test-349-');
  try {
    await primaSessione(userData, port);
    stato.lente = true;
    const app = await lancia(userData);
    const shell = await primaFinestra(app);
    await modelloFinto(app, { tutte: true });
    // L'utente riapre Filo e, mentre le schede di prima si ricaricano, cerca una cosa nuova e poi torna al documento.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://nuova.test:${port}/`);
    await expect.poll(() => titoliTest(shell), { timeout: 15_000 }).toContain('Nuova');
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      const blu = tm.tabs.find((t) => /blu\.test/.test(t.url));
      if (blu) tm.activate(blu.id);
    });
    await expect.poll(() => avvisi(shell), { timeout: 60_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^Schede riordinate/)]));
    expect(await titoliTest(shell), 'la scheda appena aperta dall’utente è stata chiusa dalla pulizia della sessione di prima').toContain('Nuova');
    await chiudiApp(app);
  } finally {
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('l’avviso della riapertura che ha chiuso delle schede le riapre con un clic', async () => {
  test.setTimeout(150_000);
  const { server, port } = await servitore();
  const userData = cartellaTemporanea('filo-test-349-');
  try {
    await primaSessione(userData, port);
    const app = await lancia(userData);
    const shell = await primaFinestra(app);
    await modelloFinto(app);
    await expect.poll(() => avvisi(shell), { timeout: 60_000 }).toContain('Schede riordinate, 1 chiusa. La ritrovi nel filo della home');
    expect(await titoliTest(shell)).not.toContain('Vecchia');
    const azioni = await shell.evaluate(() => [...document.querySelectorAll('.shell-notif.show')]
      .filter((c) => /Schede riordinate/.test(c.textContent))
      .flatMap((c) => [...c.querySelectorAll('.shell-notif-action')].map((b) => b.textContent)));
    expect(azioni, 'l’avviso non offre di riaprire la scheda appena chiusa').toEqual(['Riapri']);
    // Il clic dell'utente arriva alla vista degli avvisi sopra la pagina, non alla pila nascosta della barra.
    const vista = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avvisi.html'), 'la vista degli avvisi non è nata');
    const riapri = vista.locator('.shell-notif.show', { hasText: 'Schede riordinate' }).locator('.shell-notif-action', { hasText: 'Riapri' });
    await expect(riapri).toBeEnabled({ timeout: 10_000 });
    mkdirSync(SHOTS, { recursive: true });
    await vista.screenshot({ path: join(SHOTS, 'riapertura-pulizia-riapri.png') });
    await riapri.click();
    await expect.poll(() => titoliTest(shell), { timeout: 15_000 }).toContain('Vecchia');
    await chiudiApp(app);
  } finally {
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
