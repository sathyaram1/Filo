// Permessi delle pagine web (#591.1): microfono, fotocamera e appunti li decide l'utente nella cornice della finestra,
// non la pagina. Regole: src/main/services/permessiPagine.js. Dispositivi finti: nessuna periferica vera coinvolta.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const esiti = [];
const PAGINE = {
  '/media': `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>stanza</p>
<script>
  navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).sort().join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
</script>`,
  '/appunti': `<!doctype html><meta charset="utf-8"><title>Appunti</title><input autofocus>
<script>
  const prova = () => navigator.clipboard.readText().then(
    (x) => fetch('/esito?m=' + encodeURIComponent('letto:' + x)),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
  window.__prova = prova;
  setTimeout(prova, 300);
</script>`,
};

// La finestra nascosta si chiude a caricamento finito: un riquadro lento tiene viva la pagina mentre chiede.
PAGINE['/media-lenta'] = PAGINE['/media'] + '<iframe src="/lento"></iframe>';
PAGINE['/microfono'] = PAGINE['/media'].replace('{ audio: true, video: true }', '{ audio: true }');
PAGINE['/fotocamera'] = `<!doctype html><meta charset="utf-8"><title>Modulo</title><textarea autofocus></textarea><script>
  window.__prova = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  window.__prova();
</script>`;
const NOTIFICA = `const chiedi = () => Notification.requestPermission().then((x) => fetch('/esito?m=' + encodeURIComponent('notifiche:' + x)));`;
PAGINE['/notifiche-subito'] = `<!doctype html><meta charset="utf-8"><title>Offerta</title><script>${NOTIFICA} chiedi();</script>`;
PAGINE['/notifiche-clic'] = `<!doctype html><meta charset="utf-8"><title>Posta</title>
<button id="attiva" style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
<script>${NOTIFICA} document.getElementById('attiva').addEventListener('click', chiedi);</script>`;
// Come WhatsApp Web e Gmail: il pulsante per attivare le notifiche compare solo se il browser dice che si può chiedere.
PAGINE['/messaggi'] = `<!doctype html><meta charset="utf-8"><title>Messaggi</title>
<button id="attiva" hidden style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
<script>
  const manda = (m) => fetch('/esito?m=' + encodeURIComponent(m));
  navigator.permissions.query({ name: 'notifications' }).then((s) => {
    manda('stato:' + Notification.permission + '/' + s.state);
    if (Notification.permission !== 'default') return;
    const b = document.getElementById('attiva');
    b.hidden = false;
    b.addEventListener('click', () => Notification.requestPermission().then((x) => manda('notifiche:' + x + '/' + Notification.permission)));
  });
</script>`;
// Come la «modalità cucina» di un sito di ricette: lo schermo resta acceso dopo un clic, e Chrome non chiede niente.
PAGINE['/ricetta'] = `<!doctype html><meta charset="utf-8"><title>Ricetta</title>
<button id="cucina" style="position:fixed;top:200px;left:200px">Modalità cucina</button>
<script>
  document.getElementById('cucina').addEventListener('click', () => navigator.wakeLock.request('screen').then(
    () => fetch('/esito?m=schermo:acceso'), (e) => fetch('/esito?m=' + encodeURIComponent('schermo:' + e.name))));
</script>`;
PAGINE['/esterno'] = `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>niente</p><script>
  setTimeout(() => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.src = 'prova-filo-esterno:apri-un-programma';
    document.body.appendChild(f);
    fetch('/esito?m=riquadro');
  }, 300);
</script>`;
// Indirizzo lungo: la parte davanti la sceglie chi registra il sito, il dominio vero sta in fondo.
const LUNGO = 'videochiamata.sessione-sicura-verifica-account-utente-accesso-autorizzato'
  + '.conferma-identita-riunione-video-chiamata-partecipante.dominio-vero.test';

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 20_000); t.unref?.(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINE[u.pathname] || '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let shell;
let userData;
let aperti;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-permessi-');
  // Chi apre gli indirizzi delle altre applicazioni, su Linux: uno finto che prende nota.
  const bin = join(userData, 'bin-finto');
  mkdirSync(bin, { recursive: true });
  aperti = join(userData, 'aperti.log');
  writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> "${aperti}"\n`);
  chmodSync(join(bin, 'xdg-open'), 0o755);
  const porta = new URL(origine).port;
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', `--host-resolver-rules=MAP ${LUNGO} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${LUNGO}:${porta}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const apri = (percorso) => shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
const barra = () => shell.locator('#permesso-bar');

test('microfono e fotocamera: la cornice chiede col nome del sito, Consenti li dà alla pagina e per quel sito non si richiede', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText(new URL(origine).host);
  await expect(barra()).toContainText('microfono e fotocamera');
  expect(esiti, 'la pagina aspetta la risposta').toEqual([]);
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso:audio,video']);
  await expect(barra()).toBeHidden();

  await apri('/media');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('concesso:audio,video');
  await expect(barra()).toBeHidden();
});

