// #867 — ogni cambio di stato, chiesto in chat o fatto da una pagina, diventa un evento del filo
// nel momento in cui si salva, e si annulla con un clic o chiedendo «rimetti come prima».
// Ogni prova asserisce il successo dal punto di vista dell'utente: senza il registro sono rosse.

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    // L'intervista di benvenuto ha una chat sua: qui serve la chat di tutti i giorni.
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
  }, extra);
}

// Il modello finto: un giro per elemento di `giri`. `annullaTema: true` cerca nel prompt l'id del
// cambio del tema e lo annulla, come farebbe il modello leggendo i CAMBI RECENTI.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__finto_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__finto_prompt = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const testo = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__finto_prompt.push(testo);
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      let calls = giro.toolCalls || [];
      if (giro.annullaTema) {
        const m = testo.match(/(c[0-9a-f]{10}): tema: chiaro → scuro/);
        calls = [{ id: 'u1', name: 'ANNULLA_CAMBIO', arguments: JSON.stringify({ id: m ? m[1] : 'nessuno' }) }];
      }
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__finto_restore?.(); } catch (_) {} });

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  const r = await globalThis.chrome.storage.local.get('filo_cambi');
  return r.filo_cambi || [];
});

async function scrivi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 10_000 });
}

test('A — «tema scuro» in chat: segno sulla bolla, «tema: chiaro → scuro · annulla», e annulla riporta il chiaro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  expect((await impostazioni(app)).theme).toBe('dark');

  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  const segno = bolla.locator('.dash-cambi-segno');
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(segno).toBeVisible();
  await expect(pop).toHaveCSS('opacity', '0');
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(pop).toHaveCSS('opacity', '1');
  await expect(pop.locator('.dash-cambi-riga')).toHaveCount(1);
  await expect(pop).toContainText('tema: chiaro → scuro');
  await expect(pop.locator('.dash-cambi-annulla')).toHaveText('annulla');
  // La riga del blocco di attività parla come la pagina Preferenze, non con la chiave interna (#557).
  await page.locator('.dash-activity-head').click();
  await expect(page.locator('.dash-activity-row', { hasText: 'Impostato · tema: chiaro → scuro' })).toHaveCount(1);
  await expect(page.locator('.dash-activity-row', { hasText: '=' })).toHaveCount(0);
  await bolla.locator(".dash-cambi-segno").hover();
  await page.screenshot({ path: 'tests/.shots/cambi-segno-tema-scuro.png' });

  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await expect(pop.locator('.dash-cambi-riga')).toHaveClass(/dash-cambi-annullato/);
  await expect(pop.locator('.dash-cambi-annulla')).toHaveText('rifai');
  await expect(segno).toHaveClass(/dash-cambi-tutti-annullati/);
  await bolla.locator(".dash-cambi-segno").hover();
  await page.screenshot({ path: 'tests/.shots/cambi-segno-annullato-chiaro.png' });

  // L'annullo resta come evento, che annulla quello della chat.
  const eventi = await registro(app);
  const tema = eventi.filter((e) => e.cambi.some((c) => c.chiave === 'theme'));
  const daChat = tema.find((e) => e.via === 'chat');
  expect(daChat).toBeTruthy();
  const annullo = tema.find((e) => e.annulla === daChat.id);
  expect(annullo).toBeTruthy();
  expect(annullo.cambi[0]).toMatchObject({ prima: 'dark', dopo: 'light' });

  // E si rifà: rifai rimette lo scuro.
  await bolla.locator(".dash-cambi-segno").hover();
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await expect(pop.locator('.dash-cambi-annulla')).toHaveText('annulla');
  await ripristina(app);
});

test('B — tema cambiato dalle Preferenze, poi «rimetti come prima» in chat: torna il valore di prima', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#theme')).toHaveValue('light');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  const daPagina = (await registro(app)).filter((e) => e.cambi.some((c) => c.chiave === 'theme')).pop();
  expect(daPagina).toMatchObject({ via: 'interfaccia', dove: 'preferences' });

  const page = await homeDi(app);
  await shell.locator('.tab').first().click();
  await modelloFinto(app, [{ annullaTema: true }, { text: 'Rimesso.' }]);
  await scrivi(page, 'rimetti come prima', 'Rimesso.');
  // Il modello l'ha visto nello STATO, con la sua provenienza, ed è tornato il chiaro.
  const prompt = await app.evaluate(() => globalThis.__finto_prompt[0]);
  expect(prompt).toContain('CAMBI RECENTI');
  expect(prompt).toMatch(/dalle Preferenze\] c[0-9a-f]{10}: tema: chiaro → scuro/);
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  // Anche l'annullo chiesto a parole lascia il segno sulla bolla, e si può a sua volta annullare.
  const bolla = page.locator('.dash-bubble-user', { hasText: 'rimetti come prima' });
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-pop')).toContainText('tema: scuro → chiaro');
  await ripristina(app);
});

