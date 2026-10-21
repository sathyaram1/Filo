// #1123 — l'accesso a Filo con Google si apre in una scheda di Filo, così Google mette i suoi cookie dove li trovano
// YouTube, Gmail e Drive. La scheda si chiude quando il codice arriva; se Google la rifiuta l'accesso passa da solo al
// browser di sistema, con una riga che lo dice. Chi era entrato prima collega i prodotti Google dal menu dell'account.
// L'accesso vero a Google non si prova qui: le sue pagine sono finte (tests/helpers/googleFinto.mjs), e se Google
// risponda davvero disallowed_useragent a una scheda di Filo lo dice solo una prova dal vivo.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso, rispondiAlLoopback } from './helpers/googleFinto.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const EMAIL = 'chi.accede@prova.test';

async function avviaAccesso(shell) {
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
}
const esito = (shell) => shell.evaluate(() => window.__esito);

async function paginaDi(app, prefisso) {
  const scade = Date.now() + 10_000;
  while (Date.now() < scade) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(prefisso + '?'); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda sulla pagina d\'accesso');
}

async function vociMenuAccount(app, shell) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { if (w.webContents.getURL().startsWith('data:text/html')) w.destroy(); } catch (_) {}
    }
  });
  await shell.evaluate(() => document.getElementById('nav-account').click());
  const scade = Date.now() + 8_000;
  while (Date.now() < scade) {
    const popup = app.windows().find((w) => { try { return w.url().startsWith('data:text/html'); } catch (_) { return false; } });
    if (popup) {
      try {
        await popup.locator('.item').first().waitFor({ timeout: 1000 });
        return { popup, voci: await popup.locator('.item').allInnerTexts() };
      } catch (_) { /* non ancora pronto */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { popup: null, voci: [] };
}

test('l\'accesso si apre in una scheda di Filo, il codice arriva al loopback e la scheda si chiude', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  const prima = (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs.length;
  await avviaAccesso(shell);

  const url = await indirizzoDellAccesso(app, pagina);
  expect(url, 'la pagina d\'accesso deve aprirsi in una scheda').toBeTruthy();
  const [scheda] = await schedeSu(app, pagina);
  expect(scheda.attiva, 'la scheda d\'accesso va davanti').toBe(true);
  const q = new URL(url).searchParams;
  expect(q.get('code_challenge_method')).toBe('S256');
  expect(q.get('prompt'), 'basta scegliere l\'account, niente consenso a ogni accesso').toBe('select_account');
  expect(q.has('access_type')).toBe(false);
  expect(new URL(q.get('redirect_uri')).hostname).toBe('127.0.0.1');

  const page = await paginaDi(app, pagina);
  await page.locator('#continua').click();
  const r = await esito(shell);
  expect(r.ok, r.error).toBe(true);
  expect(r.profile.email).toBe(EMAIL);

  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length), { message: 'la scheda d\'accesso resta aperta' }).toBe(0);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  expect(snap.tabs.length).toBe(prima);
  expect(snap.tabs.some((t) => /127\.0\.0\.1:\d+\/\?code=/.test(t.url || '')), 'una scheda è rimasta sulla pagina del loopback').toBe(false);
  expect(await app.evaluate(() => globalThis.__aperture.length), 'il browser di sistema non serviva').toBe(0);
});

test('Google rifiuta la scheda: l\'accesso passa da solo al browser di sistema, con una riga che lo dice, e riesce', async ({ app, shell, testServer, avvisi }) => {
  const pagina = await googleFinto(app, testServer, { rifiuta: true });
  await risposteFinte(app, EMAIL);
  await avviaAccesso(shell);

  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length), { timeout: 10_000 }).toBe(1);
  const nelBrowser = await app.evaluate(() => globalThis.__aperture[0]);
  expect(nelBrowser.startsWith(pagina + '?'), 'nel browser va lo stesso indirizzo d\'accesso').toBe(true);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  expect(snap.tabs.some((t) => /signin\/rejected/.test(t.url || '')), 'la pagina del rifiuto è rimasta in una scheda').toBe(false);

  const vista = await avvisi();
  const riga = vista.locator('.shell-notif-msg', { hasText: 'Google non accetta l\'accesso dentro Filo' });
  await expect(riga).toBeVisible({ timeout: 8_000 });
  await expect(riga).toContainText('continua nel browser');
  mkdirSync(SHOTS, { recursive: true });
  await vista.screenshot({ path: join(SHOTS, '1123-ripiego-browser.png') });

  // Lo stesso flusso: il browser di sistema completa l'accesso a Filo.
  expect(await rispondiAlLoopback(nelBrowser)).toBe(200);
  const r = await esito(shell);
  expect(r.ok, r.error).toBe(true);
  expect(r.profile.email).toBe(EMAIL);
  // Dentro Filo, «continua nel browser» non ha più niente da dire.
  await expect(shell.locator('.shell-notif-msg', { hasText: 'continua nel browser' })).toHaveCount(0, { timeout: 8_000 });
});

