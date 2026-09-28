// Permessi chiesti dai siti (#586): fotocamera, microfono, notifiche e gli altri non passano senza un «Consenti»
// dato nella striscia sotto le schede, la scelta si ricorda per sito e si cambia dal tasto destro sulla scheda e da
// Sicurezza. Senza il custode Electron concede tutto: la pagina riceverebbe «granted» e il flusso subito.

import { test, expect } from './fixtures/electron.mjs';
import { tastoDestroScheda, testoMenu, cliccaFinche } from './helpers/menuScheda.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const PAGINA = `<!doctype html><html><head><title>Permessi</title></head><body>
<h1>Pagina che chiede</h1><textarea id="campo"></textarea>
<script>
  window.chiediNotifiche = () => Notification.requestPermission();
  window.chiediCamera = () => navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((s) => { const n = s.getTracks().length; s.getTracks().forEach((t) => t.stop()); return 'ok:' + n; },
      (e) => 'err:' + e.name);
  window.chiediSchermo = () => navigator.mediaDevices.getDisplayMedia({ video: true })
    .then((s) => { const n = s.getVideoTracks().length; s.getTracks().forEach((t) => t.stop()); return 'ok:' + n; },
      (e) => 'err:' + e.name);
</script>
<button id="schermo" onclick="window.__esito = null; chiediSchermo().then((r) => { window.__esito = r; })">Presenta</button>
</body></html>`;

async function avvia(page, fn) {
  await page.evaluate((f) => {
    window.__esito = null;
    window[f]().then((r) => { window.__esito = r; });
  }, fn);
}
const esito = (page) => page.evaluate(() => window.__esito);

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// La freccia accanto a una voce del menu della scheda apre il secondo livello.
async function freccia(app, ago, etichetta) {
  for (const w of app.windows()) {
    try {
      const ok = await w.evaluate(({ n, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return false;
        const r = [...document.querySelectorAll('.row')].find((x) => new RegExp(l).test(x.querySelector('.item').textContent.trim()));
        if (!r) return false;
        r.querySelector('.subarrow').click();
        return true;
      }, { n: ago, l: etichetta });
      if (ok) return true;
    } catch (_) {}
  }
  return false;
}

async function inAlto(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w ? w._filoTabs.topInset : -1;
  });
}

test('notifiche: la pagina aspetta, nessun sì senza risposta; «Consenti» dalla striscia glielo dà e Sicurezza lo mostra', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const host = new URL(testServer.origin).host;

  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');
  await avvia(page, 'chiediNotifiche');

  // Il «sì» appena comparso è spento: un doppio clic partito dalla pagina non risponde al posto dell'utente.
  const primo = await shell.waitForFunction(() => {
    const b = document.querySelector('#perm-bar .perm-si');
    return b ? { spento: b.disabled, testo: document.querySelector('#perm-bar').innerText } : null;
  }, null, { timeout: 10_000 }).then((h) => h.jsonValue());
  expect(primo.spento).toBe(true);
  expect(primo.testo).toContain(host);
  expect(primo.testo).toContain('vuole mandarti notifiche');

  await page.waitForTimeout(400);
  expect(await esito(page), 'senza risposta la pagina non riceve niente').toBeNull();
  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');
  // La striscia fa spazio: la pagina scende e niente la copre.
  const alto = await inAlto(app);
  expect(alto).toBeGreaterThan(20);

  mkdirSync(SHOTS, { recursive: true });
  await shell.screenshot({ path: join(SHOTS, 'permessi-striscia.png') });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.screenshot({ path: join(SHOTS, 'permessi-striscia-scuro.png') });
  await shell.emulateMedia({ colorScheme: 'light' });

  const si = shell.locator('#perm-bar .perm-si');
  await expect(si).toBeEnabled({ timeout: 5_000 });
  await si.click();
  await expect.poll(() => esito(page)).toBe('granted');
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  await expect(riga(shell)).toHaveCount(0);
  await expect.poll(() => inAlto(app)).toBe(0);

  // Sicurezza → Permessi dei siti: il sito c'è, con le notifiche consentite.
  const sec = await openTab('filo://security/security.html');
  const voce = sec.locator(`#perm-list li[data-origine="${testServer.origin}"]`);
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await expect(voce.locator('.sn-perm-host')).toHaveText(host);
  const notifiche = voce.locator('.sn-perm-riga[data-tipo="notifiche"]');
  await expect(notifiche.locator('button[aria-pressed="true"]')).toHaveText('Consentito');
  await sec.locator('#sec-permessi').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: join(SHOTS, 'permessi-sicurezza.png') });
  await sec.emulateMedia({ colorScheme: 'dark' });
  await sec.screenshot({ path: join(SHOTS, 'permessi-sicurezza-scuro.png') });
  await sec.emulateMedia({ colorScheme: 'light' });

  // Da lì si blocca: la pagina lo vede subito.
  await notifiche.locator('button[data-valore="nega"]').click();
  await expect(notifiche.locator('button[aria-pressed="true"]')).toHaveText('Bloccato');
  await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('denied');
  // E si dimentica: il sito sparisce dalla lista e la prossima volta si torna a chiedere.
  await voce.locator('.sn-perm-dimentica').click();
  await expect(voce).toHaveCount(0);
  await expect(sec.locator('#perm-list .sn-perm-vuoto')).toBeVisible();
  await avvia(page, 'chiediNotifiche');
  // La scheda in sottofondo lo segnala; la domanda si vede tornandoci.
  await expect(shell.locator('.tab .perm-ind')).toHaveCount(1, { timeout: 10_000 });
  await expect(riga(shell)).toHaveCount(0);
  await shell.screenshot({ path: join(SHOTS, 'permessi-scheda-in-attesa.png'), clip: { x: 0, y: 0, width: 640, height: 44 } });
  await shell.locator('.tab', { has: shell.locator('.perm-ind') }).click();
  await expect(riga(shell)).toHaveCount(1);
  await expect(shell.locator('.tab .perm-ind')).toHaveCount(0);
});

