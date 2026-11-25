// #349.1 — una pagina lasciata a metà resta a metà dopo un riavvio di Filo: la sessione salva fin dove era arrivata la
// lettura (e il video o l'audio lungo), la pagina riaperta riparte da lì e il giudizio della riapertura lo riceve.

import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paragrafi = Array.from({ length: 120 }, (_, i) => `<p>Paragrafo ${i + 1} dell'articolo lungo, letto con calma.</p>`).join('');
const ARTICOLO = `<title>Articolo lungo</title><body style="margin:0;font:18px serif">${paragrafi}</body>`;
// Un audio di 80 secondi fatto dalla pagina stessa (WAV muto, 8 kHz a 8 bit): niente file da servire.
const ASCOLTO = `<title>Puntata lunga</title><body><h1>Puntata</h1><audio id="a" controls></audio><script>
  const n = 8000 * 80, b = new ArrayBuffer(44 + n), v = new DataView(b), s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(b, 44).fill(128);
  document.getElementById('a').src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
</script></body>`;

const lancia = (userData) => electron.launch({
  args: [...argomentiScala, '.'],
  cwd: RADICE,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

const statoScheda = (app, host) => app.evaluate(async ({ BrowserWindow }, h) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)?._filoTabs;
  const t = tm && tm.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  if (!t) return null;
  const [giudizio] = await tm._gatherTriageInput([t]);
  return { scrollPct: t.scrollPct, mediaPct: t.mediaPct ?? null, giudizio };
}, host);

// Quello che il giudizio della riapertura manda al modello per questa scheda: il modello qui non risponde, conta l'invio.
const rigaAlModello = (app, host) => app.evaluate(async ({ BrowserWindow }, h) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { return new URL(x.url).hostname === h; } catch (_) { return false; } });
  const P = globalThis.SN_PROVIDERS;
  const prima = P.completeWithFallback;
  let testo = '';
  P.completeWithFallback = async (o) => {
    testo = o.messages.map((m) => String(m.content || '')).join('\n');
    return { text: '{"decisions":[]}', provider: o.attempts[0].provider, model: o.attempts[0].model, usage: {} };
  };
  try {
    await globalThis.__filoHandlers.runTabTriageDecision({ tabs: await tm._gatherTriageInput([t]), trigger: 'reopen' }).catch(() => null);
  } finally { P.completeWithFallback = prima; }
  return testo.split('\n').find((r) => /^#0\s/.test(r)) || '';
}, host);

// Prima sessione: modelli finti pronti per il giudizio, ma niente pulizia automatica che chiuda la scheda da sola.
async function primaSessione(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...T.models },
      modelRegistry: T.registry,
      monthlyLimitEur: 5,
      autoArchive: { enabled: false, onClose: false, onIdle: false, idleHours: 6 },
    });
  });
}

const posizione = (pagina) => pagina.evaluate(() => Math.round(scrollY / (document.documentElement.scrollHeight - innerHeight) * 100));

test('un articolo letto a metà riparte da lì dopo il riavvio, e la pulizia lo sa', async ({ testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html(ARTICOLO);
  const host = new URL(url).hostname;
  const userData = cartellaTemporanea('filo-lettura-');
  let app;
  try {
    app = await lancia(userData);
    const shell = await primaFinestra(app);
    await primaSessione(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const pagina = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'la pagina dell’articolo');
    await pagina.waitForLoadState('load');
    await pagina.mouse.move(200, 200);
    const meta = await pagina.evaluate(() => (document.documentElement.scrollHeight - innerHeight) / 2);
    for (let fatto = 0; fatto < meta; fatto += 400) await pagina.mouse.wheel(0, Math.min(400, meta - fatto));
    await expect.poll(async () => (await statoScheda(app, host))?.scrollPct, { message: 'Filo deve sapere che è a metà' })
      .toBeGreaterThanOrEqual(40);
    const letta = (await statoScheda(app, host)).scrollPct;
    expect(letta).toBeLessThanOrEqual(60);
    // Un'altra scheda in primo piano, come nei passi della segnalazione: l'articolo resta dietro.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await new Promise((r) => setTimeout(r, 1000));
    await chiudiApp(app);
    app = null;

    app = await lancia(userData);
    await primaFinestra(app);
    await expect.poll(() => statoScheda(app, host), { timeout: 30_000 }).not.toBeNull();
    expect((await statoScheda(app, host)).giudizio.scrollPct).toBe(letta);
    expect(await rigaAlModello(app, host)).toContain(`scroll ${letta}%`);

    await app.evaluate(({ BrowserWindow }, h) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.activate(tm.tabs.find((x) => new URL(x.url).hostname === h).id);
    }, host);
    const riaperta = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'l’articolo riaperto');
    await riaperta.waitForLoadState('load');
    await expect.poll(() => posizione(riaperta), { message: 'l’articolo deve ripartire dal punto in cui era' })
      .toBeGreaterThanOrEqual(letta - 3);
    expect(await posizione(riaperta)).toBeLessThanOrEqual(letta + 3);
    expect((await statoScheda(app, host)).giudizio.scrollPct).toBe(letta);

    // Toccata dall'utente, la posizione che conta torna quella vera.
    await riaperta.mouse.move(200, 200);
    for (let i = 0; i < 30; i++) await riaperta.mouse.wheel(0, -400);
    await expect.poll(async () => (await statoScheda(app, host)).giudizio.scrollPct).toBeLessThan(5);
  } finally {
    if (app) await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('un audio o un video ascoltato a metà arriva al giudizio della riapertura con fin dove era arrivato', async ({ testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html(ASCOLTO);
  const host = new URL(url).hostname;
  const userData = cartellaTemporanea('filo-visione-');
  let app;
  try {
    app = await lancia(userData);
    const shell = await primaFinestra(app);
    await primaSessione(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const pagina = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'la pagina dell’audio');
    await pagina.waitForFunction(() => document.getElementById('a').duration > 60);
    await pagina.evaluate(() => { document.getElementById('a').currentTime = 40; });
    await expect.poll(async () => (await statoScheda(app, host))?.mediaPct, { message: 'Filo deve sapere che è a metà' }).toBe(50);
    expect(await rigaAlModello(app, host)).toContain('riprodotto fino al 50%');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await new Promise((r) => setTimeout(r, 1000));
    await chiudiApp(app);
    app = null;

    app = await lancia(userData);
    await primaFinestra(app);
    await expect.poll(() => statoScheda(app, host), { timeout: 30_000 }).not.toBeNull();
    expect((await statoScheda(app, host)).giudizio.mediaPct).toBe(50);
    expect(await rigaAlModello(app, host)).toContain('riprodotto fino al 50%');
    // Ricaricata, la pagina riparte da zero senza suonare: la posizione resta quella salvata anche dopo un clic.
    await app.evaluate(({ BrowserWindow }, h) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.activate(tm.tabs.find((x) => new URL(x.url).hostname === h).id);
    }, host);
    const riaperta = await aspettaFinestra(app, (w) => new URL(w.url()).hostname === host, 'la pagina riaperta');
    await riaperta.waitForLoadState('load');
    await riaperta.mouse.click(400, 20);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await statoScheda(app, host)).giudizio.mediaPct).toBe(50);
  } finally {
    if (app) await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
