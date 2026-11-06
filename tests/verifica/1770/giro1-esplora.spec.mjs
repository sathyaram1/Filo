// Verifica #1770 giro 1: porte vicine allo scenario della spec (risposta dal server, modalità, collegamenti per riaprire).

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabCookies(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === snap.activeId);
    return t ? t.cookies : undefined;
  });
}

async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

async function readMenuOnce(app, needle) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) => (document.body && document.body.innerText.includes(n) ? document.body.innerText : null), needle);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}

async function openAndRead(app, doOpen, needle, timeout = 15_000) {
  let text = null;
  await expect.poll(async () => {
    text = await readMenuOnce(app, needle);
    if (text != null) return true;
    await doOpen();
    await sleep(150);
    text = await readMenuOnce(app, needle);
    return text != null;
  }, { timeout, intervals: [150, 250, 400, 600, 800, 1000] }).toBe(true);
  return text;
}

async function tryClick(app, needle, labelRe) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(({ n, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return 'no';
        const btn = [...document.querySelectorAll('button.item')].find((b) => new RegExp(l).test(b.textContent));
        if (!btn) return 'no';
        btn.click();
        return 'yes';
      }, { n: needle, l: labelRe });
      if (r === 'yes') return true;
    } catch (_) {}
  }
  return false;
}

async function clickUntil(app, { open, needle, labelRe, until, timeout = 25_000 }) {
  await expect.poll(async () => {
    if (await until()) return true;
    await open();
    for (let i = 0; i < 15; i++) { if (await tryClick(app, needle, labelRe)) break; await sleep(40); }
    await sleep(200);
    return await until();
  }, { timeout, intervals: [200, 300, 450, 600, 800, 1000, 1200] }).toBe(true);
}

// ── la scelta la scrive il server, nella risposta alla richiesta del clic ────────────────────────────

function sceltaDaIntestazione(testServer, httpOnly) {
  const risposta = testServer.html('ok', { headers: { 'Set-Cookie': `scelta_sito=no; Path=/; Max-Age=86400${httpOnly ? '; HttpOnly' : ''}` } });
  const segno = testServer.html('ok', { headers: { 'Set-Cookie': 'segno_banner=1; Path=/; Max-Age=86400' } });
  // Il server rende la pagina senza banner quando ha la scelta: qui lo fa lo script col segno leggibile.
  return `<title>SCELTA_HEADER</title>
    <div id="avviso-privacy" class="cookie-consent" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie per la pubblicità.</p>
      <button onclick="window.__acc=1">Accetta</button>
      <button onclick="fetch('${risposta}').then(() => fetch('${segno}')).then(() => document.getElementById('avviso-privacy').remove())">Rifiuta</button>
    </div>
    <script>
      document.cookie = 'sessione=utente; path=/; max-age=86400';
      if (document.cookie.includes('segno_banner=')) document.getElementById('avviso-privacy').remove();
    </script>`;
}

test('scelta scritta dal server nella risposta (Set-Cookie leggibile): «Mostra il banner dei cookie» lo riporta', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, sceltaDaIntestazione(testServer, false));
  await page.waitForFunction(() => document.cookie.includes('segno_banner='), null, { timeout: 15_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(4500);
  await clickUntil(app, {
    open: () => rightClickTab(shell),
    needle: 'Mostra il banner dei cookie', labelRe: 'Mostra il banner dei cookie',
    until: async () => (await tabCookies(shell))?.shown === true,
  });
  await expect.poll(() => page.evaluate(() => !!document.querySelector('#avviso-privacy')).catch(() => false), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => document.cookie)).toContain('sessione=utente');
});

// ── Automatico, poi una visita in Privacy dello stesso sito, poi Automatico e riavvio ────────────────

async function avviaFilo(userData) {
  const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  const open = async (url) => {
    const prima = new Set(app.windows());
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url() === url && !prima.has(w)); return !!page; }, { timeout: 10_000 }).toBe(true);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
    return page;
  };
  return { app, shell, open };
}

const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    document.cookie = 'sessione=utente; path=/; max-age=86400';
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

test('rifiuto in Automatico, visita di nuovo in Privacy, ritorno ad Automatico e riavvio: il rifiuto e la voce del menu restano', async ({ testServer }) => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-test-');
  const modo = (run, mode) => run.app.evaluate((_e, m) => globalThis.__filoHandlers.applySettingsUpdate({ security: { cookies: { mode: m } } }), mode);
  const url = testServer.html(RICORDA);
  try {
    let run = await avviaFilo(userData);
    try {
      const a = await run.open(url);
      await a.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
      await openAndRead(run.app, () => rightClickTab(run.shell), 'Cookie non necessari rifiutati');
      await modo(run, 'privacy');
      await sleep(1000);
      const b = await run.open(url);
      await b.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 10_000 });
      await sleep(1500);
      await modo(run, 'default');
      await sleep(2000);
      await run.app.evaluate(async ({ session }) => { await session.defaultSession.cookies.flushStore(); });
    } finally {
      await chiudiApp(run.app);
    }
    run = await avviaFilo(userData);
    try {
      const salvato = await run.app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
      expect(salvato && salvato['127.0.0.1'] && salvato['127.0.0.1'].rejected).toBe(true);
      const c = await run.open(url);
      await sleep(1500);
      expect(await c.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
      const menu = await openAndRead(run.app, () => rightClickTab(run.shell), 'Cookie non necessari rifiutati');
      expect(menu).toContain('Mostra il banner dei cookie');
    } finally {
      await chiudiApp(run.app);
    }
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── collegamenti per riaprire le preferenze alla prima visita, con la risposta già data ──────────────

const OT_GIA_RISPOSTO = `<title>OT_GIA</title>
  <script>document.cookie = 'OptanonAlertBoxClosed=1; path=/; max-age=86400';</script>
  <style>body{margin:0} .page{height:2000px}</style>
  <div class="page">contenuto</div>
  <div id="onetrust-consent-sdk"></div>
  <footer style="position:fixed;bottom:0;left:0;right:0;height:40px;background:#eee">
    <a href="#chi">Chi siamo</a> <button id="ot-sdk-btn" class="ot-sdk-show-settings">Impostazioni cookie</button>
  </footer>`;

const SCUDO = `<title>SCUDO</title>
  <style>body{margin:0} .page{height:2000px}</style>
  <div class="page">contenuto</div>
  <button class="osano-cm-window__widget osano-cm-widget" aria-label="Preferenze cookie"
    style="position:fixed;bottom:12px;left:12px;width:44px;height:44px;border-radius:50%;background:#eee;z-index:99">
    <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>
  </button>`;

for (const [nome, html, lista, link] of [
  ['OneTrust, solo «Impostazioni cookie» già alla prima visita', OT_GIA_RISPOSTO, '###onetrust-consent-sdk\n###ot-sdk-btn\n##.ot-sdk-show-settings', '#ot-sdk-btn'],
  ['icona fissa senza scritta (forma Osano)', SCUDO, '##.osano-cm-widget', '.osano-cm-widget'],
]) {
  test(`${nome}: il collegamento resta e il menu non dice «Banner nascosto»`, async ({ app, openTab, testServer, shell }) => {
    test.setTimeout(60_000);
    await app.evaluate((_e, l) => globalThis.__filoCookieBanners.setListForTest(l), lista);
    const page = await testServer.openReady(openTab, html);
    await sleep(5000);
    expect(await page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, link)).not.toBe('none');
    expect((await tabCookies(shell))?.hidden).toBeFalsy();
  });
}