test('chiudere la scheda dell\'accesso lo annulla subito, e lo dice', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await avviaAccesso(shell);
  await indirizzoDellAccesso(app, pagina);
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
  const r = await esito(shell);
  expect(r.ok).toBe(false);
  expect(r.code).toBe('annullato');
  expect(r.error).toBe('Accesso annullato: riprova quando vuoi.');
  expect(await app.evaluate(() => globalThis.__aperture.length)).toBe(0);
});

test('«Annulla» nella pagina di Google: la scheda si chiude e l\'accesso dice che è annullato', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await avviaAccesso(shell);
  const page = await paginaDi(app, pagina);
  await page.locator('#annulla').click();
  const r = await esito(shell);
  expect(r.code).toBe('annullato');
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);
});

test('chiedere di nuovo l\'accesso mentre la scheda aspetta la riporta davanti, senza aprirne un\'altra', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await avviaAccesso(shell);
  await indirizzoDellAccesso(app, pagina);
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await expect.poll(() => schedeSu(app, pagina).then((s) => s[0] && s[0].attiva)).toBe(false);
  await shell.evaluate(() => { window.__secondo = window.filoShell.auth.signIn(); });
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.map((x) => `${x.id}:${x.attiva}`).join())).toBe(`${scheda.id}:true`);
  const page = await paginaDi(app, pagina);
  await page.locator('#continua').click();
  const [a, b] = await shell.evaluate(() => Promise.all([window.__esito, window.__secondo]));
  expect(a.ok && b.ok, 'tutti e due i gesti hanno lo stesso esito').toBe(true);
});

test('una scheda d\'accesso dove l\'utente ha aperto altro resta sua: non torna davanti e non si chiude', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await avviaAccesso(shell);
  await indirizzoDellAccesso(app, pagina);
  const [scheda] = await schedeSu(app, pagina);
  const altro = testServer.html('<p>un altro sito</p>').replace('127.0.0.1', 'blocked.test');
  await shell.evaluate(([id, u]) => window.filoShell.tabs.navigate(id, u), [scheda.id, altro]);
  await expect.poll(() => schedeSu(app, altro).then((s) => s.length)).toBe(1);

  await shell.evaluate(() => { window.__secondo = window.filoShell.auth.signIn(); });
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length), { message: 'serve una pagina d\'accesso nuova' }).toBe(1);
  const [nuova] = await schedeSu(app, pagina);
  expect(nuova.id).not.toBe(scheda.id);
  await (await paginaDi(app, pagina)).locator('#continua').click();
  expect((await shell.evaluate(() => window.__secondo)).ok).toBe(true);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);
  expect((await schedeSu(app, altro)).map((s) => s.id), 'la scheda dell\'utente è rimasta').toEqual([scheda.id]);
});

