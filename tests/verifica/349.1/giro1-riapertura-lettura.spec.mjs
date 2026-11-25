// Verifica #349.1, giro 1: la posizione di lettura (scroll e video) sopravvive alla chiusura di Filo, arriva al
// giudizio della riapertura e la pagina riparte dal punto. Due o tre avvii sulla stessa cartella dati.

import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const testo = Array.from({ length: 400 }, (_, i) => `<p>Paragrafo ${i} di un articolo lungo da leggere con calma.</p>`).join('');
const pagina = (titolo, corpo = testo) => `<!doctype html><html><head><title>${titolo}</title></head><body style="margin:0;font:16px sans-serif">${corpo}</body></html>`;

// Due minuti di silenzio: un audio lungo che il lettore della pagina porta a metà.
function wav(secondi = 120, hz = 8000) {
  const n = secondi * hz;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(hz, 24);
  b.writeUInt32LE(hz, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const VIDEO = pagina('Video', `<p>Lezione registrata</p><audio id="a" controls preload="auto" src="/suono.wav"></audio>
<script>const a=document.getElementById('a');setTimeout(()=>{if(!sessionStorage.fatto&&a.duration){sessionStorage.fatto='1';a.currentTime=a.duration/2;}},2500);</script>`);

async function ambiente() {
  const pagine = new Map();
  const suono = wav();
  const server = createServer((req, res) => {
    // Senza le richieste a pezzi il lettore non sa spostarsi nell'audio.
    if (req.url === '/suono.wav') {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (!m) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': suono.length, 'Accept-Ranges': 'bytes' }); res.end(suono); return; }
      const da = Number(m[1]);
      const a = m[2] ? Math.min(Number(m[2]), suono.length - 1) : suono.length - 1;
      res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Length': a - da + 1, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${da}-${a}/${suono.length}` });
      res.end(suono.subarray(da, a + 1));
      return;
    }
    const corpo = pagine.get(req.url);
    res.writeHead(corpo ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(corpo || '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = (nome, corpo) => { pagine.set(`/${nome}`, corpo); return `${origin}/${nome}`; };
  const dati = cartellaTemporanea('filo-verifica-349-1-');
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({ filo_onboarding: { done: true } }));
  const avvia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' } });
  const chiudi = async () => {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    rmSync(dati, { recursive: true, force: true });
  };
  return { url, dati, avvia, chiudi };
}

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [f, a]) => {
  const m = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return (0, eval)(`(${f})`)(m, a);
}, [String(fn), arg]);

async function apri(app, shell, u) {
  await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return w.url() === u; } catch (_) { return false; } }); return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  return page;
}

