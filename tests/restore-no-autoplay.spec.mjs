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

    // Tab ripristinata: autoplay disabilitato (il video non parte da solo) E
    // muto (niente blip audio nemmeno per un istante — lamentela #1).
    const restored = await findWindow(app, (w) => w.url().startsWith(restoredUrl));
    expect(restored, 'tab ripristinata non trovata in fase 2').toBeTruthy();
    await restored.waitForLoadState('domcontentloaded').catch(() => {});
    const restoredProbe = await probeAutoplay(restored);

    // Tab nuova (non ripristinata): mantiene l'autoplay permissivo di Filo.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), freshUrl);
    const fresh = await findWindow(app, (w) => w.url().startsWith(freshUrl));
    expect(fresh, 'tab nuova non aperta').toBeTruthy();
    await fresh.waitForLoadState('domcontentloaded').catch(() => {});
    const freshProbe = await probeAutoplay(fresh);

    console.log('[autoplay] restored=', restoredProbe, ' fresh=', freshProbe);

    // Sulla tab ripristinata il media resta in pausa E muto (autoplay bloccato,
    // niente blip); sulla tab nuova suona (prova mirata al ripristino, non un
    // blocco globale).
    expect(restoredProbe.paused).toBe(true);
    expect(restoredProbe.muted).toBe(true);
    expect(freshProbe.paused).toBe(false);
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('le tab ripristinate mantengono la posizione del media, in pausa, e la pausa si rilascia solo cliccando sul media', async () => {
  test.setTimeout(120_000); // due avvii di Electron in sequenza
  const userData = mkdtempSync(join(tmpdir(), 'filo-media-restore-'));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MEDIA_PAGE_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const mediaUrl = `http://127.0.0.1:${port}/media`;
  const SAVED_TIME = 4; // secondi: posizione a cui "lasciamo" il media in fase 1

  let app;
  try {
    // ─── FASE 1: apri la tab, crea un <audio> reale, portalo a SAVED_TIME,
    // lascia che il content script lo riporti al main (mediaTime), chiudi ───
    app = await launch(userData);
    let shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), mediaUrl);
    const tab1 = await findWindow(app, (w) => w.url().startsWith(mediaUrl));
    expect(tab1, 'tab media non aperta in fase 1').toBeTruthy();
    await tab1.waitForLoadState('domcontentloaded').catch(() => {});

    // Crea l'audio (durata reale ~10s), avvialo via gesto (click sulla pagina
    // conta come gesto utente in una tab NUOVA, non ripristinata) e poi
    // posizionalo a SAVED_TIME e metti in pausa: questo è "dove l'utente
    // l'aveva lasciato" prima di chiudere Filo.
    await tab1.evaluate(async (wavSrc) => {
      const a = document.createElement('audio');
      a.id = 'probe-audio';
      a.src = wavSrc;
      a.loop = true;
      document.body.appendChild(a);
      window.__filoTestAudio = a;
      await new Promise((resolve) => {
        if (a.readyState >= 1) return resolve();
        a.addEventListener('loadedmetadata', resolve, { once: true });
      });
    }, makeWavSource(10));
    await tab1.evaluate((t) => {
      const a = window.__filoTestAudio;
      a.currentTime = t;
      a.pause();
    }, SAVED_TIME);
    // Il content script campiona mediaTime ogni ~4s o su eventi; forziamo un
    // 'pause' (già scatenato sopra) e diamo tempo all'IPC + al debounce di
    // salvataggio sessione (400ms) di scrivere su disco.
    await new Promise((r) => setTimeout(r, 1500));
    await app.close();

    // ─── FASE 2: riapri con lo STESSO userData → la sessione ripristina anche
    // mediaTime. Il media NON esiste più nel DOM (era creato via JS dal test,
    // non dalla pagina), quindi qui verifichiamo solo che `sn_open_tabs`
    // contenga la posizione salvata E che il meccanismo di soppressione/
    // rilascio si comporti come da lamentela #3 con un <audio> reale creato
    // ex-novo nella tab ripristinata. ───
    app = await launch(userData);
    shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');

    const restored = await findWindow(app, (w) => w.url().startsWith(mediaUrl));
    expect(restored, 'tab ripristinata non trovata in fase 2').toBeTruthy();
    await restored.waitForLoadState('domcontentloaded').catch(() => {});

    // La sessione salvata su disco deve avere la forma oggetto con mediaTime
    // vicino a SAVED_TIME (non null, non 0) — prova diretta della persistenza
    // (lamentela #2), indipendente dal fatto che la pagina di test non abbia
    // un <video> nel markup originale da far ripristinare automaticamente.
    const storageRes = await shell.evaluate(() => window.filoShell.message({ type: '_storage:get', keys: ['sn_open_tabs'] }));
    const savedSession = storageRes?.value?.sn_open_tabs || null;
    const savedEntry = savedSession?.tabs?.find((t) => t && typeof t === 'object' && t.url && t.url.startsWith(mediaUrl));
    expect(savedEntry, 'voce di sessione per la tab media non trovata o ancora in forma bare-string').toBeTruthy();
    expect(typeof savedEntry.mediaTime, 'mediaTime non persistito (forma vecchia bare-URL?)').toBe('number');
    expect(savedEntry.mediaTime, `mediaTime salvato (${savedEntry.mediaTime}) lontano da SAVED_TIME=${SAVED_TIME}`).toBeGreaterThan(SAVED_TIME - 1.5);
    expect(savedEntry.mediaTime).toBeLessThan(SAVED_TIME + 1.5);

    // Crea un nuovo <audio> nella tab ripristinata (simula il player che la
    // pagina ricostruisce al load, es. YouTube) e prova ad avviarlo SENZA
    // gesto utente: deve restare in pausa e muto (soppressione attiva).
    const beforeInteract = await tab2Probe(restored);
    expect(beforeInteract.paused, 'media dovrebbe restare in pausa prima di qualunque interazione').toBe(true);
    expect(beforeInteract.muted, 'media dovrebbe restare muto prima di qualunque interazione').toBe(true);

    // Click su area VUOTA della pagina (non sul media): la soppressione NON
    // deve rilasciarsi (lamentela #3) — un secondo tentativo di play resta in pausa.
    await restored.click('h1');
    await new Promise((r) => setTimeout(r, 200));
    const afterEmptyClick = await tab2Probe(restored);
    expect(afterEmptyClick.paused, 'un click su area vuota NON deve rilasciare la soppressione').toBe(true);

    // Click SUL media: questo sì rilascia la soppressione (l'utente ha
    // esplicitamente interagito col player) — un nuovo tentativo di play parte.
    const afterMediaClick = await restored.evaluate(async () => {
      const a = document.getElementById('probe-audio-2');
      a.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      a.muted = false;
      a.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      return { paused: a.paused, muted: a.muted };
    });
    expect(afterMediaClick.paused, 'un click SUL media deve rilasciare la soppressione').toBe(false);

    console.log('[media-restore] savedSession=', JSON.stringify(savedSession), 'beforeInteract=', beforeInteract, 'afterEmptyClick=', afterEmptyClick, 'afterMediaClick=', afterMediaClick);
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// Crea un <audio> #probe-audio-2 nella pagina ripristinata e tenta l'autoplay
// senza gesto utente (come farebbe un player che si ricostruisce al load).
async function tab2Probe(page) {
  return page.evaluate(async (wavSrc) => {
    let a = document.getElementById('probe-audio-2');
    if (!a) {
      a = document.createElement('audio');
      a.id = 'probe-audio-2';
      a.src = wavSrc;
      a.loop = true;
      a.muted = false;
      document.body.appendChild(a);
    }
    a.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    return { paused: a.paused, muted: a.muted };
  }, makeWavSource(2));
}