test('chi è dentro Filo senza Google nelle schede: invito una volta, voce nel menu, accesso web con l\'email già scritta', async ({ app, shell, testServer, avvisi }) => {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await avviaAccesso(shell);
  await (await paginaDi(app, pagina)).locator('#continua').click();
  expect((await esito(shell)).ok).toBe(true);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);

  const stato = await shell.evaluate(() => window.filoShell.auth.status());
  expect(stato.googleNelleSchede).toBe(false);

  // L'invito, una volta sola.
  const invita = () => app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]prodottiGoogle\.js$/.test(x));
    return M._cache[k].exports.invitaSeServe();
  });
  expect(await invita()).toBe(true);
  const vista = await avvisi();
  const invito = vista.locator('.shell-notif', { hasText: 'YouTube, Gmail e Drive nelle schede' });
  await expect(invito).toBeVisible({ timeout: 8_000 });
  mkdirSync(SHOTS, { recursive: true });
  await vista.screenshot({ path: join(SHOTS, '1123-invito.png') });
  expect(await invita(), 'l\'invito non torna').toBe(false);

  // «Collega» dall'invito: l'accesso web a Google in una scheda, con l'email del profilo e YouTube come arrivo.
  await invito.locator('.shell-notif-action', { hasText: 'Collega' }).click();
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url).toBeTruthy();
  const q = new URL(url).searchParams;
  expect(q.get('Email')).toBe(EMAIL);
  expect(q.get('continue')).toBe('https://www.youtube.com/');
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);

  // Il menu dell'account, finché Google nelle schede non c'è: la voce per collegarlo e l'uscita che parla solo di Filo.
  for (const tema of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    const { popup, voci } = await vociMenuAccount(app, shell);
    expect(voci).toContain('Collega anche i prodotti Google');
    expect(voci).toContain('Esci da Filo');
    await popup.screenshot({ path: join(SHOTS, `1123-menu-${tema}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });

  // La voce del menu fa la stessa cosa dell'invito.
  const { popup } = await vociMenuAccount(app, shell);
  // Il menu si chiude al clic: la chiusura può arrivare prima che Playwright chiuda il suo giro.
  await popup.locator('.item', { hasText: 'Collega anche i prodotti Google' }).click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(1);

  // Google entra nelle schede: la voce sparisce, l'uscita dice che Google resta, e i suoi domini diventano protetti.
  await app.evaluate(({ session }) => session.defaultSession.cookies.set({
    url: 'https://accounts.google.com/', domain: '.google.com', name: 'SID', value: 'sid-prova', secure: true,
    expirationDate: Math.floor(Date.now() / 1000) + 3600,
  }));
  await expect.poll(() => shell.evaluate(() => window.filoShell.auth.status().then((s) => s.googleNelleSchede))).toBe(true);
  const dopo = await vociMenuAccount(app, shell);
  expect(dopo.voci).not.toContain('Collega anche i prodotti Google');
  expect(dopo.voci).toContain('Esci da Filo (Google resta collegato)');
  await dopo.popup.screenshot({ path: join(SHOTS, '1123-menu-collegato.png') });
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.cookies && s.security.cookies.loggedSites) || [];
  })).toContain('google.com');

  // Uscire da Filo non scollega Google nelle schede.
  await shell.evaluate(() => window.filoShell.auth.signOut());
  const sid = await app.evaluate(({ session }) => session.defaultSession.cookies.get({ name: 'SID' }).then((l) => l.length));
  expect(sid).toBe(1);
});

test('collegare i prodotti Google quando Google rifiuta la scheda: la scheda si chiude e una riga lo dice', async ({ app, shell, testServer, avvisi }) => {
  const pagina = await googleFinto(app, testServer, { rifiuta: true });
  const r = await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  expect(r.ok).toBe(true);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'Google non accetta l\'accesso dentro Filo, quindi YouTube, Gmail e Drive nelle schede restano scollegati' })).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length)).toBe(0);
  expect(await app.evaluate(() => globalThis.__aperture.length), 'il browser di sistema non collega le schede: non si apre').toBe(0);
});

test('un sito non può aprire l\'accesso ai prodotti Google', async ({ app, shell }) => {
  void shell;
  const r = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    return globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUTH_COLLEGA_GOOGLE }, { url: 'https://sito.example/', tab: null });
  });
  expect(r.ok).toBe(false);
  expect(r.code).toBe('forbidden');
});

test('Privacy: un account Google visto nelle schede rende persistente il jar di Google e ci porta i cookie', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async ({ session }) => {
    const M = process.getBuiltinModule('module');
    const mod = (re) => M._cache[Object.keys(M._cache).find((x) => re.test(x))].exports;
    const { applySettingsUpdate } = mod(/services[\\/]handlers\.js$/);
    const Cookies = mod(/services[\\/]cookies\.js$/);
    await applySettingsUpdate({ security: { cookies: { mode: 'privacy', trustedSites: [] } } });
    const effimera = Cookies.sessioneDelleSchede('https://accounts.google.com/');
    const giaYoutube = Cookies.sessioneDelleSchede('https://www.youtube.com/') === effimera;
    await effimera.cookies.set({
      url: 'https://accounts.google.com/', domain: '.google.com', name: 'SID', value: 'sid-privacy', secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 3600,
    });
    const persistente = session.fromPartition('persist:filo-priv-google.com');
    const scade = Date.now() + 8000;
    let sid = [];
    while (Date.now() < scade) {
      sid = await persistente.cookies.get({ name: 'SID' });
      if (sid.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = await globalThis.SN_STORAGE.getSettings();
    return {
      giaYoutube,
      fidati: s.security.cookies.trustedSites,
      sid: sid.map((c) => c.value),
      dopo: Cookies.sessioneDelleSchede('https://www.youtube.com/') === persistente,
    };
  });
  expect(out.giaYoutube, 'Google e YouTube nello stesso jar').toBe(true);
  expect(out.fidati).toContain('google.com');
  expect(out.sid).toEqual(['sid-privacy']);
  expect(out.dopo, 'una scheda nuova su YouTube trova il jar persistente').toBe(true);
  const stato = await shell.evaluate(() => window.filoShell.auth.status());
  expect(stato.googleNelleSchede).toBe(true);
});

test('il menu dell\'account si apre subito anche quando il token di Filo va rinnovato', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  // Firebase dà un token che scade subito, e il suo rinnovo impiega quattro secondi.
  await app.evaluate((_e, email) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-prova', sub: 'uid-prova', email })}.x`;
    const vero = globalThis.fetch;
    const risposta = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return risposta({ id_token: jwt });
      if (u.includes('accounts:signInWithIdp')) return risposta({ idToken: jwt, refreshToken: 'rt', email, displayName: 'X', expiresIn: '60' });
      if (u.includes('securetoken')) { await new Promise((r) => setTimeout(r, 4000)); return risposta({ id_token: jwt, expires_in: '3600' }); }
      return vero(input, init);
    };
  }, EMAIL);
  await avviaAccesso(shell);
  await (await paginaDi(app, pagina)).locator('#continua').click();
  expect((await esito(shell)).ok).toBe(true);
  const t0 = Date.now();
  const { voci } = await vociMenuAccount(app, shell);
  expect(voci).toContain('Esci da Filo');
  expect(Date.now() - t0, 'il menu aspetta il rinnovo del token').toBeLessThan(2000);
});

