// #1618 — la pulizia automatica delle schede misura l'inattività dai gesti dell'utente, non dai caricamenti e dagli
// scorrimenti della pagina; alla riapertura vede da quanto una scheda non è toccata; un giudizio mancato si dice con
// un avviso; una pagina che non risponde non blocca la pulizia. La decisione del modello è simulata.

import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const ORA = 3600_000;

const pagina = (titolo, corpo = '', h = 3000) => `<!doctype html><html><head><title>${titolo}</title></head>`
  + `<body style="margin:0"><p>Testo di ${titolo}</p><div style="height:${h}px"></div>${corpo}</body></html>`;

// Si ricarica da sola ogni secondo e mezzo e a ogni caricamento scorre a metà: conta i caricamenti.
const RICARICA = pagina('Ricarica', `<script>
  sessionStorage.n = String(Number(sessionStorage.n || 0) + 1);
  window.scrollTo(0, 1200);
  setTimeout(() => location.reload(), 1500);
</script>`);
// Una chat che scende da sola verso i messaggi nuovi.
const SCORRE = pagina('Scorre', `<script>setInterval(() => window.scrollBy(0, 40), 250);</script>`, 40000);

// Stub del modello: registra cosa riceve e tiene tutto.
async function registraGiudizi(app) {
  await app.evaluate(() => {
    globalThis.__giudizi = [];
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs, trigger }) => {
      globalThis.__giudizi.push({ trigger, tabs: tabs.map((t) => ({ title: t.title, url: t.url, idleMin: t.idleMin, contentExtract: t.contentExtract })) });
      return { decisions: tabs.map((t, i) => ({ i, action: 'keep', reason: 'test' })) };
    };
  });
}

const statoScheda = (app, titolo) => app.evaluate(({ BrowserWindow }, t) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const tab = tm.tabs.find((x) => x.title === t);
  return {
    app: tm._lastAppInteractionAt,
    scheda: tab ? tab.lastInteractionAt : undefined,
    scrollPct: tab ? tab.scrollPct : undefined,
    attiva: tab ? tab.id === tm.activeId : false,
  };
}, titolo);

const indietro = (app, ms) => app.evaluate(({ BrowserWindow }, ms) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const prima = Date.now() - ms;
  tm._lastAppInteractionAt = prima;
  for (const t of tm.tabs) t.lastInteractionAt = prima;
  return prima;
}, ms);

const giroInattivita = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  await tm._autoArchiveTick();
  return globalThis.__giudizi.length;
});

test('una pagina che si ricarica o scorre da sola non azzera l’inattività: dopo le ore impostate la pulizia parte (#1618)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, RICARICA);
  const scorre = await testServer.openReady(openTab, SCORRE);
  expect((await statoScheda(app, 'Scorre')).attiva).toBe(true);
  await registraGiudizi(app);

  const prima = await indietro(app, 7 * ORA);
  const scrollIniziale = (await statoScheda(app, 'Scorre')).scrollPct;
  // Tre caricamenti della pagina che si ricarica e gli scorrimenti della chat sono arrivati al main.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const tab = tm.tabs.find((x) => x.title === 'Ricarica');
    return tab.view.webContents.executeJavaScript('Number(sessionStorage.n || 0)').catch(() => 0);
  }), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(async () => (await statoScheda(app, 'Scorre')).scrollPct, { timeout: 8_000 }).toBeGreaterThan(scrollIniziale);

  const ricarica = await statoScheda(app, 'Ricarica');
  expect(ricarica.app, 'un caricamento o uno scorrimento della pagina ha contato come uso di Filo').toBe(prima);
  expect(ricarica.scheda).toBe(prima);
  expect((await statoScheda(app, 'Scorre')).scheda).toBe(prima);

  expect(await giroInattivita(app), 'il giro dell’inattività non è partito').toBe(1);
  const giro = await app.evaluate(() => globalThis.__giudizi[0]);
  expect(giro.trigger).toBe('idle');
  const visto = giro.tabs.find((t) => t.title === 'Ricarica');
  expect(visto.idleMin).toBeGreaterThanOrEqual(7 * 60 - 1);

  // Un gesto vero conta ancora: un clic, poi la rotella.
  const dopoClic = await indietro(app, 7 * ORA);
  await scorre.mouse.click(30, 30);
  await expect.poll(async () => (await statoScheda(app, 'Scorre')).app, { timeout: 5_000 }).toBeGreaterThan(dopoClic + 6 * ORA);
  expect((await statoScheda(app, 'Scorre')).scheda).toBeGreaterThan(dopoClic + 6 * ORA);
  expect(await giroInattivita(app), 'il giro è partito dopo un clic dell’utente').toBe(1);

  await scorre.waitForTimeout(2100);
  const dopoRotella = await indietro(app, 7 * ORA);
  await scorre.mouse.move(200, 200);
  await scorre.mouse.wheel(0, 400);
  await expect.poll(async () => (await statoScheda(app, 'Scorre')).app, { timeout: 5_000 }).toBeGreaterThan(dopoRotella + 6 * ORA);
  expect(await giroInattivita(app), 'il giro è partito dopo la rotella').toBe(1);
});