test('fotocamera e microfono: «Nega» si ricorda, dal tasto destro sulla scheda si consentono e la pagina riceve il flusso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const origine = testServer.origin;
  const scelte = () => app.evaluate((_e, o) => {
    const s = globalThis.__filoPermessi.elenco(null).find((x) => x.origine === o);
    return s ? s.scelte : {};
  }, origine);
  const apriPermessi = async () => {
    if (await testoMenu(app, 'Gestisci permessi')) return;
    await cliccaFinche(app, {
      apri: () => tastoDestroScheda(shell),
      ago: 'Permessi del sito',
      etichetta: '^Permessi del sito$',
      finche: async () => !!(await testoMenu(app, 'Gestisci permessi')),
    });
  };

  // Prima di ogni scelta la pagina legge «da chiedere», non «negato»; e un permesso mai chiesto si dà anche dal tasto destro.
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
  expect(await page.evaluate(() => navigator.permissions.query({ name: 'camera' }).then((s) => s.state))).toBe('prompt');
  await cliccaFinche(app, {
    apri: apriPermessi,
    ago: 'Gestisci permessi',
    etichetta: '^Consenti notifiche$',
    finche: async () => (await scelte()).notifiche === 'consenti',
  });
  await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('granted');

  await avvia(page, 'chiediCamera');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(riga(shell)).toContainText('vuole usare la fotocamera e il microfono');
  await shell.locator('#perm-bar .perm-no').click();
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');

  // Ricordato: la seconda volta il no arriva subito, senza striscia.
  await avvia(page, 'chiediCamera');
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');
  await expect(riga(shell)).toHaveCount(0);

  expect(await scelte()).toEqual({ notifiche: 'consenti', camera: 'nega', microfono: 'nega' });

  for (const [voce, tipo] of [['Consenti fotocamera', 'camera'], ['Consenti microfono', 'microfono']]) {
    await cliccaFinche(app, {
      apri: apriPermessi,
      ago: 'Gestisci permessi',
      etichetta: `^${voce}$`,
      finche: async () => (await scelte())[tipo] === 'consenti',
    });
  }

  await avvia(page, 'chiediCamera');
  await expect.poll(() => esito(page), { timeout: 10_000 }).toBe('ok:2');
  await expect(riga(shell)).toHaveCount(0);

  // Col sì dato, la voce è «Blocca»: chi apre il menu mentre il sito usa la fotocamera vuole dire di no.
  await cliccaFinche(app, {
    apri: apriPermessi,
    ago: 'Gestisci permessi',
    etichetta: '^Blocca fotocamera$',
    finche: async () => (await scelte()).camera === 'nega',
  });
  await avvia(page, 'chiediCamera');
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');
  // La freccia della voce porta al resto: «Chiedimelo ogni volta» toglie la scelta e la volta dopo si torna a chiedere.
  await cliccaFinche(app, {
    apri: async () => {
      await apriPermessi();
      for (let i = 0; i < 15; i++) { if (await freccia(app, 'Gestisci permessi', '^Consenti fotocamera$')) break; await sleep(40); }
    },
    ago: 'Chiedimelo ogni volta',
    etichetta: 'Chiedimelo ogni volta$',
    finche: async () => !(await scelte()).camera,
  });
  await avvia(page, 'chiediCamera');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(riga(shell)).toContainText('vuole usare la fotocamera');
  await shell.locator('#perm-bar .perm-chiudi').click();
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');
  expect((await scelte()).camera, '«Non ora» non si ricorda').toBeUndefined();
});

