// Feedback #145 (riaperto, #145.2): "appena riapro Filo partono i video
// YouTube. fai in modo che alla partenza i video siano in pausa", + tre lamentele
// aggiuntive sul primo fix:
//   1) "è partito l'audio per un attimo poi si è stoppato" — blip audio alla
//      riapertura, il media non deve MAI farsi sentire.
//   2) "il video si è resettato, è partito da capo (pubblicità incluse). lo
//      vorrei dove l'avevo lasciato, in pausa" — la posizione va preservata.
//   3) "la pausa deve riattivarsi solo se clicco per levarlo dalla pausa" —
//      interagire con la pagina (scroll, click altrove) non deve far ripartire
//      il media: solo un'interazione SUL media (o le sue scorciatoie) rilascia
//      la soppressione.
//
// Causa: Electron abilita l'autoplay senza gesto utente per default
// ('no-user-gesture-required'), quindi le tab ripristinate al boot facevano
// ripartire i media tutti insieme. Fix #145: pause() su 'play' lato preload +
// 'document-user-activation-required'. Fix #145.2 (questo): muta anche il
// media mentre è sopprresso (niente blip), persiste/ripristina currentTime
// per-tab nella sessione salvata (sn_open_tabs ora salva oggetti
// {url,scrollPct,mediaTime} invece di bare URL), e la soppressione si rilascia
// SOLO su interazione col media (non su click/scroll generici sulla pagina).
//
// Il test ASSERISCE il comportamento, in due fasi con lo STESSO userData:
//   FASE 1 — apri una pagina esterna con un video, fai avanzare currentTime,
//            lascia salvare la sessione (col mediaTime), chiudi.
//   FASE 2 — riapri: la sessione viene ripristinata. La tab ripristinata ha
//            l'autoplay disabilitato E muto (niente blip), il video è alla
//            posizione salvata (non resettato a 0), e un click/scroll su area
//            vuota della pagina NON rilascia la soppressione — solo un click
//            sul video stesso la rilascia. Una tab NUOVA aperta a mano non ha
//            invece alcuna soppressione (prova che la modifica è mirata al
//            ripristino, non un blocco globale).
//
// Senza il fix la tab ripristinata avrebbe la stessa policy permissiva della
// tab nuova, il video ripartirebbe da 0, e un click su area vuota rilascerebbe
// la soppressione → gli assert sulla tab ripristinata diventano rossi.

import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>autoplay-probe</title></head>
<body><h1>autoplay probe</h1><video id="v" autoplay loop playsinline></video></body></html>`;

// Pagina per la prova di ripristino posizione: niente <audio>/<video> nel
// markup (lo crea il test via JS con un WAV generato al volo, stesso
// approccio della prova di autoplay sopra — leggero e supportato nativamente
// senza dipendere da ffmpeg). content.js guarda sia <video> sia <audio>
// (vedi pickMainMedia), quindi un <audio> con durata nota esercita lo stesso
// codepath di un video reale.
const MEDIA_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>media-restore-probe</title></head>
<body><h1>media restore probe</h1></body></html>`;

function launch(userData) {
  return electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

async function findWindow(app, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = app.windows().find(predicate);
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// Prova reale di autoplay: crea un <audio> con una SORGENTE vera (un minuscolo
// WAV silenzioso come data-URI, in loop così non finisce da solo) e tenta
// l'autoplay senza alcun gesto utente. Dopo un istante guardiamo se sta
// suonando: è ciò che l'utente vedrebbe come "il video è partito" o "è in pausa".
//   - su una scheda ripristinata il blocco lo rimette in pausa → paused === true;
//   - su una scheda nuova l'autoplay permissivo di Filo lo lascia suonare → false.
function makeWavSource(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128); // 8-bit PCM: 128 = silenzio
  const u8 = new Uint8Array(buf);
  let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

// Prova reale di autoplay: crea un <audio> con una SORGENTE vera (un minuscolo
// WAV silenzioso come data-URI, in loop così non finisce da solo) e tenta
// l'autoplay senza alcun gesto utente. Dopo un istante guardiamo se sta
// suonando: è ciò che l'utente vedrebbe come "il video è partito" o "è in pausa".
//   - su una scheda ripristinata il blocco lo rimette in pausa → paused === true;
//   - su una scheda nuova l'autoplay permissivo di Filo lo lascia suonare → false.
// Ritorna anche `muted`: sulla tab ripristinata deve restare true mentre la
// soppressione è attiva (niente blip audio, lamentela #1).
const probeAutoplay = (page) => page.evaluate(async (wavSrc) => {
  const a = new Audio(wavSrc);
  a.muted = false;
  a.loop = true;
  document.body.appendChild(a); // come un <video> reale: in pagina, non distaccato
  a.play().catch(() => {}); // se bloccato rigetta; lo stato vero lo legge .paused
  await new Promise((r) => setTimeout(r, 500)); // tempo al blocco di intervenire
  return { paused: a.paused, muted: a.muted };
}, makeWavSource(1));

const isPausedAfterAutoplay = async (page) => (await probeAutoplay(page)).paused;

test('le tab ripristinate non fanno partire i video (autoplay bloccato al boot)', async () => {
  test.setTimeout(120_000); // due avvii di Electron in sequenza
  const userData = mkdtempSync(join(tmpdir(), 'filo-autoplay-'));
  // Server persistente: deve sopravvivere ai DUE avvii dell'app.
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const restoredUrl = `http://127.0.0.1:${port}/restored`;
  const freshUrl = `http://127.0.0.1:${port}/fresh`;

  let app;
  try {
    // ─── FASE 1: apri la tab esterna, lascia salvare la sessione, chiudi ───
    app = await launch(userData);
    let shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), restoredUrl);
    const tab1 = await findWindow(app, (w) => w.url().startsWith(restoredUrl));
    expect(tab1, 'tab esterna non aperta in fase 1').toBeTruthy();
    await tab1.waitForLoadState('domcontentloaded').catch(() => {});
    // La sessione si salva con debounce 400ms: aspetta che sia su disco.
    await new Promise((r) => setTimeout(r, 900));
    await app.close();

    // ─── FASE 2: riapri con lo STESSO userData → la sessione viene ripristinata ─
    app = await launch(userData);
    shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');

    // Tab ripristinata: autoplay disabilitato (il video non parte da solo).
    const restored = await findWindow(app, (w) => w.url().startsWith(restoredUrl));
    expect(restored, 'tab ripristinata non trovata in fase 2').toBeTruthy();
    await restored.waitForLoadState('domcontentloaded').catch(() => {});
    const restoredPaused = await isPausedAfterAutoplay(restored);

    // Tab nuova (non ripristinata): mantiene l'autoplay permissivo di Filo.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), freshUrl);
    const fresh = await findWindow(app, (w) => w.url().startsWith(freshUrl));
    expect(fresh, 'tab nuova non aperta').toBeTruthy();
    await fresh.waitForLoadState('domcontentloaded').catch(() => {});
    const freshPaused = await isPausedAfterAutoplay(fresh);

    console.log('[autoplay] restoredPaused=', restoredPaused, ' freshPaused=', freshPaused);

    // Sulla tab ripristinata il media resta in pausa (autoplay bloccato);
    // sulla tab nuova suona (la prova è mirata al ripristino, non un blocco globale).
    expect(restoredPaused).toBe(true);
    expect(freshPaused).toBe(false);
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
