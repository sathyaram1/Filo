// Feedback #145: "appena riapro Filo partono i video YouTube. fai in modo che
// alla partenza i video siano in pausa".
//
// Causa: Electron abilita l'autoplay senza gesto utente per default
// ('no-user-gesture-required'), quindi le tab ripristinate al boot facevano
// ripartire i media tutti insieme. Fix: le tab nate da un ripristino di
// sessione usano 'document-user-activation-required' → niente autoplay finché
// l'utente non interagisce con la pagina (come un browser normale).
//
// Il test ASSERISCE il comportamento, in due fasi con lo STESSO userData:
//   FASE 1 — apri una pagina esterna come tab, lascia salvare la sessione, chiudi.
//   FASE 2 — riapri: la sessione viene ripristinata. La tab ripristinata ha
//            l'autoplay disabilitato; una tab NUOVA aperta a mano no (prova che
//            la modifica è mirata al ripristino, non un blocco globale).
//
// Senza il fix la tab ripristinata avrebbe la stessa policy permissiva della
// tab nuova → l'assert sulla tab ripristinata diventa rosso.

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

// Prova reale di autoplay: crea un <video> e chiama play() senza alcun gesto
// utente. Se l'autoplay è bloccato dalla policy, play() rifiuta SUBITO con
// 'NotAllowedError' (prima ancora di cercare una sorgente) — è esattamente il
// motivo per cui un video YouTube resterebbe in pausa. Se invece l'autoplay è
// permesso, play() procede e fallisce semmai per sorgente assente
// ('NotSupportedError'): comunque NON 'NotAllowedError'.
const autoplayResult = (page) => page.evaluate(async () => {
  const v = document.createElement('video');
  v.muted = false;
  document.body.appendChild(v);
  try { await v.play(); return 'played'; }
  catch (e) { return e && e.name ? e.name : String(e); }
});

test('le tab ripristinate non fanno partire i video (autoplay bloccato al boot)', async () => {
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
    const restoredPolicy = await policyOf(restored);

    // Tab nuova (non ripristinata): mantiene l'autoplay permissivo di Filo.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), freshUrl);
    const fresh = await findWindow(app, (w) => w.url().startsWith(freshUrl));
    expect(fresh, 'tab nuova non aperta').toBeTruthy();
    await fresh.waitForLoadState('domcontentloaded').catch(() => {});
    const freshPolicy = await policyOf(fresh);

    console.log('[autoplay] restored=', restoredPolicy, ' fresh=', freshPolicy);

    // La tab nuova permette l'autoplay; la ripristinata no.
    expect(freshPolicy).toBe('allowed');
    expect(restoredPolicy).not.toBe('allowed');
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
