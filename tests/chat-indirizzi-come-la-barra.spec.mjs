// #1318 — Quello che si chiede alla chat di aprire si legge come dalla barra: localhost con la porta è una pagina, la
// posta va al programma di posta, un percorso (anche fra virgolette o sulla chiavetta) è un file fermato e detto, mai una
// ricerca. Il modello è finto: si guarda cosa vede l'utente e cosa torna al modello per rispondergli.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

const naviga = (id, url, etichetta) => ({ id, name: 'NAVIGA', arguments: JSON.stringify(etichetta ? { url, etichetta } : { url }) });
const esitoPerIlModello = async (app, id) => {
  for (const giro of await chiamateAlModello(app)) {
    const m = giro.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content || '');
  }
  return '';
};
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const avvisiBloccati = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1' && /bloccat/.test(c.textContent)).length);
const cerche = async (app) => (await schede(app)).filter((u) => /google\.[a-z]+\/search/.test(u));

test.afterEach(async ({ app }) => { await ripristina(app); });

test('localhost con la porta chiesto alla chat si apre, e il suo bottone in chat lo riapre', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const scritto = testServer.html('<title>Server di sviluppo</title><p>pronto</p>').replace('http://127.0.0.1', 'localhost');
  const pagina = `http://${scritto}`;
  // Un'apertura riuscita chiude il turno senza richiamare il modello (#1130): quello che dice l'ha scritto insieme.
  await modelloFinto(app, [{ text: 'Apro il server di sviluppo.', toolCalls: [naviga('n1', scritto, 'Server di sviluppo')] }]);
  const page = await home(app);
  await chiedi(page, `apri ${scritto}`);

  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(1);
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Apro il server di sviluppo.', { timeout: 10_000 });

  const bottone = page.locator('a.dash-action-link-chip');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone).toHaveAttribute('href', pagina);
  // La pagina l'assistente l'ha appena aperta: il bottone la riapre senza chiedere un OK «non ho potuto controllare».
  await page.evaluate(() => {
    window.__ok = [];
    if (window.SN_CONFIRM_UI) window.SN_CONFIRM_UI.confirm = async (o) => { window.__ok.push(String(o && o.text)); return false; };
  });
  await bottone.evaluate((a) => a.click());
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(2);
  expect(await page.evaluate(() => window.__ok), 'nessun OK chiesto per la pagina appena aperta').toEqual([]);
  expect(await avvisiBloccati(shell), 'nessun «bloccato per sicurezza» per una pagina che si apre').toBe(0);
  expect(await cerche(app)).toEqual([]);
});

test('«scrivi una mail a Mario»: si apre il programma di posta e il modello sa che la bozza la manda l\'utente', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  const posta = 'mailto:mario.rossi@esempio.it?subject=Cena%20di%20sabato';
  // Un turno solo (#1130): che la bozza la manda l'utente il modello lo sa prima, dalla descrizione dell'azione.
  await modelloFinto(app, [{ text: 'Ti apro la mail per Mario: la mandi tu.', toolCalls: [naviga('m1', posta)] }]);
  await app.evaluate(() => {
    const finto = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__strumenti = '';
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = (o) => { globalThis.__strumenti = JSON.stringify(o.tools || []); return finto(o); };
  });
  const page = await home(app);
  const prima = await schede(app);
  await chiedi(page, 'scrivi una mail a mario.rossi@esempio.it per la cena di sabato');

  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual([posta]);
  expect(await app.evaluate(() => globalThis.__strumenti)).toContain('si apre il programma di posta con la bozza');
  await page.waitForTimeout(500);
  expect(await schede(app), 'la posta non apre schede').toEqual(prima);
  expect(await avvisiBloccati(shell)).toBe(0);
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ti apro la mail per Mario: la mandi tu.');
  await page.screenshot({ path: 'tests/.shots/chat-indirizzi-posta.png' });
});

test('la posta chiesta senza «mailto:»: il bottone in chat la riapre, non una ricerca Google', async ({ app }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  await modelloFinto(app, [{ text: 'Ti apro la mail.', toolCalls: [naviga('m2', 'mario.rossi@esempio.it')] }, { text: 'Fatto.' }]);
  const page = await home(app);
  await chiedi(page, 'scrivi una mail a mario.rossi@esempio.it');
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual(['mailto:mario.rossi@esempio.it']);
  const bottone = page.locator('a.dash-action-link-chip');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone).toHaveAttribute('href', 'mailto:mario.rossi@esempio.it');
  await expect(bottone).toContainText('mario.rossi@esempio.it');
  await bottone.evaluate((a) => a.click());
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 10_000 })
    .toEqual(['mailto:mario.rossi@esempio.it', 'mailto:mario.rossi@esempio.it']);
  expect(await cerche(app)).toEqual([]);
});

test('un percorso fra virgolette o sulla chiavetta non diventa una ricerca: è fermato, e il modello sa quale file', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Banca');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'conto marzo.pdf');
  writeFileSync(file, '%PDF-1.4');
  await modelloFinto(app, [
    { toolCalls: [
      naviga('w1', '"C:\\Users\\agenti AI\\Documenti\\conto.pdf"'),
      naviga('l1', '/run/media/utente/CHIAVETTA/conto.pdf'),
      { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: `"${file}"` }) },
    ] },
    { text: 'Non posso aprirli in una scheda.' },
  ]);
  const page = await home(app);
  await chiedi(page, 'apri questi file');

  await expect.poll(() => esitoPerIlModello(app, 'w1'), { timeout: 15_000 })
    .toContain('Pagina NON aperta (File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf)');
  expect(await esitoPerIlModello(app, 'w1')).toContain('non cercarlo sul web');
  expect(await esitoPerIlModello(app, 'l1')).toContain('Pagina NON aperta (File del computer bloccato per sicurezza: /run/media/utente/CHIAVETTA/conto.pdf)');
  expect(await cerche(app), 'nessuna ricerca di un percorso').toEqual([]);

  // Lo stesso percorso fra virgolette, come bottone del file, è il file vero.
  const bottone = page.locator('.dash-file-btn');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone.locator('.dash-file-btn-nome')).toHaveText('conto marzo.pdf');
  await expect(bottone).toHaveAttribute('data-percorso', file);
  await page.locator('.dash-activity-head').first().click();
  await page.waitForTimeout(400);
  await page.locator('.dash-activity-seg-head').first().click({ force: true });
  await page.waitForTimeout(600);
  // Anche il diario della risposta dice quale file è stato fermato.
  await expect(page.locator('.dash-activity').first()).toContainText('Link non aperto · File del computer bloccato per sicurezza: /run/media/utente/CHIAVETTA/conto.pdf');
  await page.screenshot({ path: 'tests/.shots/chat-indirizzi-percorsi.png' });
});