test('un giudizio mancato nella pulizia automatica si dice con un avviso e nei log, una volta per motivo (#1618)', async ({ app, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, pagina('Vecchia'));
  await testServer.openReady(openTab, pagina('Davanti'));
  await app.evaluate(() => {
    globalThis.__avvisi = [];
    const warn = console.warn;
    console.warn = (...a) => { globalThis.__avvisi.push(a.map(String).join(' ')); warn.apply(console, a); };
    globalThis.__chiamate = 0;
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => {
      globalThis.__chiamate++;
      throw Object.assign(new Error('OpenRouter 402 Payment Required'), { provider: 'openrouter', status: 402, keySource: 'personal' });
    };
  });

  await indietro(app, 7 * ORA);
  await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._autoArchiveTick());
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(1);
  // La pila nella shell è il modello nascosto: l'avviso che si vede sta nella vista sopra la pagina.
  const shell = await avvisi();
  const avviso = shell.locator('.shell-notif-msg', { hasText: 'La pulizia automatica non è riuscita a valutare le schede' });
  await expect(avviso).toBeVisible({ timeout: 5_000 });
  await expect(avviso).toContainText('crediti di Filo sono finiti');
  expect((await app.evaluate(() => globalThis.__avvisi)).some((r) => /pulizia delle schede \(idle\).*402/.test(r))).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await shell.screenshot({ path: join(SHOTS, 'pulizia-giudizio-mancato.png') });

  // Resta finché non lo si chiude: il giro dell'inattività parte quando l'utente non c'è.
  await shell.waitForTimeout(6_000);
  await expect(avviso).toBeVisible();
  await avviso.locator('xpath=..').locator('.shell-notif-close').click();
  await expect(avviso).toHaveCount(0, { timeout: 3_000 });

  // Stesso motivo al giro dopo: nei log sì, nessun avviso nuovo.
  await indietro(app, 7 * ORA);
  await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._autoArchiveTick());
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(2);
  await shell.waitForTimeout(800);
  await expect(shell.locator('.shell-notif-msg', { hasText: 'La pulizia automatica' })).toHaveCount(0);

  // Un motivo nuovo (una risposta senza l'elenco) torna a dirlo, anche alla riapertura.
  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = async () => ({ testo: 'tengo tutto' }); });
  const r = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'reopen' }));
  expect(r.giudizioMancato).toBe(true);
  await expect(shell.locator('.shell-notif-msg', { hasText: 'senza dire quali schede tenere' })).toBeVisible({ timeout: 5_000 });

  // Il cammino manuale lo dice già lui: niente avviso in più.
  await shell.locator('.shell-notif-msg', { hasText: 'senza dire quali schede tenere' }).locator('xpath=..').locator('.shell-notif-close').click();
  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = async () => { throw new Error('rete giù'); }; });
  const manuale = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'manual' }));
  expect(manuale.giudizioMancato).toBe(true);
  await shell.waitForTimeout(800);
  await expect(shell.locator('.shell-notif-msg', { hasText: 'La pulizia automatica' })).toHaveCount(0);

  // Un giudizio riuscito chiude la serie: lo stesso guasto, dopo, si torna a dire.
  await registraGiudizi(app);
  await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'idle' }));
  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = async () => ({ testo: 'tengo tutto' }); });
  await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'idle' }));
  await expect(shell.locator('.shell-notif-msg', { hasText: 'senza dire quali schede tenere' })).toBeVisible({ timeout: 5_000 });
});

test('una pagina che non risponde non blocca la pulizia: il giro finisce senza il suo testo e il successivo parte (#1618)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, pagina('Bloccata'));
  await testServer.openReady(openTab, pagina('Viva'));
  await testServer.openReady(openTab, pagina('Davanti'));
  await registraGiudizi(app);
  const esito = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const bloccata = tm.tabs.find((t) => t.title === 'Bloccata');
    bloccata.view.webContents.executeJavaScript = () => new Promise(() => {});
    const corsa = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('bloccata'), 20_000))]);
    const inizio = Date.now();
    const primo = await corsa(tm.runAutoTriage({ trigger: 'manual' }));
    const durata = Date.now() - inizio;
    const secondo = await corsa(tm.runAutoTriage({ trigger: 'manual' }));
    return { primo, secondo, durata, inCorso: tm._triageRunning };
  });
  expect(esito.primo, 'la pulizia è rimasta appesa alla pagina che non risponde').not.toBe('bloccata');
  expect(esito.primo.giudizioMancato).toBeFalsy();
  expect(esito.durata).toBeLessThan(8_000);
  expect(esito.secondo).not.toBe('bloccata');
  expect(esito.secondo.giaInCorso).toBeFalsy();
  expect(esito.inCorso).toBe(false);
  const giro = await app.evaluate(() => globalThis.__giudizi[0]);
  expect(giro.tabs.find((t) => t.title === 'Bloccata').contentExtract).toBe('');
  expect(giro.tabs.find((t) => t.title === 'Viva').contentExtract).toContain('Testo di Viva');
});

