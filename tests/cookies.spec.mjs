// Gestione cookie / consenso (src/main/services/cookies.js + content/cookies.js
// + GPC in tabs.js). I test asseriscono il COMPORTAMENTO visibile all'utente:
//
//   - GPC: in modalità "default" le pagine esterne ricevono sia l'header
//     Sec-GPC:1 sia navigator.globalPrivacyControl === true; in "manuale" NO
//     (controprova anti-falso-positivo).
//   - Rifiuto CMP: un banner cookie con un pulsante "rifiuta tutto" viene
//     premuto automaticamente (il banner sparisce); in "manuale" resta.
//   - Embed YouTube riscritto in youtube-nocookie.com.
//   - Blocco tracker (default): le richieste ai tracker noti (es. Google
//     Analytics) vengono annullate (ERR_BLOCKED_BY_CLIENT); in manuale no.
//   - Wipe all'uscita (default): vengono cancellati SOLO i cookie dei domini
//     tracker; quelli funzionali/di login restano; in privacy/manuale no-op.
//   - Privacy: ogni sito riceve una sessione effimera isolata (partizione
//     dedicata, senza prefisso persist:); i siti "fidati" ricevono invece una
//     partizione isolata ma persistente (persist:filo-priv-…).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Cambia la modalità cookie dalla pagina Sicurezza (auto-save al cambio radio).
async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

test('GPC (default): navigator.globalPrivacyControl è true sulle pagine esterne', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>GPC_JS</title><p>ok</p>');
  await page.waitForFunction(() => navigator.globalPrivacyControl === true, null, { timeout: 6_000 });
  expect(await page.evaluate(() => navigator.globalPrivacyControl)).toBe(true);
});