test('Non consentire: la pagina riceve un no, e per quel sito la domanda non torna', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  await apri('/media');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('negato:NotAllowedError');
  await expect(barra()).toBeHidden();
});

test('appunti: la pagina non legge quello che hai copiato senza un sì; con Incolla di Filo sì, senza domande', async () => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('parola-segreta'));
  await apri('/appunti');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole leggere quello che hai copiato');
  expect(esiti).toEqual([]);
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  // Incolla di Filo: il content script chiede il lasciapassare per la sua scheda, poi legge.
  const pagina = app.windows().find((w) => w.url().startsWith(origine));
  const ok = await app.evaluate(async ({ BrowserWindow }, base) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.view.webContents.getURL().startsWith(base));
      if (!t) continue;
      const wc = t.view.webContents;
      wc.focus();
      return globalThis.SN_HANDLE_MESSAGE({ type: 'permesso_filo', tipo: 'appunti' }, { tab: { id: t.id, url: wc.getURL() }, url: wc.getURL(), wc, win: w });
    }
    return null;
  }, origine);
  expect(ok && ok.ok).toBe(true);
  await pagina.evaluate(() => window.__prova());
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('letto:parola-segreta');
  await expect(barra()).toBeHidden();
});

test('la finestra nascosta del controllo profondo nega microfono e fotocamera alla pagina sospetta che riapre', async () => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), origine + '/media-lenta');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);
  await expect(barra()).toBeHidden();
});

const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));

test('un clic che arriva appena la domanda compare non concede: Consenti si arma dopo un attimo', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  const si = barra().locator('.permesso-si');
  await expect(si).toBeVisible({ timeout: 10_000 });
  // Il clic che la pagina fa cadere sulla domanda arriva prima che l'utente l'abbia letta.
  const box = await si.boundingBox();
  await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((ok) => setTimeout(ok, 1500));
  expect(esiti, 'concesso da un clic arrivato con la domanda appena comparsa').toEqual([]);
  await expect(si).toBeEnabled();
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso:audio,video']);
});

test('la domanda aspetta chi risponde con calma: dopo quindici secondi Consenti dà ancora il microfono', async () => {
  test.setTimeout(60_000);
  await apri('/microfono');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await new Promise((ok) => setTimeout(ok, 15_000));
  expect(esiti).toEqual([]);
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso:audio']);
});

test('«Azzera i permessi del sito» nel menu della scheda toglie un no: la pagina può chiedere di nuovo', async () => {
  test.setTimeout(60_000);
  await apri('/microfono');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 10) }));
  });
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => /Azzera i permessi del sito/.test(document.body.innerText))) { menu = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Azzera i permessi/.test(b.textContent)).click());

  await paginaDi(origine).reload();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole usare il microfono');
});

test('notifiche: chieste da sole al caricamento non fanno domande e non valgono un no; dopo un clic sulla pagina si chiedono', async () => {
  test.setTimeout(60_000);
  await apri('/notifiche-subito');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['notifiche:default']);
  await expect(barra()).toBeHidden();
  expect(await paginaDi(origine + '/notifiche-subito').evaluate(() => Notification.permission)).toBe('default');

  await apri('/notifiche-clic');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/notifiche-clic'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.locator('#attiva').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole mandarti notifiche');
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['notifiche:denied', 'notifiche:granted']);
});

test('una pagina non apre un\'altra applicazione da un riquadro invisibile, senza un clic', async () => {
  test.skip(process.platform !== 'linux', 'l\'apertura si osserva sostituendo xdg-open');
  test.setTimeout(60_000);
  await apri('/esterno');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['riquadro']);
  await new Promise((ok) => setTimeout(ok, 3000));
  expect(existsSync(aperti) ? readFileSync(aperti, 'utf8').trim() : '').toBe('');
});

test('il lasciapassare di Detta vale per il microfono, non per la fotocamera a cui l\'utente ha detto no', async () => {
  test.setTimeout(60_000);
  await apri('/fotocamera');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);
  const ok = await app.evaluate(async ({ BrowserWindow }, base) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.view.webContents.getURL().startsWith(base));
      if (!t) continue;
      const wc = t.view.webContents;
      return globalThis.SN_HANDLE_MESSAGE({ type: 'permesso_filo', tipo: 'media' }, { tab: { id: t.id, url: wc.getURL() }, url: wc.getURL(), wc, win: w });
    }
    return null;
  }, origine);
  expect(ok && ok.ok).toBe(true);
  await paginaDi(origine).evaluate(() => window.__prova());
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('negato:NotAllowedError');
});

test('con un indirizzo lunghissimo la domanda nomina il dominio vero e dice tutta la richiesta', async () => {
  test.setTimeout(60_000);
  const porta = new URL(origine).port;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LUNGO}:${porta}/media`);
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra().locator('strong')).toHaveText(`dominio-vero.test:${porta}`);
  const msg = barra().locator('.permesso-msg');
  await expect(msg).toContainText('vuole usare microfono e fotocamera');
  // Niente di tagliato: tutto il testo sta dentro la riga.
  expect(await msg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});