test('ogni partizione nasce protetta: una sessione nuova nega da sola, l’incognito chiede nella sua finestra e non scrive su disco', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html(PAGINA);

  // Una partizione creata adesso, fuori da ogni scheda: ha il custode e, senza nessuno a cui chiedere, dice no.
  const nuova = await app.evaluate(async ({ session, BrowserWindow }, u) => {
    const ses = session.fromPartition(`prova-${Date.now()}`);
    const w = new BrowserWindow({ show: false, webPreferences: { session: ses } });
    await w.loadURL(u);
    const esito = await w.webContents.executeJavaScript('Notification.requestPermission()', true);
    const stato = await w.webContents.executeJavaScript('Notification.permission', true);
    w.destroy();
    return { protetta: globalThis.__filoPermessi.protetta(ses), esito, stato };
  }, url);
  expect(nuova).toEqual({ protetta: true, esito: 'denied', stato: 'denied' });

  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url); return !!page; }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  expect(await app.evaluate(({ webContents }, u) => {
    const wc = webContents.getAllWebContents().find((x) => x.getURL() === u);
    return globalThis.__filoPermessi.protetta(wc.session);
  }, url)).toBe(true);

  await avvia(page, 'chiediNotifiche');
  const si = inc.locator('#perm-bar .perm-si');
  await expect(si).toBeVisible({ timeout: 10_000 });
  await expect(riga(shell), 'la domanda sta nella finestra della scheda che chiede').toHaveCount(0);
  await expect(si).toBeEnabled();
  await si.click();
  await expect.poll(() => esito(page)).toBe('granted');

  const suDisco = await app.evaluate(async () => {
    const r = await globalThis.__filoStorage.get('sitePermissions');
    return { disco: r.sitePermissions || null, normale: globalThis.__filoPermessi.elenco(null) };
  });
  expect(suDisco).toEqual({ disco: null, normale: [] });
});

test('Incolla di Filo su un sito legge gli appunti senza chiedere al sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ clipboard }) => clipboard.writeText('copiato-da-me'));

  await page.locator('#campo').focus();
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();

  await expect(page.locator('#campo')).toHaveValue('copiato-da-me', { timeout: 5_000 });
  await expect(riga(shell)).toHaveCount(0);
  const elenco = await app.evaluate(() => globalThis.__filoPermessi.elenco(null));
  expect(elenco, 'il sito non si ritrova un permesso sugli appunti').toEqual([]);
});

test('condividere lo schermo: si chiede ogni volta, «Condividi lo schermo» dà il video alla pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);

  await page.click('#schermo');
  await expect(riga(shell)).toContainText('vuole vedere il tuo schermo', { timeout: 10_000 });
  const si = shell.locator('#perm-bar .perm-si');
  await expect(si).toHaveText('Condividi lo schermo');
  await expect(si).toBeEnabled();
  await si.click();
  // Prima si sceglie cosa: lo schermo, una scheda, la finestra di un'altra app. I nomi sono di Filo, in italiano.
  const schermo = shell.locator('#perm-bar .perm-fonte[data-tipo="schermo"]').first();
  await expect(schermo).toBeVisible({ timeout: 10_000 });
  await expect(schermo).toContainText(/^Schermo/);
  await expect(shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]', { hasText: '(questa)' })).toHaveCount(1);
  await shell.screenshot({ path: join(SHOTS, 'permessi-scelta-schermo.png') });
  expect(await esito(page), 'finché non si sceglie, la pagina non ha niente').toBeNull();
  await schermo.click();
  await expect.poll(() => esito(page), { timeout: 10_000 }).toBe('ok:1');
  // La scheda lo dice finché la pagina è aperta.
  await expect(shell.locator('.tab.active .perm-uso')).toHaveAttribute('data-tip', /usa lo schermo/);

  // Si può mostrare una scheda sola invece di tutto lo schermo.
  await page.click('#schermo');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await expect(si).toBeEnabled();
  await si.click();
  await shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]', { hasText: '(questa)' }).click();
  await expect.poll(() => esito(page), { timeout: 10_000 }).toBe('ok:1');

  // Non si ricorda: la volta dopo si torna a chiedere, e «Nega» non resta scritto da nessuna parte.
  await page.click('#schermo');
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  await shell.locator('#perm-bar .perm-no').click();
  await expect.poll(() => esito(page)).toBe('err:NotAllowedError');
  expect(await app.evaluate(() => globalThis.__filoPermessi.elenco(null))).toEqual([]);
});
