// Lo schermo chiesto alla maniera vecchia da un riquadro vuoto che la pagina si crea e prende per indice (#1057): la
// scheda non muore, la domanda è quella di Filo, e i permessi mai decisi si leggono «da chiedere» anche lì dentro.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Le combinazioni che Chromium tratta come un messaggio guasto (le prime due) e quella che prenderebbe tutto senza scelta.
const VINCOLI = {
  'solo-audio': `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false }`,
  'microfono-e-schermo': `{ audio: true, video: { mandatory: { chromeMediaSource: 'desktop' } } }`,
  'schermo-e-audio': `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop' } } }`,
};
// Come la funzione del riquadro arriva a chiedere.
const CHIAMATE = {
  // La sua funzione sui dispositivi della pagina, come la prova del giro 16 di #586.
  prototipo: `w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, c)`,
  proprio: `w.navigator.mediaDevices.getUserMedia(c)`,
  callback: `new Promise((ok, no) => w.navigator.webkitGetUserMedia(c, ok, no))`,
};
const VUOTO = `(() => { document.body.appendChild(document.createElement('iframe')); return window[window.length - 1]; })()`;
// Le altre strade per avere in mano un riquadro vuoto appena nato, ognuna presa nello stesso istante.
const STRADE = {
  innerHTML: `(() => { const d = document.createElement('div'); document.body.appendChild(d); d.innerHTML = '<iframe></iframe>'; return window[window.length - 1]; })()`,
  insertAdjacentHTML: `(() => { document.body.insertAdjacentHTML('beforeend', '<iframe></iframe>'); return window[window.length - 1]; })()`,
  // Uno dello stesso sito in volo non si tocca (riquadri-vuoti.js, `inVolo`): perderebbe il preload all'arrivo.
  'con un indirizzo di un altro sito, prima che arrivi': `(() => { const f = document.createElement('iframe'); f.src = 'http://localhost:' + location.port + '/lento'; document.body.append(f); return window[window.length - 1]; })()`,
  'accanto a un riquadro dello stesso sito ancora in volo': `(() => { const l = document.createElement('iframe'); l.src = '/lento'; document.body.append(l); return ${VUOTO}; })()`,
  'nella radice ombra chiusa': `(() => { const h = document.createElement('div'); document.body.appendChild(h); const f = document.createElement('iframe'); h.attachShadow({ mode: 'closed' }).appendChild(f); return f.contentWindow; })()`,
  'dentro un altro riquadro vuoto': `(() => { const w = ${VUOTO}; w.document.body.appendChild(w.document.createElement('iframe')); return w[0]; })()`,
  'riscritto da capo': `(() => { const w = ${VUOTO}; w.document.open(); w.document.write('<iframe></iframe>'); w.document.close(); return w[0]; })()`,
  // Dalla seconda volta il documento nuovo ha una finestra nuova, e i prototipi di fabbrica.
  'rimandato a about:blank': `(async () => {
    const w = ${VUOTO};
    const f = [...document.querySelectorAll('iframe')].pop();
    for (const giro of [1, 2]) {
      await new Promise((ok) => { f.addEventListener('load', () => setTimeout(ok, 0), { once: true }); w.location.replace('about:blank?' + giro); });
    }
    return window[window.length - 1];
  })()`,
};

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Modulo</title>
<textarea id="nota" style="position:fixed;top:20px;left:20px;width:300px;height:60px"></textarea>
<button id="vai" style="position:fixed;top:120px;left:20px">Vai</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('vai').addEventListener('click', () => {
    let p;
    try { p = Promise.resolve(window.__azione()); } catch (e) { p = Promise.reject(e); }
    p.then((x) => m(String(x)), (e) => m(e && e.name));
  });