test('C — trascinare il cursore della velocità di lettura lascia UN evento, non uno per passo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const pref = await openTab('filo://preferences/preferences.html');
  const cursore = pref.locator('#ttsRate');
  await expect(cursore).toBeVisible();
  const prima = (await registro(app)).length;
  for (const v of ['1.1', '1.2', '1.3', '1.4', '1.5']) {
    await cursore.evaluate((el, x) => { el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    // Una pausa lunga quanto basta perché la pagina salvi a metà del gesto.
    await pref.waitForTimeout(550);
  }
  await cursore.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  await expect.poll(async () => (await impostazioni(app)).tts.rate).toBe(1.5);
  await pref.waitForTimeout(300);
  const nuovi = (await registro(app)).slice(prima).filter((e) => e.cambi.some((c) => c.chiave === 'tts.rate'));
  expect(nuovi).toHaveLength(1);
  expect(nuovi[0].cambi).toEqual([{ chiave: 'tts.rate', prima: 1, dopo: 1.5 }]);
  const frase = await app.evaluate((_e, ev) => globalThis.SN_CAMBI.frase(ev), nuovi[0]);
  expect(frase).toBe('velocità di lettura: 1× → 1,5×');
});

test('D — da una finestra incognito nessun evento arriva su disco, ma lì dentro il segno c\'è', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  // Le due home hanno lo stesso indirizzo: quella della finestra incognito la segna il main.
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    const t = w && w._filoTabs && w._filoTabs.tabs[0];
    if (!t || !t.view || !String(t.view.webContents.getURL()).startsWith('filo://newtab')) return false;
    try { await t.view.webContents.executeJavaScript('document.documentElement.dataset.provaIncognito = "1"; true'); } catch (_) { return false; }
    return true;
  }), { timeout: 10_000 }).toBe(true);
  let incog = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      if (!w.url().startsWith('filo://newtab')) continue;
      if (await w.evaluate(() => document.documentElement.dataset.provaIncognito === '1').catch(() => false)) { incog = w; return true; }
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);
  await expect(incog.locator('#input')).toBeVisible();
  await modelloFinto(app, [
    { toolCalls: [{ id: 'i1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"segreto incognito"}' }] },
    { text: 'Avviato.' },
  ]);
  await scrivi(incog, 'timer 10 minuti per il segreto incognito', 'Avviato.');
  const bolla = incog.locator('.dash-bubble-user', { hasText: 'segreto incognito' });
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-pop')).toContainText('nuovo timer «segreto incognito», 10 min');

  await app.evaluate(async () => { await globalThis.SN_REGISTRO_CAMBI.attesa(); await globalThis.__filoStorage.flushNow(); });
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const disco = readFileSync(join(userData, 'storage.json'), 'utf8');
  expect(disco).not.toContain('segreto incognito');
  const normale = await registro(app);
  expect(JSON.stringify(normale)).not.toContain('segreto incognito');
  await ripristina(app);
});

test('E — un\'importazione di dati diventa un evento suo, e si annulla come gli altri', async ({ app }) => {
  test.setTimeout(30_000);
  await configura(app);
  const file = join(cartellaTemporanea('filo-imp-cambi-'), 'backup.zip');
  writeFileSync(file, buildExportZip({ settings: { theme: 'dark', textScale: 1.25 } }));
  const esito = await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    const H = globalThis.__filoHandlers;
    const mittente = { url: 'filo://security/security.html', tab: { url: 'filo://security/security.html' } };
    const anteprima = await H.handleMessage({ type: globalThis.SN_MSG.MSG.IMPORT_DATA_PREVIEW }, mittente);
    const fatto = await H.handleMessage({ type: globalThis.SN_MSG.MSG.IMPORT_DATA_APPLY, token: anteprima.token }, mittente);
    return { anteprima: !!anteprima.ok, fatto: !!fatto.ok };
  }, file);
  expect(esito).toEqual({ anteprima: true, fatto: true });
  expect((await impostazioni(app)).theme).toBe('dark');
  const ev = (await registro(app)).filter((e) => e.via === 'importazione').pop();
  expect(ev).toBeTruthy();
  const frase = await app.evaluate((_e, e) => globalThis.SN_CAMBI.frase(e) + ' · ' + globalThis.SN_CAMBI.provenienza(e), ev);
  expect(frase).toContain('tema: chiaro → scuro');
  expect(frase).toContain('dimensione del testo: 100% → 125%');
  expect(frase).toContain('dall\'importazione dei dati');
  const r = await app.evaluate((_e, id) => globalThis.SN_REGISTRO_CAMBI.annulla(id, { via: 'interfaccia' }), ev.id);
  expect(r.ok).toBe(true);
  const s = await impostazioni(app);
  expect([s.theme, s.textScale]).toEqual(['light', 1]);
});

