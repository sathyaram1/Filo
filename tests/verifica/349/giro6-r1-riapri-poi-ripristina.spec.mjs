// Verifica #349 giro 6, rilievo 1: dopo «Riapri» sull'avviso della pulizia, riaprire l'ultima scheda chiusa
// (Ctrl/Cmd+Shift+T, menu) non deve ridare una seconda copia della pagina appena riportata.

import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGINE = {
  'blu.test': ['Blu', 'rgb(40,80,200)', 'Il documento su cui lavoro'],
  'vecchia.test': ['Vecchia', 'rgb(230,200,40)', 'Le notizie di tre giorni fa'],
  'verde.test': ['Verde', 'rgb(40,200,80)', 'Una chat aperta'],
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

async function modelloFinto(app) {
  await app.evaluate(() => {
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
        decisions.push({ i: Number(m[1]), action: inattiva && Number(inattiva[1]) >= 600 ? 'archive' : 'keep', reason: 'test' });
      }
      return fine(JSON.stringify({ decisions }));
    };
  });
}

const avvisi = (shell) => shell.evaluate(() => [...document.querySelectorAll('.shell-notif.show .shell-notif-msg')]
  .map((el) => el.textContent));
const titoliTest = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .filter((t) => /\.test:/.test(t.url || '')).map((t) => t.title));

test('r1 dopo «Riapri» sull’avviso della pulizia, riaprire l’ultima chiusa non duplica la scheda appena riportata', async () => {
  test.setTimeout(180_000);
  const server = createServer((req, res) => {
    const p = PAGINE[String(req.headers.host || '').split(':')[0]];
    res.writeHead(p ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(p ? pagina(p) : 'no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const userData = cartellaTemporanea('filo-test-349-g6-');
  try {
    let app = await lancia(userData);
    let shell = await primaFinestra(app);
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
    for (const h of HOSTS) await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${h}:${port}/`);
    await expect.poll(async () => (await titoliTest(shell)).length, { timeout: 20_000 }).toBe(3);
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.activate(tm.tabs.find((t) => /blu\.test/.test(t.url)).id);
      tm.tabs.find((t) => /vecchia\.test/.test(t.url)).lastInteractionAt = Date.now() - 3 * 24 * 3600 * 1000;
      tm._persistSession();
    });
    await new Promise((r) => setTimeout(r, 1500));
    await chiudiApp(app);

    app = await lancia(userData);
    shell = await primaFinestra(app);
    await modelloFinto(app);
    await expect.poll(() => avvisi(shell), { timeout: 60_000 }).toContain('Schede riordinate, 1 chiusa. La ritrovi nel filo della home');
    const vista = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avvisi.html'), 'la vista degli avvisi non è nata');
    const riapri = vista.locator('.shell-notif.show', { hasText: 'Schede riordinate' }).locator('.shell-notif-action', { hasText: 'Riapri' });
    await expect(riapri).toBeEnabled({ timeout: 10_000 });
    await riapri.click();
    await expect.poll(() => titoliTest(shell), { timeout: 15_000 }).toContain('Vecchia');
    // Lo stesso gesto della scorciatoia e della voce di menu «Riapri scheda chiusa».
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
    await new Promise((r) => setTimeout(r, 3000));
    const vecchie = (await titoliTest(shell)).filter((t) => t === 'Vecchia').length;
    expect(vecchie, 'la scheda riportata da «Riapri» torna una seconda volta riaprendo l’ultima chiusa').toBe(1);
    await chiudiApp(app);
  } finally {
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