</script>`;

const esiti = [];
let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 20_000); t.unref?.(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
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
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-riquadro-vuoto-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));
const barra = () => shell.locator('#permesso-bar');

async function apri() {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `${origine}/modulo`);
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const p = paginaDi(origine);
  await p.waitForLoadState('load');
  return p;
}

// Il clic vero sul pulsante della pagina fa partire `azione` (il corpo di una funzione asincrona, nel mondo della pagina).
async function alClic(p, azione) {
  await p.evaluate((codice) => { window.__azione = new Function(`return (async () => { ${codice} })()`); }, azione);
  await p.locator('#vai').click();
}

// Chi la usa vede la stessa domanda dello schermo; anche scegliendo, al sito non arriva niente.
async function scegliLoSchermo(cosa) {
  await expect(barra(), cosa).toBeVisible({ timeout: 10_000 });
  const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
  await expect(fonte).toBeEnabled({ timeout: 5_000 });
  await fonte.click();
  await expect(barra()).toBeHidden({ timeout: 10_000 });
}

async function restaLaPagina(p) {
  await new Promise((r) => setTimeout(r, 1500));
  expect(paginaDi(origine), 'la scheda è ancora il sito, non la pagina d\'errore').toBeTruthy();
  expect(await p.evaluate(() => document.querySelector('#nota').value)).toBe('appunti da non perdere');
  await expect(shell.locator('.tab .tab-permessi .segno[data-parte="schermo"]')).toHaveCount(0);
}

for (const [chiamata, codice] of Object.entries(CHIAMATE)) {
  test(`schermo alla vecchia da un riquadro vuoto preso per indice (${chiamata}): la scheda resta, il testo pure, e la domanda è quella di Filo`, async () => {
    test.setTimeout(90_000);
    const p = await apri();
    await p.locator('#nota').fill('appunti da non perdere');
    for (const [nome, vincoli] of Object.entries(VINCOLI)) {
      esiti.length = 0;
      await alClic(p, `const w = ${VUOTO}; const c = ${vincoli}; const s = await ${codice}; return s.getTracks().map((t) => t.kind).join(',');`);
      await scegliLoSchermo(nome);
      await expect.poll(() => esiti.slice(), { timeout: 10_000, message: nome }).toEqual(['NotAllowedError']);
    }
    await restaLaPagina(p);
  });
}

test('le altre strade per avere un riquadro vuoto appena nato portano alla stessa domanda, e la scheda resta', async () => {
  test.setTimeout(150_000);
  const p = await apri();
  await p.locator('#nota').fill('appunti da non perdere');
  for (const [strada, prendi] of Object.entries(STRADE)) {
    esiti.length = 0;
    await alClic(p, `const w = await ${prendi}; const s = await w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, ${VINCOLI['solo-audio']}); return s.getTracks().length;`);
    await scegliLoSchermo(strada);
    await expect.poll(() => esiti.slice(), { timeout: 10_000, message: strada }).toEqual(['NotAllowedError']);
  }
  await restaLaPagina(p);
});

const NOMI = ['camera', 'microphone', 'geolocation', 'notifications'];
// Lo stato letto dalla pagina, dal riquadro vuoto e con la funzione del riquadro sui permessi della pagina.
const leggi = (p) => p.evaluate(async (nomi) => {
  const w = (() => { document.body.appendChild(document.createElement('iframe')); return window[window.length - 1]; })();
  const giro = (f) => Promise.all(nomi.map((n) => f(n).then((s) => n + '=' + s.state, (e) => n + '=!' + e.name))).then((r) => r.join(','));
  return {
    pagina: await giro((n) => navigator.permissions.query({ name: n })) + ',Notification=' + Notification.permission,
    riquadro: await giro((n) => w.navigator.permissions.query({ name: n })) + ',Notification=' + w.Notification.permission,
    misto: await giro((n) => w.Permissions.prototype.query.call(navigator.permissions, { name: n })),
  };
}, NOMI);

test('fotocamera, microfono, posizione e notifiche mai decisi si leggono «da chiedere», nella pagina e nel riquadro vuoto preso per indice', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  const attesi = 'camera=prompt,microphone=prompt,geolocation=prompt,notifications=prompt';
  expect(await leggi(p)).toEqual({ pagina: `${attesi},Notification=default`, riquadro: `${attesi},Notification=default`, misto: attesi });
});

// Un sito che controlla se le funzioni della pagina sono state toccate le vede di fabbrica, anche nel riquadro (#799).
test('le funzioni sistemate nella pagina e nel riquadro vuoto si presentano come quelle di fabbrica', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  const strane = await p.evaluate((vuoto) => {
    const w = eval(vuoto);
    const D = Object.getOwnPropertyDescriptor;
    const out = [];
    for (const win of [window, w]) {
      const fs = {
        appendChild: win.Node.prototype.appendChild,
        getUserMedia: win.MediaDevices.prototype.getUserMedia,
        query: win.Permissions.prototype.query,
        requestPermission: win.Notification.requestPermission,
        'get contentWindow': D(win.HTMLIFrameElement.prototype, 'contentWindow').get,
        'set innerHTML': D(win.Element.prototype, 'innerHTML').set,
        'get permission': D(win.Notification, 'permission').get,
        toString: win.Function.prototype.toString,
      };
      for (const [nome, f] of Object.entries(fs)) {
        const testo = Function.prototype.toString.call(f) + ' | ' + win.Function.prototype.toString.call(f);
        if (testo !== `function ${nome}() { [native code] } | function ${nome}() { [native code] }` || 'prototype' in f) out.push(nome + ': ' + testo);
      }
    }
    return out;
  }, VUOTO);
  expect(strane).toEqual([]);
});

test('dopo Consenti al microfono e Non consentire alla fotocamera, pagina e riquadro vuoto leggono le risposte date', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  await alClic(p, `const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return 'microfono';`);
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['microfono']);
  // La fotocamera chiesta dal riquadro vuoto passa dalla stessa domanda della pagina.
  await alClic(p, `const w = ${VUOTO}; await w.navigator.mediaDevices.getUserMedia({ video: true }); return 'fotocamera';`);
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['microfono', 'NotAllowedError']);
  const attesi = 'camera=denied,microphone=granted,geolocation=prompt,notifications=prompt';
  expect(await leggi(p)).toEqual({ pagina: `${attesi},Notification=default`, riquadro: `${attesi},Notification=default`, misto: attesi });
});

test('le notifiche chieste dal riquadro vuoto dopo un clic passano dalla domanda di Filo col nome del sito', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  await alClic(p, `const w = ${VUOTO}; return 'notifiche:' + (await w.Notification.requestPermission()) + '/' + w.Notification.permission;`);
  await expect(barra()).toContainText('vuole mandarti notifiche', { timeout: 10_000 });
  await expect(barra()).toContainText(new URL(origine).host);
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['notifiche:granted/granted']);
  expect((await leggi(p)).riquadro).toContain('notifications=granted,Notification=granted');
});

// Vincoli che cambiano fra la lettura di Filo e quella di Chromium: la prima innocua, la seconda la strada vecchia.
const CAMBIA = `(() => { let n = 0; return { get mandatory() { n++; return n < 2 ? {} : { chromeMediaSource: 'desktop' }; } }; })()`;
const PROXY = `(() => { let n = 0; return new Proxy({ video: false }, { get(t, k) { if (k === 'audio') { n++; return n < 2 ? true : { mandatory: { chromeMediaSource: 'desktop' } }; } return t[k]; } }); })()`;
test('vincoli che cambiano a ogni lettura non fanno morire la scheda, dalla pagina né dal riquadro vuoto: al sito arriva un no', async () => {
  test.setTimeout(150_000);
  const p = await apri();
  await p.locator('#nota').fill('appunti da non perdere');
  const casi = {
    'riquadro, solo audio': `w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, { audio: ${CAMBIA}, video: false })`,
    'riquadro, Proxy': `w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, ${PROXY})`,
    'riquadro, la sua funzione': `w.navigator.mediaDevices.getUserMedia({ audio: ${CAMBIA}, video: false })`,
    'riquadro, a callback': `new Promise((ok, no) => w.navigator.webkitGetUserMedia({ audio: ${CAMBIA}, video: false }, ok, no))`,
    'pagina, solo audio': `navigator.mediaDevices.getUserMedia({ audio: ${CAMBIA}, video: false })`,
    'pagina, microfono e schermo': `navigator.mediaDevices.getUserMedia({ audio: true, video: ${CAMBIA} })`,
  };
  for (const [nome, chiamata] of Object.entries(casi)) {
    esiti.length = 0;
    await alClic(p, `const w = ${VUOTO}; const s = await ${chiamata}; return s.getTracks().map((t) => t.kind).join(',');`);
    await scegliLoSchermo(nome);
    await expect.poll(() => esiti.slice(), { timeout: 10_000, message: nome }).toEqual(['NotAllowedError']);
  }
  await restaLaPagina(p);
});

// La copia dei vincoli che Filo passa a Chromium tiene anche quelli scritti come getter di una classe.
test('vincoli normali dati da un oggetto con getter arrivano interi: il microfono passa dalla domanda e funziona', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  await alClic(p, `class Vincoli { get audio() { return { echoCancellation: true }; } get video() { return false; } }
    const s = await navigator.mediaDevices.getUserMedia(new Vincoli()); return s.getTracks().map((t) => t.kind).join(',');`);
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['audio']);
});

test('la finestra vuota che la pagina apre legge «da chiedere» e il microfono chiesto da lì passa dalla domanda di Filo', async () => {
  test.setTimeout(60_000);
  const p = await apri();
  await alClic(p, `const w = window.open('', '_blank', 'width=200,height=200'); const o = [];
    for (const n of ['camera', 'microphone', 'geolocation']) o.push(n + '=' + (await w.navigator.permissions.query({ name: n })).state);
    m(o.join(' ')); const s = await w.navigator.mediaDevices.getUserMedia({ audio: true }); return s.getTracks().map((t) => t.kind).join(',');`);
  await expect.poll(() => esiti.slice(0, 1), { timeout: 10_000 }).toEqual(['camera=prompt microphone=prompt geolocation=prompt']);
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
  await expect(barra()).toContainText(new URL(origine).host);
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['audio']);
});
