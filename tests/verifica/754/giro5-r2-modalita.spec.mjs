// #754 giro 5, rilievo 2: cosa Filo sa dei siti segue la modalità in cui li ha visitati, non quella del momento
// in cui lo salva: niente di Privacy sul disco dopo il ritorno ad Automatico, niente di Automatico perso passando a Privacy.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setModeIn(sec, mode) {
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

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

const RICORDA = `<title>RICORDA</title>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
    <button id="onetrust-accept-btn-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=accettato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Accetta tutto</button>
    <button id="onetrust-reject-all-handler" style="width:140px;height:40px"
      onclick="document.cookie='OptanonConsent=rifiutato; path=/; max-age=86400';document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
  </div>
  <script>
    if (document.cookie.includes('OptanonConsent=')) document.getElementById('onetrust-banner-sdk').remove();
  </script>`;

test('Privacy e poi Automatico: il sito visitato in Privacy non finisce sul disco', async ({ app, openTab, testServer, shell }) => {
  test.setTimeout(60_000);
  await setModeIn(await openTab('filo://security/'), 'privacy');
  const page = await testServer.openReady(openTab, RICORDA);
  await page.waitForFunction(() => !document.getElementById('onetrust-banner-sdk'), null, { timeout: 8_000 });
  await expect.poll(async () => (await tabCookies(shell))?.rejected, { timeout: 8_000 }).toBe(true);
  await sleep(1500);
  await setModeIn(await openTab('filo://security/'), 'default');
  await sleep(2500);
  const salvato = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('cookieSites', null));
  expect(salvato && salvato['127.0.0.1']).toBeFalsy();
});

test('Automatico, Privacy, Filo chiuso e riaperto, di nuovo Automatico: il menu dice ancora che su quel sito i cookie sono rifiutati', async ({ testServer }) => {
  test.setTimeout(120_000);
  const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const userData = cartellaTemporanea('filo-test-');
  const avvia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const open = async (url, pronta = true) => {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      let page = null;
      await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith(url)); return !!page; }, { timeout: 10_000 }).toBe(true);
      if (pronta) await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
      else await page.waitForLoadState('domcontentloaded');
      return page;
    };
    return { app, shell, open };
  };
  const url = testServer.html(RICORDA);
  try {
    let run = await avvia();
    try {
      const a = await run.open(url);
      await a.waitForFunction(() => document.cookie.includes('OptanonConsent=rifiutato'), null, { timeout: 8_000 });
      await expect.poll(async () => (await tabCookies(run.shell))?.rejected, { timeout: 8_000 }).toBe(true);
      await run.app.evaluate(async ({ session }) => { await session.defaultSession.cookies.flushStore(); });
      await sleep(1500);
      await setModeIn(await run.open('filo://security/', false), 'privacy');
      await sleep(2000);
    } finally {
      await chiudiApp(run.app);
    }
    run = await avvia();
    try {
      await setModeIn(await run.open('filo://security/', false), 'default');
      const b = await run.open(url);
      await sleep(1500);
      // Il sito ricorda il rifiuto: il banner non c'è, ed è il menu che deve dirlo.
      expect(await b.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
      const menu = await openAndRead(run.app, () => rightClickTab(run.shell), 'Cookie non necessari rifiutati');
      expect(menu).toContain('Mostra il banner dei cookie');
    } finally {
      await chiudiApp(run.app);
    }
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