test('GPC (default): l\'header Sec-GPC:1 viene inviato sulle richieste esterne', async ({ openTab }) => {
  let secGpc = null;
  const server = createServer((req, res) => {
    if (secGpc === null) secGpc = req.headers['sec-gpc'] ?? 'absent';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>GPC_HDR</title><p>ok</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await openTab(`http://127.0.0.1:${port}/g`);
    await expect.poll(() => secGpc, { timeout: 6_000 }).toBe('1');
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});

test('GPC (manuale): NIENTE header né proprietà (controprova)', async ({ openTab }) => {
  await setMode(openTab, 'manual');
  let secGpc = null;
  const server = createServer((req, res) => {
    if (secGpc === null) secGpc = req.headers['sec-gpc'] ?? 'absent';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>GPC_OFF</title><p>ok</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const page = await openTab(`http://127.0.0.1:${port}/m`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    expect(secGpc).toBe('absent');
    expect(await page.evaluate(() => navigator.globalPrivacyControl)).toBeFalsy();
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});

test('CMP (default): il banner con "rifiuta tutto" viene premuto e sparisce', async ({ openTab, testServer }) => {
  // Banner in stile OneTrust: il pulsante reject, se cliccato, rimuove il banner
  // (mutazione DOM osservabile). Senza il rifiuto automatico resterebbe lì.
  const html = `
    <title>CMP_BANNER</title>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
      <p>Questo sito usa i cookie.</p>
      <button id="onetrust-accept-btn-handler" style="width:120px;height:40px">Accetta tutto</button>
      <button id="onetrust-reject-all-handler" style="width:120px;height:40px"
        onclick="document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
    </div>
    <p>contenuto</p>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(
    () => !document.getElementById('onetrust-banner-sdk'),
    null,
    { timeout: 8_000 },
  );
  expect(await page.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(false);
});

test('CMP (manuale): il banner NON viene toccato (controprova)', async ({ openTab, testServer }) => {
  await setMode(openTab, 'manual');
  const html = `
    <title>CMP_MANUAL</title>
    <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff">
      <button id="onetrust-reject-all-handler" style="width:120px;height:40px"
        onclick="document.getElementById('onetrust-banner-sdk').remove()">Rifiuta tutto</button>
    </div>`;
  const page = await testServer.openReady(openTab, html);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await page.evaluate(() => !!document.getElementById('onetrust-banner-sdk'))).toBe(true);
});

test('YouTube (default): gli embed vengono riscritti in youtube-nocookie.com', async ({ openTab, testServer }) => {
  const html = `
    <title>YT_EMBED</title>
    <iframe id="yt" width="320" height="180"
      src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(
    () => (document.getElementById('yt')?.src || '').includes('youtube-nocookie.com'),
    null,
    { timeout: 8_000 },
  );
  const src = await page.evaluate(() => document.getElementById('yt').src);
  expect(src).toContain('youtube-nocookie.com');
  expect(src).toContain('/embed/dQw4w9WgXcQ');
});

// Arma un osservatore (nel main) sugli errori di rete verso google-analytics.com
// PRIMA di scatenare la richiesta. onErrorOccurred è un evento distinto da
// onBeforeRequest (usato dal blocco), quindi non c'è conflitto. Quando la
// richiesta viene annullata dal blocco tracker, Chromium riporta
// 'net::ERR_BLOCKED_BY_CLIENT': è deterministico e scatta PRIMA di qualsiasi I/O
// di rete, quindi il test non dipende dalla connettività.
async function armTrackerObserver(app) {
  await app.evaluate(({ session }) => {
    globalThis.__filoTrackerErr = null;
    session.defaultSession.webRequest.onErrorOccurred(
      { urls: ['*://*.google-analytics.com/*'] },
      (details) => { if (globalThis.__filoTrackerErr === null) globalThis.__filoTrackerErr = details.error; },
    );
  });
}
async function fireTrackerRequest(page) {
  await page.evaluate(() => {
    const img = new Image();
    img.src = 'https://www.google-analytics.com/collect?v=1&_t=' + Date.now();
    document.body.appendChild(img);
  });
}
async function waitTrackerErr(app) {
  return app.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      if (globalThis.__filoTrackerErr) return globalThis.__filoTrackerErr;
      await new Promise((r) => setTimeout(r, 50));
    }
    return globalThis.__filoTrackerErr;
  });
}

test('blocco tracker (default): la richiesta a Google Analytics viene annullata', async ({ app, openTab, testServer }) => {
  await armTrackerObserver(app);
  const page = await testServer.openReady(openTab, '<title>BLK</title><p>ok</p>');
  await fireTrackerRequest(page);
  const err = await waitTrackerErr(app);
  expect(err).toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('blocco tracker (manuale): la richiesta NON viene annullata (controprova)', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'manual');
  await armTrackerObserver(app);
  const page = await testServer.openReady(openTab, '<title>BLK_OFF</title><p>ok</p>');
  await fireTrackerRequest(page);
  const err = await waitTrackerErr(app);
  // Senza blocco la richiesta va in rete: o ha successo (nessun errore) o
  // fallisce per un motivo di rete (DNS/connessione) — MAI per blocco client.
  expect(err).not.toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('lista tracker: riconosce i tracker noti e lascia stare i domini buoni', async ({ app }) => {
  const res = await app.evaluate(() => {
    const C = globalThis.__filoCookies;
    return {
      ga: C.isTrackerUrl('https://www.google-analytics.com/analytics.js'),
      gtm: C.isTrackerUrl('https://www.googletagmanager.com/gtag/js?id=X'),
      dc: C.isTrackerUrl('https://stats.g.doubleclick.net/x'),
      fbPixel: C.isTrackerUrl('https://connect.facebook.net/en_US/fbevents.js'),
      // domini buoni: NON devono risultare tracker
      site: C.isTrackerUrl('https://example.com/page'),
      google: C.isTrackerUrl('https://www.google.com/search?q=x'),
      facebook: C.isTrackerUrl('https://www.facebook.com/me'),
      youtube: C.isTrackerUrl('https://www.youtube.com/watch?v=x'),
    };
  });
  expect(res.ga).toBe(true);
  expect(res.gtm).toBe(true);
  expect(res.dc).toBe(true);
  expect(res.fbPixel).toBe(true);
  expect(res.site).toBe(false);
  expect(res.google).toBe(false);
  expect(res.facebook).toBe(false);
  expect(res.youtube).toBe(false);
});

test('wipe all\'uscita (default): cancella i non-whitelisted, tiene i whitelisted', async ({ app }) => {
  const res = await app.evaluate(async ({ session }) => {
    const Cookies = globalThis.__filoCookies;
    const ses = session.defaultSession;
    const domainsNow = async () => (await ses.cookies.get({})).map((c) => String(c.domain || '').replace(/^\./, ''));
    // All'avvio il main esegue UN wipe one-shot della sessione di default (la
    // promessa "nessun profilo persistente"). Ri-piazziamo i cookie in loop
    // finché non restano stabili: così siamo certi di operare DOPO quel wipe di
    // boot e di testare il nostro wipe esplicito, non la corsa con quello d'avvio.
    let before = [];
    for (let i = 0; i < 60; i++) {
      await ses.cookies.set({ url: 'https://keep-login.com/', name: 'sess', value: '1' });
      await ses.cookies.set({ url: 'https://tracker-drop.com/', name: 't', value: '1' });
      await new Promise((r) => setTimeout(r, 50));
      before = await domainsNow();
      if (before.includes('keep-login.com') && before.includes('tracker-drop.com')) break;
    }
    const settings = { security: { cookies: { mode: 'default', loginWhitelist: ['keep-login.com'] } } };
    const r = await Cookies.wipeNonWhitelisted(settings);
    // Anche remove() committa in modo asincrono: aspetta che il tracker sparisca.
    let after = [];
    for (let i = 0; i < 40; i++) {
      after = await domainsNow();
      if (!after.includes('tracker-drop.com')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      skipped: !!r.skipped,
      removed: r.removed,
      before,
      after,
      setKeep: before.includes('keep-login.com'),
      setDrop: before.includes('tracker-drop.com'),
      hasKeep: after.includes('keep-login.com'),
      hasDrop: after.includes('tracker-drop.com'),
    };
  });
  // Pre-condizioni: entrambi i cookie sono stati davvero piazzati.
  expect(res.setKeep, `setup cookie keep non piazzato — before=${JSON.stringify(res.before)}`).toBe(true);
  expect(res.setDrop, `setup cookie drop non piazzato — before=${JSON.stringify(res.before)}`).toBe(true);
  expect(res.skipped).toBe(false);
  expect(res.hasKeep, `login preservato — after=${JSON.stringify(res.after)}`).toBe(true);
  expect(res.hasDrop, `tracker cancellato — after=${JSON.stringify(res.after)}`).toBe(false);
});

test('wipe all\'uscita (privacy/manuale): è un no-op', async ({ app }) => {
  const res = await app.evaluate(async () => {
    const Cookies = globalThis.__filoCookies;
    const priv = await Cookies.wipeNonWhitelisted({ security: { cookies: { mode: 'privacy' } } });
    const man = await Cookies.wipeNonWhitelisted({ security: { cookies: { mode: 'manual' } } });
    return { priv: !!priv.skipped, man: !!man.skipped };
  });
  expect(res.priv).toBe(true);
  expect(res.man).toBe(true);
});

test('privacy: siti diversi ottengono partizioni effimere isolate', async ({ app }) => {
  const res = await app.evaluate(() => {
    const Cookies = globalThis.__filoCookies;
    const a = Cookies.partitionForTab('https://sub.alpha-site.com/page', { mode: 'privacy', incognito: false });
    const a2 = Cookies.partitionForTab('https://other.alpha-site.com/x', { mode: 'privacy', incognito: false });
    const b = Cookies.partitionForTab('https://beta-site.org/', { mode: 'privacy', incognito: false });
    const internal = Cookies.partitionForTab('filo://newtab/', { mode: 'privacy', incognito: false });
    const incog = Cookies.partitionForTab('https://alpha-site.com/', { mode: 'privacy', incognito: true });
    const def = Cookies.partitionForTab('https://alpha-site.com/', { mode: 'default', incognito: false });
    return { a: a.partition, a2: a2.partition, b: b.partition, internal: internal.partition, incog: incog.partition, def: def.partition };
  });
  // Stesso eTLD+1 → stessa partizione; eTLD+1 diversi → partizioni diverse.
  expect(res.a).toBe(res.a2);
  expect(res.a).not.toBe(res.b);
  // Effimera: niente prefisso persist: → non sopravvive alla sessione.
  expect(res.a.startsWith('filo-priv-')).toBe(true);
  expect(res.a.startsWith('persist:')).toBe(false);
  // Pagine interne, incognito e modalità non-privacy NON ricevono partizione per-sito.
  expect(res.internal).toBeFalsy();
  expect(res.incog).toBeFalsy();
  expect(res.def).toBeFalsy();
});

test('privacy: una pagina esterna gira in una sessione diversa da quella di default', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'privacy');
  const page = await testServer.openReady(openTab, '<title>PRIV_SITE</title><p>isolato</p>');
  const info = await app.evaluate(({ BrowserWindow, session }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const u = t.view?.webContents?.getURL?.() || '';
        if (!/^https?:/.test(u)) continue;
        const ses = t.view.webContents.session;
        return { partition: t.partition || null, isDefault: ses === session.defaultSession };
      }
    }
    return null;
  });
  expect(info).toBeTruthy();
  expect(info.partition && info.partition.startsWith('filo-priv-')).toBe(true);
  expect(info.isDefault).toBe(false);
});