test('l\'accesso chiesto dalla finestra incognito porta davanti la finestra con la scheda di Google', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  const scade = Date.now() + 15_000;
  while (!inc && Date.now() < scade) {
    inc = app.windows().find((w) => { try { return /shell\.html\?incognito=1/.test(w.url()); } catch (_) { return false; } });
    if (!inc) await new Promise((r) => setTimeout(r, 100));
  }
  await inc.waitForFunction(() => !!(window.filoShell && window.filoShell.auth));
  // Senza un gestore di finestre il fuoco non si legge: si conta la richiesta di venire davanti.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    globalThis.__davanti = 0;
    const focus = w.focus.bind(w);
    w.focus = (...a) => { globalThis.__davanti++; return focus(...a); };
  });
  await inc.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  expect(await app.evaluate(() => globalThis.__davanti), 'la finestra normale resta dietro quella incognito').toBeGreaterThan(0);
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
  expect((await inc.evaluate(() => window.__esito)).code).toBe('annullato');
});

// Riaperta dopo un riavvio o dall'archivio, la pagina d'accesso porterebbe a un ritorno che non ascolta più.
test('la pagina d\'accesso in attesa non si riapre al prossimo avvio, e chiusa non finisce nell\'archivio', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  const altra = testServer.html('<title>Mia</title><p>mia</p>', { pubblico: true });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), altra);
  await avviaAccesso(shell);
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  const salvate = () => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getRaw('sn_open_tabs', null);
    return (s && s.tabs) || [];
  });
  await expect.poll(salvate, { message: 'la scheda dell\'utente si salva' }).toContain(altra);
  await new Promise((r) => setTimeout(r, 1000));
  expect((await salvate()).filter((u) => u.startsWith(pagina + '?'))).toEqual([]);

  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), scheda.id);
  expect((await esito(shell)).code).toBe('annullato');
  await new Promise((r) => setTimeout(r, 1000));
  const archivio = await app.evaluate(async () => {
    const l = await globalThis.SN_ARCHIVED_TABS.list();
    return (Array.isArray(l) ? l : (l && l.items) || []).map((x) => x.url);
  });
  expect(archivio.filter((u) => String(u).startsWith(pagina + '?'))).toEqual([]);
});

test('«Collega anche i prodotti Google» chiesto di nuovo riporta davanti la stessa pagina d\'accesso', async ({ app, shell, testServer }) => {
  const pagina = await googleFinto(app, testServer);
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  const [scheda] = await schedeSu(app, pagina);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await expect.poll(() => schedeSu(app, pagina).then((s) => s[0] && s[0].attiva)).toBe(false);
  await shell.evaluate(() => window.filoShell.message({ type: 'auth_collega_google' }));
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.map((x) => `${x.id}:${x.attiva}`).join())).toBe(`${scheda.id}:true`);
});

test('una pagina d\'accesso che non si carica: si continua nel browser con il motivo vero, e l\'invito a collegare resta', async ({ app, shell, testServer, avvisi }) => {
  await googleFinto(app, testServer);
  // Una porta dove nessuno risponde: la pagina d'accesso non si carica.
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]config\.js$/.test(x));
    M._cache[k].exports.authEndpoint = 'http://sito-pubblico.test:9/o/oauth2/v2/auth';
  });
  await avviaAccesso(shell);
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length), { timeout: 15_000 }).toBe(1);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif-msg', { hasText: 'non si è caricata' })).toBeVisible({ timeout: 8_000 });
  expect((await vista.locator('.shell-notif-msg').allInnerTexts()).join(' | ')).not.toContain('Google non accetta');
  const invitoSegnato = await app.evaluate(({ app: a }) => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    return fs.existsSync(path.join(a.getPath('userData'), 'invito-prodotti-google'));
  });
  expect(invitoSegnato, 'l\'invito a collegare i prodotti Google non deve sparire per una pagina non caricata').toBe(false);
});