// Due avvii di Filo sulla stessa cartella dati: la sessione la salva l'uscita vera, la rilegge la riapertura.
test('alla riapertura la pulizia vede da quanto ogni scheda non è toccata, non i minuti dal caricamento (#1618)', async () => {
  test.setTimeout(120_000);
  const pagine = new Map();
  const server = createServer((req, res) => {
    const corpo = pagine.get(req.url);
    res.writeHead(corpo ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(corpo || '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = (titolo) => { pagine.set(`/${titolo}`, pagina(titolo)); return `${origin}/${titolo}`; };
  const [toccata, adesso, mai, davanti] = ['Toccata', 'Adesso', 'Mai', 'Davanti'].map(url);
  const dati = cartellaTemporanea('filo-pulizia-riapertura-');
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({ filo_onboarding: { done: true } }));
  const avvia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' } });
  const apri = async (app, shell, u) => {
    await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => { try { return w.url() === u; } catch (_) { return false; } });
      return !!page;
    }, { timeout: 10_000 }).toBe(true);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
    return page;
  };

  let app = await avvia();
  try {
    let shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    await apri(app, shell, toccata);
    await apri(app, shell, mai);
    const pAdesso = await apri(app, shell, adesso);
    const primaDelClic = Date.now();
    await pAdesso.mouse.click(40, 40);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      return tm.tabs.find((t) => t.title === 'Adesso').lastInteractionAt || 0;
    }), { timeout: 5_000 }).toBeGreaterThanOrEqual(primaDelClic - 1000);
    await apri(app, shell, davanti);
    // «Toccata» l'ultima volta cinque ore fa; «Mai» aperta tre ore fa e mai toccata (una sessione senza il dato).
    await app.evaluate(({ BrowserWindow }, ORA) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.tabs.find((t) => t.title === 'Toccata').lastInteractionAt = Date.now() - 5 * ORA;
      const m = tm.tabs.find((t) => t.title === 'Mai');
      m.lastInteractionAt = null;
      m.openedAt = new Date(Date.now() - 3 * ORA).toISOString();
      m.paginaDal = null;
    }, ORA);
    await chiudiApp(app, { tetto: 15_000 });

    const salvata = JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8')).sn_open_tabs;
    const i = (u) => salvata.tabs.indexOf(u);
    expect(i(toccata)).toBeGreaterThanOrEqual(0);
    expect(Date.parse(salvata.usate[i(toccata)])).toBeLessThan(Date.now() - 5 * ORA + 60_000);
    expect(Date.parse(salvata.usate[i(adesso)])).toBeGreaterThanOrEqual(Math.floor(primaDelClic / 60_000) * 60_000);
    expect(salvata.usate[i(mai)]).toBeNull();

    app = await avvia();
    // Il gestore delle schede scrive il suo giudizio all'avvio: lo stub lo sostituisce e non si fa sovrascrivere.
    await app.evaluate(() => {
      globalThis.__giudizi = [];
      const stub = async ({ tabs, trigger }) => {
        globalThis.__giudizi.push({ trigger, tabs: tabs.map((t) => ({ url: t.url, idleMin: t.idleMin })) });
        return { decisions: tabs.map((t, k) => ({ i: k, action: 'keep', reason: 'test' })) };
      };
      Object.defineProperty(globalThis, 'SN_TAB_TRIAGE_DECIDE', { get: () => stub, set: () => {}, configurable: true });
    });
    shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è rinata');
    await expect.poll(() => app.evaluate(() => globalThis.__giudizi.length), { timeout: 60_000, message: 'la pulizia della riapertura non è partita' }).toBeGreaterThan(0);
    const giro = await app.evaluate(() => globalThis.__giudizi[0]);
    expect(giro.trigger).toBe('reopen');
    const idle = (u) => (giro.tabs.find((t) => t.url === u) || {}).idleMin;
    expect(idle(toccata), 'la scheda toccata cinque ore fa sembrava appena usata').toBeGreaterThanOrEqual(5 * 60 - 2);
    expect(idle(toccata)).toBeLessThanOrEqual(5 * 60 + 3);
    expect(idle(mai), 'la scheda mai toccata non ripiega sull’apertura').toBeGreaterThanOrEqual(3 * 60 - 2);
    expect(idle(adesso)).toBeLessThanOrEqual(3);
    expect(giro.tabs.some((t) => t.url === davanti), 'la scheda davanti non va mai al giudizio').toBe(false);
  } finally {
    await chiudiApp(app).catch(() => {});
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    rmSync(dati, { recursive: true, force: true });
  }
});