test('F — un timer chiesto in chat: annulla lo toglie, e riaperta la chat il segno è ancora lì col suo stato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"pasta"}' }] },
    { text: 'Avviato.' },
  ]);
  await scrivi(page, 'timer 10 minuti per la pasta', 'Avviato.');
  const timer = () => app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(await timer()).toContain('pasta');
  const bolla = page.locator('.dash-bubble-user', { hasText: 'timer 10 minuti' });
  await bolla.locator(".dash-cambi-segno").hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('nuovo timer «pasta», 10 min');
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(timer).not.toContain('pasta');
  await expect(pop.locator('.dash-cambi-riga')).toHaveClass(/dash-cambi-annullato/);

  // La chat riaperta dall'archivio ritrova il segno, già annullato.
  const id = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list())[0].id);
  await page.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  const riaperta = page.locator('.dash-bubble-user', { hasText: 'timer 10 minuti' });
  await expect(riaperta.locator('.dash-cambi-segno')).toHaveClass(/dash-cambi-tutti-annullati/, { timeout: 10_000 });
  await riaperta.locator(".dash-cambi-segno").hover();
  await expect(riaperta.locator('.dash-cambi-pop')).toContainText('nuovo timer «pasta», 10 min');
  await ripristina(app);
});

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head>
<body><h1>una pagina qualunque</h1><p>testo da ingrandire</p></body></html>`;

async function zoomDi(app, page) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let qui = '';
      try { qui = wc.getURL(); } catch (_) {}
      if (qui === u) return Math.round(wc.getZoomFactor() * 100);
    }
    return null;
  }, url);
}

test('G — lo zoom chiesto in chat è un evento che si annulla; una raffica di tasti è UN evento', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const r = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION({ type: 'ZOOM_PAGINA', percentuale: 150 }, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  });
  expect(r.executed).toBe(true);
  expect(r.cambi).toHaveLength(1);
  expect(r.cambi[0].frase).toMatch(/^zoom di [\w.-]+: 100% → 150%$/);
  await expect.poll(() => zoomDi(app, page)).toBe(150);
  const annullo = await app.evaluate((_e, id) => globalThis.SN_REGISTRO_CAMBI.annulla(id, { via: 'interfaccia' }), r.cambi[0].id);
  expect(annullo.ok).toBe(true);
  await expect.poll(() => zoomDi(app, page)).toBe(100);

  const prima = (await registro(app)).length;
  await page.locator('h1').click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Equal');
  await expect.poll(() => zoomDi(app, page)).toBeGreaterThan(125);
  const dopo = await zoomDi(app, page);
  await expect.poll(async () => (await registro(app)).slice(prima).filter((e) => e.tipo === 'zoom').length, { timeout: 5_000 }).toBe(1);
  const ev = (await registro(app)).slice(prima).find((e) => e.tipo === 'zoom');
  expect(ev).toMatchObject({ via: 'interfaccia', dove: 'zoom' });
  expect(ev.cambi[0]).toMatchObject({ prima: 100, dopo });
});

test('H — annulla quando lo stato era già tornato com\'era: l\'annullo resta, e «rifai» rimette il cambio', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'h1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  // Nel frattempo l'utente lo rimette a mano.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'light' }); });
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  const pop = bolla.locator('.dash-cambi-pop');
  await bolla.locator(".dash-cambi-segno").hover();
  await pop.locator('.dash-cambi-annulla').click();
  await expect(pop.locator('.dash-cambi-riga')).toHaveClass(/dash-cambi-annullato/);
  expect((await impostazioni(app)).theme).toBe('light');
  await bolla.locator(".dash-cambi-segno").hover();
  await pop.locator('.dash-cambi-annulla', { hasText: 'rifai' }).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await expect(pop.locator('.dash-cambi-riga')).not.toHaveClass(/dash-cambi-annullato/);
  await ripristina(app);
});

test('I — un sito non legge né annulla i cambi: solo le pagine di Filo', async ({ app }) => {
  await configura(app);
  const r = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    const { MSG } = globalThis.SN_MSG;
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    const lista = (await globalThis.chrome.storage.local.get('filo_cambi')).filo_cambi || [];
    const id = lista[lista.length - 1].id;
    const sito = { tab: { url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/' };
    const filo = { tab: { url: 'filo://newtab/' }, url: 'filo://newtab/' };
    return {
      leggiSito: await H.handleMessage({ type: MSG.CAMBI_LEGGI, ids: [id] }, sito),
      annullaSito: await H.handleMessage({ type: MSG.CAMBI_ANNULLA, id }, sito),
      tema: (await globalThis.SN_STORAGE.getSettings()).theme,
      leggiFilo: await H.handleMessage({ type: MSG.CAMBI_LEGGI, ids: [id] }, filo),
    };
  });
  expect(r.leggiSito.code).toBe('forbidden');
  expect(r.annullaSito.code).toBe('forbidden');
  expect(r.tema).toBe('light');
  expect(r.leggiFilo.ok).toBe(true);
  expect(r.leggiFilo.eventi[0].frasi.join(' ')).toContain('tema: come il sistema → chiaro');
});

test('J — il tasto destro sulla bolla col segno offre l\'annullo e il rifai, come la pastiglia', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  await expect(bolla.locator('.dash-cambi-segno')).toBeVisible();
  const menu = page.locator('.sn-menu');

  await bolla.click({ button: 'right', position: { x: 20, y: 10 } });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/cambi-tasto-destro-annulla.png' });
  await menu.getByText('Annulla · tema: chiaro → scuro', { exact: true }).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('rifai');

  await page.mouse.move(5, 400);
  await bolla.click({ button: 'right', position: { x: 20, y: 10 } });
  await menu.getByText('Rifai · tema: chiaro → scuro', { exact: true }).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('annulla');

  // Sulla risposta di Filo, che non ha cambiato niente, la voce non c'è.
  await page.mouse.move(5, 400);
  await page.locator('.dash-bubble-filo', { hasText: 'Fatto.' }).click({ button: 'right', position: { x: 10, y: 10 } });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/^(Annulla|Rifai) ·/)).toHaveCount(0);
  await ripristina(app);
});

test('K — due annulli dello stesso cambio arrivati insieme ne fanno uno: «rifai» rimette il cambio e il segno lo dice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  const id = (await registro(app)).find((e) => e.via === 'chat' && e.cambi.some((c) => c.chiave === 'theme')).id;
  // Il clic sul segno e l'«annulla» chiesto in chat nello stesso momento.
  const esiti = await app.evaluate(async (_e, i) => Promise.all([
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'interfaccia' }),
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'chat' }),
  ]), id);
  expect(esiti.map((r) => r.ok)).toEqual([true, false]);
  expect((await registro(app)).filter((e) => e.annulla === id)).toHaveLength(1);
  expect((await impostazioni(app)).theme).toBe('light');

  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('rifai');
  await bolla.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await bolla.locator(".dash-cambi-segno").hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('annulla');
  await ripristina(app);
});

test('L — tasto destro sulla riga del blocco che nomina il cambio: annulla da lì, e la riga dice che è annullato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  const menu = page.locator('.sn-menu');
  // Anche l'intestazione del blocco chiuso offre l'annullo del turno.
  await page.locator('.dash-activity-head').first().click({ button: 'right' });
  await expect(menu.getByText(/^Annulla · tema: chiaro → scuro$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.locator('.dash-activity-head').first().click();
  const riga = page.locator('.dash-activity-row', { hasText: 'tema: chiaro → scuro' }).first();
  await riga.click({ button: 'right' });
  await menu.getByText(/^Annulla · tema: chiaro → scuro$/).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await expect(riga).toHaveClass(/dash-cambi-annullato/);
  await expect(riga).toContainText('annullato');
  // E da lì si rifà: la riga torna in piedi.
  await riga.click({ button: 'right' });
  await menu.getByText(/^Rifai · tema: chiaro → scuro$/).click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await expect(riga).not.toHaveClass(/dash-cambi-annullato/);
  await ripristina(app);
});

test('M — passare sul testo della bolla non apre la pastiglia sopra la risposta di prima; il segno sì', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { text: 'Ciao.' },
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'ciao', 'Ciao.');
  await scrivi(page, 'tema scuro', 'Fatto.');
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  const pop = bolla.locator('.dash-cambi-pop');
  await bolla.hover({ position: { x: 12, y: 10 } });
  await page.waitForTimeout(400);
  await expect(pop).toHaveCSS('opacity', '0');
  await bolla.locator('.dash-cambi-segno').hover();
  await expect(pop).toHaveCSS('opacity', '1');
  // Dal segno alla pastiglia il mouse attraversa la bolla: la pastiglia aspetta e il clic arriva.
  const b = await pop.locator('.dash-cambi-annulla').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await ripristina(app);
});