async function rotellaFinoAMeta(page) {
  await page.mouse.move(300, 300);
  for (let k = 0; k < 60; k++) {
    const pct = await page.evaluate(() => { const d = document.documentElement; return window.scrollY / (d.scrollHeight - innerHeight) * 100; });
    if (pct >= 48) break;
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
}

async function stubGiudizio(app) {
  await app.evaluate(() => {
    globalThis.__giudizi = [];
    const stub = async ({ tabs, trigger }) => {
      globalThis.__giudizi.push({ trigger, tabs: tabs.map((t) => ({ url: t.url, scrollPct: t.scrollPct, mediaPct: t.mediaPct })) });
      return { decisions: tabs.map((t, k) => ({ i: k, action: 'keep', reason: 'test' })) };
    };
    Object.defineProperty(globalThis, 'SN_TAB_TRIAGE_DECIDE', { get: () => stub, set: () => {}, configurable: true });
  });
}

const salvata = (dati) => JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8')).sn_open_tabs;

test('articolo e video lasciati a metà: la posizione si salva, arriva al giudizio e la pagina riparte da lì', async () => {
  test.setTimeout(240_000);
  const env = await ambiente();
  const articolo = env.url('Articolo', pagina('Articolo'));
  const video = env.url('Video', VIDEO);
  const notizie = env.url('Notizie', pagina('Notizie'));
  const davanti = env.url('Davanti', pagina('Davanti', '<p>davanti</p>'));
  let app = await env.avvia();
  try {
    let shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    const pA = await apri(app, shell, articolo);
    await rotellaFinoAMeta(pA);
    await expect.poll(() => tm(app, (m) => m.tabs.find((t) => t.title === 'Articolo').scrollPct), { timeout: 5_000 }).toBeGreaterThanOrEqual(45);
    const pV = await apri(app, shell, video);
    await expect.poll(() => pV.evaluate(() => { const a = document.getElementById('a'); return a.duration ? Math.round(a.currentTime / a.duration * 100) : -1; }), { timeout: 10_000, message: 'l’audio della pagina non è arrivato a metà' }).toBeGreaterThanOrEqual(45);
    await expect.poll(() => tm(app, (m) => m.tabs.find((t) => t.title === 'Video').mediaPct), { timeout: 10_000 }).toBeGreaterThanOrEqual(45);
    await apri(app, shell, notizie);
    await apri(app, shell, davanti);
    await chiudiApp(app, { tetto: 15_000 });

    const s1 = salvata(env.dati);
    const i = (u) => s1.tabs.indexOf(u);
    expect(s1.letture[i(articolo)], 'la lettura dell’articolo non è salvata').toBeGreaterThanOrEqual(45);
    expect(s1.visioni[i(video)], 'il punto del video non è salvato').toBeGreaterThanOrEqual(45);
    expect(s1.letture[i(notizie)]).toBeNull();

    app = await env.avvia();
    await stubGiudizio(app);
    shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è rinata');
    await expect.poll(() => app.evaluate(() => globalThis.__giudizi.length), { timeout: 90_000, message: 'la pulizia della riapertura non è partita' }).toBeGreaterThan(0);
    const giro = await app.evaluate(() => globalThis.__giudizi[0]);
    expect(giro.trigger).toBe('reopen');
    const di = (u) => giro.tabs.find((t) => t.url === u) || {};
    expect(di(articolo).scrollPct, 'al giudizio l’articolo arriva senza lettura').toBeGreaterThanOrEqual(45);
    expect(di(video).mediaPct, 'al giudizio il video arriva senza il punto').toBeGreaterThanOrEqual(45);
    expect(di(notizie).scrollPct ?? null).toBeNull();

    // Riaperta, la scheda riparte dal punto in cui era.
    const idA = await tm(app, (m, u) => m.tabs.find((t) => t.url === u).id, articolo);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
    const pA2 = await aspettaFinestra(app, (w) => w.url() === articolo, 'l’articolo riaperto non c’è');
    await expect.poll(() => pA2.evaluate(() => { const d = document.documentElement; return Math.round(window.scrollY / (d.scrollHeight - innerHeight) * 100); }), { timeout: 8_000, message: 'l’articolo riaperto non è tornato al punto' }).toBeGreaterThanOrEqual(40);
    const visto = await pA2.evaluate(() => { const d = document.documentElement; return Math.round(window.scrollY / (d.scrollHeight - innerHeight) * 100); });
    expect(visto).toBeLessThanOrEqual(60);
    mkdirSync(SHOTS, { recursive: true });
    await pA2.screenshot({ path: join(SHOTS, 'verifica-349-1-articolo-riaperto.png') });

    // Chiuso di nuovo senza toccarla, la lettura resta quella di prima.
    await chiudiApp(app, { tetto: 15_000 });
    const s2 = salvata(env.dati);
    expect(s2.letture[s2.tabs.indexOf(articolo)], 'il secondo riavvio ha perso la lettura').toBeGreaterThanOrEqual(45);
  } finally {
    await chiudiApp(app).catch(() => {});
    await env.chiudi();
  }
});

test('r1 una scheda riaperta portata altrove dalla barra degli indirizzi non si porta dietro la lettura della pagina di prima', async () => {
  test.setTimeout(240_000);
  const env = await ambiente();
  const articolo = env.url('Articolo', pagina('Articolo'));
  const altra = env.url('Altra', pagina('Altra'));
  const davanti = env.url('Davanti', pagina('Davanti', '<p>davanti</p>'));
  let app = await env.avvia();
  try {
    let shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è nata');
    const pA = await apri(app, shell, articolo);
    await rotellaFinoAMeta(pA);
    await expect.poll(() => tm(app, (m) => m.tabs.find((t) => t.title === 'Articolo').scrollPct), { timeout: 5_000 }).toBeGreaterThanOrEqual(45);
    await apri(app, shell, davanti);
    await chiudiApp(app, { tetto: 15_000 });

    app = await env.avvia();
    await stubGiudizio(app);
    shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'la shell non è rinata');
    await expect.poll(() => app.evaluate(() => globalThis.__giudizi.length), { timeout: 90_000 }).toBeGreaterThan(0);
    const idA = await tm(app, (m, u) => m.tabs.find((t) => t.url === u).id, articolo);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), idA);
    // L'utente scrive un altro indirizzo nella barra: la pagina nuova non l'ha mai letta.
    await shell.evaluate(([id, u]) => window.filoShell.tabs.navigate(id, u), [idA, altra]);
    const pAltra = await aspettaFinestra(app, (w) => w.url() === altra, 'la pagina nuova non si è aperta');
    await pAltra.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
    await pAltra.waitForTimeout(1500);
    const stato = await tm(app, (m, id) => {
      const s = m.sessionState();
      const k = s.ids.indexOf(id);
      return { url: s.tabs[k], lettura: s.letture[k] };
    }, idA);
    expect(stato.url).toBe(altra);
    expect(stato.lettura, 'la pagina nuova eredita «letta a metà» da quella di prima').toBeNull();
  } finally {
    await chiudiApp(app).catch(() => {});
    await env.chiudi();
  }
});
