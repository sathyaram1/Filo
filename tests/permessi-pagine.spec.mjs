// Permessi delle pagine web (#591.1): microfono, fotocamera e appunti li decide l'utente nella cornice della finestra,
// non la pagina. Regole: src/main/services/permessiPagine.js. Dispositivi finti: nessuna periferica vera coinvolta.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, cartellaInCasa } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { nelMondoDiFilo } from './helpers/riquadri.mjs';

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
// Un sito che chiede il microfono appena si apre, con un campo dove dettare (#586).
PAGINE['/detta'] = `<!doctype html><meta charset="utf-8"><title>Modulo</title><textarea id="campo" style="width:300px;height:60px"></textarea><script>
  window.__prova = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  window.__prova();
</script>`;
// Condividere lo schermo dopo un clic, e la strada vecchia che lo prenderebbe senza scelta (#586).
PAGINE['/schermo'] = `<!doctype html><meta charset="utf-8"><title>Riunione</title>
<button id="b" style="position:fixed;top:200px;left:200px">Presenta</button>
<button id="v" style="position:fixed;top:260px;left:200px">Presenta alla vecchia</button>
<input id="nota" style="position:fixed;top:320px;left:200px">
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('b').addEventListener('click', () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
    (s) => m('schermo:' + s.getTracks().map((t) => t.kind).sort().join(',')), (e) => m('schermo:' + e.name)));
  document.getElementById('v').addEventListener('click', () => navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop' } },
  }).then((s) => m('vecchia:' + s.getTracks().map((t) => t.kind).sort().join(',')), (e) => m('vecchia:' + e.name)));
</script>`;
// Una chiamata che accende il microfono e poi lo spegne restando nella stessa pagina (#586).
PAGINE['/chiamata'] = `<!doctype html><meta charset="utf-8"><title>Chiamata</title>
<button id="mic" style="position:fixed;top:200px;left:200px">Microfono</button>
<button id="stop" style="position:fixed;top:260px;left:200px">Chiudi la chiamata</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  let flussi = [];
  document.getElementById('mic').addEventListener('click', () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { flussi.push(s); m('mic:ok'); }, (e) => m('mic:' + e.name)));
  document.getElementById('stop').addEventListener('click', () => {
    flussi.forEach((s) => s.getTracks().forEach((t) => t.stop())); flussi = []; m('fermato');
  });
</script>`;
// Un giornale che chiede le notifiche, con dentro il riquadro di un altro sito che le chiede anche lui (#586).
const ospite = (altro) => `<!doctype html><meta charset="utf-8"><title>Giornale</title>
<button id="attiva" style="position:fixed;top:20px;left:200px">Attiva le notifiche</button>
<iframe id="r" src="${altro}/riquadro-notifiche" style="position:fixed;top:120px;left:200px;width:300px;height:120px"></iframe>
<script>${NOTIFICA} document.getElementById('attiva').addEventListener('click', chiedi);</script>`;
PAGINE['/riquadro-notifiche'] = `<!doctype html><meta charset="utf-8"><button id="chiedi">Avvisami</button><script>
  document.getElementById('chiedi').addEventListener('click', () => Notification.requestPermission().then(
    (x) => fetch('/esito?m=' + encodeURIComponent('riquadro:' + x + '/' + Notification.permission))));
</script>`;
// Un widget di videochiamata di un altro sito, incorporato col permesso di chiedere lo schermo (#586).
const conWidget = (altro) => `<!doctype html><meta charset="utf-8"><title>Assistenza</title>
<iframe id="r" allow="display-capture" src="${altro}/widget" style="position:fixed;top:120px;left:200px;width:300px;height:120px"></iframe>`;
PAGINE['/widget'] = `<!doctype html><meta charset="utf-8"><button id="w">Condividi lo schermo</button><script>
  document.getElementById('w').addEventListener('click', () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('widget:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('widget:' + e.name))));
</script>`;
// Una riunione con dentro un riquadro di un altro sito che prova lo schermo alla maniera vecchia appena si carica, senza il
// permesso di chiederlo, e poi ne finge di continuo l'avviso: la presentazione della riunione non ne risente (#586).
const conRiquadroVecchio = (altro) => PAGINE['/schermo']
  + `<iframe src="${altro}/riquadro-vecchio" style="position:fixed;top:400px;left:200px;width:300px;height:60px"></iframe>`;
PAGINE['/riquadro-vecchio'] = `<!doctype html><meta charset="utf-8"><p>pubblicità</p><script>
  navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }).then(
    () => fetch('/esito?m=riquadro:ok'), (e) => fetch('/esito?m=' + encodeURIComponent('riquadro:' + e.name)));
  setInterval(() => window.dispatchEvent(new Event('filo:schermo-vecchio')), 300);
</script>`;
// Una videochiamata: microfono, fotocamera e schermo (#586, i segni sulla scheda).
PAGINE['/videochiamata'] = `<!doctype html><meta charset="utf-8"><title>Riunione</title>
<button id="mic" style="position:fixed;top:120px;left:200px">Microfono</button>
<button id="cam" style="position:fixed;top:170px;left:200px">Fotocamera</button>
<button id="b" style="position:fixed;top:220px;left:200px">Presenta</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('mic').addEventListener('click', () => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => m('mic:ok'), (e) => m('mic:' + e.name)));
  document.getElementById('cam').addEventListener('click', () => navigator.mediaDevices.getUserMedia({ video: true }).then(() => m('cam:ok'), (e) => m('cam:' + e.name)));
  document.getElementById('b').addEventListener('click', () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    () => m('schermo:ok'), (e) => m('schermo:' + e.name)));
</script>`;
// Indirizzo lungo: la parte davanti la sceglie chi registra il sito, il dominio vero sta in fondo.
const LUNGO = 'videochiamata.sessione-sicura-verifica-account-utente-accesso-autorizzato'
  + '.conferma-identita-riunione-video-chiamata-partecipante.dominio-vero.test';

// Una pagina che si riscrive in un documento blob suo: resta il sito che l'ha creato (#591, giro 20).
const inBlob = (corpo) => '<!doctype html><meta charset="utf-8"><title>Offerta</title><p>attendi</p><script>'
  + 'const html = "<!doctype html><title>Offerta</title><p>ok</p><script>"'
  + ' + "const m=(x)=>fetch(" + JSON.stringify(location.origin) + "+\\"/esito?m=\\"+encodeURIComponent(x));"'
  + ' + ' + JSON.stringify(corpo) + ' + "<" + "/script>";'
  + 'location.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));</script>';
PAGINE['/blob'] = inBlob('m("notifiche:"+Notification.permission);'
  + 'navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(()=>m("media:concesso"),(e)=>m("media:"+e.name));'
  + 'setTimeout(()=>navigator.clipboard.readText().then((x)=>m("appunti:"+x),(e)=>m("appunti:"+e.name)),300);'
  + 'setTimeout(()=>{const f=document.createElement("iframe");f.style.display="none";'
  + 'f.src="prova-filo-esterno:apri-un-programma";document.body.appendChild(f);},300);');
// Un gioco a clic col pulsante in alto a destra, dove comparirà Consenti: al primo clic chiede microfono e fotocamera.
PAGINE['/gioco'] = `<!doctype html><meta charset="utf-8"><title>Gioco</title>
<style>body{margin:0}#b{position:fixed;top:0;right:0;width:260px;height:60px}</style>
<button id="b">Clicca più veloce che puoi</button>
<script>
  let chiesto = false;
  document.getElementById('b').addEventListener('click', () => {
    if (chiesto) return; chiesto = true;
    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
      () => fetch('/esito?m=concesso'), (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  });
</script>`;
// Quello che Chrome chiede o concede dopo un clic: schermi, presenza, font del computer, spazio persistente.
const dopoUnClic = (azione) => `<!doctype html><meta charset="utf-8"><title>Prova</title>
<button id="b" style="position:fixed;top:200px;left:200px">Prova</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('b').addEventListener('click', () => { ${azione} });
</script>`;
PAGINE['/schermi'] = dopoUnClic("window.getScreenDetails().then(() => m('schermi:letti'), (e) => m('schermi:' + e.name));");
PAGINE['/presenza'] = dopoUnClic("IdleDetector.requestPermission().then((x) => m('presenza:' + x), (e) => m('presenza:' + e.name));");
PAGINE['/font'] = dopoUnClic("window.queryLocalFonts().then((f) => m('font:' + (f.length ? 'letti' : 'vuoti')), (e) => m('font:' + e.name));");
// Una pagina qualsiasi che legge l'elenco dei dispositivi: i nomi (uguali in ogni sito) arrivano solo col sì (#1524).
PAGINE['/dispositivi'] = `<!doctype html><meta charset="utf-8"><title>Dispositivi</title>
<button id="b" style="position:fixed;top:200px;left:200px">Microfono</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  const nomi = () => navigator.mediaDevices.enumerateDevices().then((l) => [...new Set(l.filter((d) => d.label).map((d) => d.kind))].sort().join(',') || 'nessuno');
  const stato = (name) => navigator.permissions.query({ name }).then((s) => s.state, (e) => e.name);
  Promise.all([nomi(), stato('microphone'), stato('midi')]).then(([n, mic, midi]) => m('prima:' + n + '/' + mic + '/' + midi));
  document.getElementById('b').addEventListener('click', () => navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => { s.getTracks().forEach((t) => t.stop()); return nomi().then((n) => m('dopo:' + n)); }, (e) => m('mic:' + e.name)));
</script>`;
PAGINE['/spazio'] = dopoUnClic("navigator.storage.persist().then((x) => m('spazio:' + x), (e) => m('spazio:' + e.name));");
// Un sito che carica foto (#1069): l'utente gli dà la cartella da leggere, e al clic su «Carica» il sito prova a scriverci.
PAGINE['/cartella'] = `<!doctype html><meta charset="utf-8"><title>Carica foto</title>
<style>body{margin:0}#zona{position:fixed;inset:0}#carica{position:fixed;top:200px;left:200px;z-index:1}</style>
<div id="zona">trascina qui la cartella</div><button id="carica">Carica</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  let cartella = null;
  const zona = document.getElementById('zona');
  zona.addEventListener('dragover', (e) => e.preventDefault());
  zona.addEventListener('drop', async (e) => {
    e.preventDefault();
    try {
      cartella = await e.dataTransfer.items[0].getAsFileSystemHandle();
      m('cartella:' + cartella.kind + ':' + (await cartella.queryPermission({ mode: 'read' })) + '/' + (await cartella.queryPermission({ mode: 'readwrite' })));
    } catch (err) { m('cartella:' + err.name); }
  });
  document.getElementById('carica').addEventListener('click', async () => {
    const x = await cartella.requestPermission({ mode: 'readwrite' }).catch((err) => err.name);
    m('scrittura:' + x);
    if (x !== 'granted') return;
    try {
      const f = await cartella.getFileHandle('lasciato.txt', { create: true });
      const w = await f.createWritable();
      await w.write('cifrato');
      await w.close();
      m('scritto');
    } catch (err) { m('scritto:' + err.name); }
  });
</script>`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 20_000); t.unref?.(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/ospite') { res.end(ospite(`http://${LUNGO}:${server.address().port}`)); return; }
    if (u.pathname === '/con-widget') { res.end(conWidget(`http://${LUNGO}:${server.address().port}`)); return; }
    if (u.pathname === '/con-riquadro-vecchio') { res.end(conRiquadroVecchio(`http://${LUNGO}:${server.address().port}`)); return; }
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
  await avvia();
});

async function avvia() {
  const porta = new URL(origine).port;
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', `--host-resolver-rules=MAP ${LUNGO} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${LUNGO}:${porta}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, PATH: join(userData, 'bin-finto') + delimiter + process.env.PATH, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
}
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

test('appunti: la pagina non legge quello che hai copiato senza un sì; Incolla di Filo incolla lo stesso, e il sito resta senza', async () => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('parola-segreta'));
  await apri('/appunti');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole leggere quello che hai copiato');
  expect(esiti).toEqual([]);
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);

  // Incolla di Filo nel campo del sito: gli appunti li legge il main, la pagina non riceve il permesso (#586).
  const pagina = paginaDi(origine);
  await pagina.locator('input').click({ button: 'right' });
  await pagina.keyboard.press('Escape');
  await nelMondoDiFilo(app, pagina, () => globalThis.SN_ACTIONS.pasteFromClipboard());
  await expect.poll(() => pagina.evaluate(() => document.querySelector('input').value), { timeout: 10_000 }).toBe('parola-segreta');
  await pagina.evaluate(() => window.__prova());
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1], 'subito dopo Incolla il sito non legge gli appunti').toBe('negato:NotAllowedError');
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
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['notifiche:default', 'notifiche:granted']);
});

test('un\'app di messaggi legge le notifiche «da chiedere», offre il suo pulsante e col sì le riceve', async () => {
  test.setTimeout(60_000);
  await apri('/messaggi');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt']);
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/messaggi'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.locator('#attiva').click();
  await expect(barra()).toContainText('vuole mandarti notifiche', { timeout: 10_000 });
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 5_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt', 'notifiche:granted/granted']);
});

test('col no dell\'utente l\'app di messaggi legge le notifiche bloccate, anche dopo aver ricaricato', async () => {
  test.setTimeout(60_000);
  await apri('/messaggi');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt']);
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/messaggi'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.locator('#attiva').click();
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt', 'notifiche:denied/denied']);
  await pagina.reload();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt', 'notifiche:denied/denied', 'stato:denied/denied']);
});

test('lo schermo acceso, come la modalità cucina di un sito di ricette, passa dopo un clic senza domande', async () => {
  test.setTimeout(60_000);
  await apri('/ricetta');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/ricetta'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#cucina').click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['schermo:acceso']);
  await expect(barra()).toBeHidden();
});

test('una pagina non apre un\'altra applicazione da un riquadro invisibile, senza un clic', async () => {
  test.skip(process.platform !== 'linux', 'l\'apertura si osserva sostituendo xdg-open');
  test.setTimeout(60_000);
  await apri('/esterno');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['riquadro']);
  await new Promise((ok) => setTimeout(ok, 3000));
  expect(existsSync(aperti) ? readFileSync(aperti, 'utf8').trim() : '').toBe('');
});

test('Detta su un sito a cui hai negato il microfono: il testo arriva, e il sito il microfono non lo riceve', async () => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.__dettate = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      globalThis.__dettate++;
      return { text: ` frase ${globalThis.__dettate} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null };
    };
  });
  await apri('/detta');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['negato:NotAllowedError']);
  // Il no si vede sulla scheda.
  await expect(shell.locator('.tab .tab-permessi .segno.negato[data-parte="audio"]')).toBeVisible({ timeout: 5_000 });

  // Microfono finto nella cornice, dove Filo ascolta: un tono acceso e spento a comando.
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__micFinto = { gain };
      return dest.stream;
    };
  });
  const pagina = paginaDi(origine);
  await pagina.locator('#campo').click({ button: 'right' });
  await pagina.keyboard.press('Escape');
  await nelMondoDiFilo(app, pagina, () => globalThis.SN_TTS.startDictation());
  await expect.poll(() => shell.evaluate(() => Boolean(window.__micFinto)), { timeout: 10_000 }).toBe(true);
  // Mentre Filo ascolta, il sito chiede il microfono: resta no, senza domanda.
  await pagina.evaluate(() => window.__prova());
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('negato:NotAllowedError');
  await pagina.waitForTimeout(1800);
  await shell.evaluate(() => { window.__micFinto.gain.gain.value = 0; });
  await expect.poll(() => pagina.evaluate(() => document.querySelector('#campo').value), { timeout: 15_000 }).toMatch(/frase \d+/);
  await nelMondoDiFilo(app, pagina, () => globalThis.SN_TTS.stopDictation());
  await expect(barra()).toBeHidden();
});

test('condividere lo schermo: dopo un clic la cornice chiede cosa mostrare, la scelta arriva al sito e la volta dopo si richiede', async () => {
  test.setTimeout(60_000);
  await apri('/schermo');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#b').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole vedere il tuo schermo');
  const fonti = barra().locator('.permesso-fonte');
  await expect(fonti.first()).toBeVisible();
  await expect(barra().locator('.permesso-fonte[data-tipo="schermo"]')).toHaveCount(1);
  await expect(barra().locator('.permesso-fonte', { hasText: 'Questa scheda' })).toHaveCount(1);
  expect(esiti, 'il sito aspetta la scelta').toEqual([]);
  await shell.screenshot({ path: 'tests/.shots/586-schermo-scelta.png' });
  await barra().locator('.permesso-fonte[data-tipo="schermo"]').click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['schermo:video']);
  await expect(barra()).toBeHidden();
  await expect(shell.locator('.tab .tab-permessi .segno[data-parte="schermo"]')).toBeVisible({ timeout: 5_000 });
  await shell.screenshot({ path: 'tests/.shots/586-schermo-segno.png' });

  // Una scheda di Filo si può mostrare da sola.
  await pagina.locator('#b').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().locator('.permesso-fonte', { hasText: 'Questa scheda' }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['schermo:video', 'schermo:video']);

  await pagina.locator('#b').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['schermo:video', 'schermo:video', 'schermo:NotAllowedError']);
});

// Scelta dell'owner (#586, A): il segno dice cosa il sito ha avuto in questa pagina, e nessun sito lo può spegnere.
test('il segno sulla scheda dice che il sito ha avuto il microfono in questa pagina: resta dopo la chiamata e se ne va cambiando pagina', async () => {
  test.setTimeout(60_000);
  await apri('/chiamata');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('load');
  await pagina.locator('#mic').click();
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['mic:ok']);
  const segni = shell.locator('.tab .tab-permessi');
  const segno = segni.locator('.segno[data-parte="audio"]');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await expect(segni).toHaveAttribute('data-tip', 'Ha avuto il microfono in questa pagina');
  await pagina.locator('#stop').click();
  await expect.poll(() => esiti.includes('fermato'), { timeout: 5_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1000));
  await expect(segno, 'la pagina non spegne il segno').toBeVisible();
  await expect(segni).toHaveAttribute('data-tip', 'Ha avuto il microfono in questa pagina');
  await pagina.evaluate((u) => { location.href = u; }, origine + '/vuota');
  await expect(segno, 'una pagina nuova riparte da zero').toHaveCount(0, { timeout: 10_000 });
});

test('la strada vecchia per lo schermo (chromeMediaSource) non dà al sito né lo schermo né l\'audio del computer', async () => {
  test.setTimeout(60_000);
  await apri('/schermo');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#nota').fill('appunti della riunione');
  await pagina.locator('#v').click();
  // Chi la usa vede la stessa domanda; anche scegliendo lo schermo, al sito non arriva niente e la pagina resta (#586).
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
  await expect(fonte).toBeEnabled({ timeout: 5_000 });
  await fonte.click();
  await expect(barra()).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['vecchia:NotAllowedError']);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await paginaDi(origine).evaluate(() => document.querySelector('#nota').value)).toBe('appunti della riunione');
  await expect(shell.locator('.tab .tab-permessi .segno[data-parte="schermo"]')).toHaveCount(0);
});

// Come un widget di videochiamata incorporato: il clic dentro il riquadro di un altro sito vale per chi lo ha ricevuto (#586).
test('un widget incorporato di un altro sito chiede lo schermo dopo un clic al suo interno: la cornice chiede e la scelta arriva', async () => {
  test.setTimeout(60_000);
  await apri('/con-widget');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('load');
  await pagina.frameLocator('#r').locator('#w').click();
  await expect(barra()).toContainText('vuole vedere il tuo schermo', { timeout: 10_000 });
  const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
  await expect(fonte).toBeEnabled({ timeout: 5_000 });
  await fonte.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['widget:video']);
});

test('un riquadro di un altro sito che usa o finge la strada vecchia non fa fallire la presentazione della pagina', async () => {
  test.setTimeout(60_000);
  await apri('/con-riquadro-vecchio');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('load');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['riquadro:NotAllowedError']);
  await pagina.locator('#b').click();
  const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
  await expect(fonte).toBeEnabled({ timeout: 10_000 });
  await fonte.click();
  await expect.poll(() => esiti.filter((x) => x.startsWith('schermo:')), { timeout: 10_000 }).toEqual(['schermo:video']);
});

test('i segni sulla scheda di una videochiamata non si mangiano il titolo: con posto stanno tutti, con la fila piena resta il primo', async () => {
  test.setTimeout(90_000);
  await apri('/videochiamata');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('load');
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  for (const [b, atteso] of [['#mic', 'mic:ok'], ['#cam', 'cam:ok']]) {
    await pagina.locator(b).click();
    await expect(si).toBeEnabled({ timeout: 10_000 });
    await si.click();
    await expect.poll(() => esiti.includes(atteso), { timeout: 10_000 }).toBe(true);
  }
  await pagina.locator('#b').click();
  const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
  await expect(fonte).toBeEnabled({ timeout: 10_000 });
  await fonte.click();
  await expect.poll(() => esiti.includes('schermo:ok'), { timeout: 10_000 }).toBe(true);
  const scheda = shell.locator('.tab', { has: shell.locator('.tab-permessi .segno') });
  const visti = () => scheda.locator('.tab-permessi .segno:visible');
  const titolo = () => scheda.locator('.title').evaluate((t) => ({ w: t.getBoundingClientRect().width, intero: t.scrollWidth <= t.clientWidth }));
  await expect(visti()).toHaveCount(3, { timeout: 5_000 });
  await expect.poll(async () => (await titolo()).intero, { timeout: 5_000, message: 'con la fila libera «Riunione» si legge intero' }).toBe(true);
  for (let i = 0; i < 6; i++) await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/vuota?' + i);
  await expect(shell.locator('.tab')).toHaveCount(8, { timeout: 10_000 });
  await expect(visti(), 'con la fila piena resta un segno, il più delicato').toHaveCount(1, { timeout: 5_000 });
  await expect(visti().first()).toHaveAttribute('data-parte', 'schermo');
  for (const cosa of ['il tuo schermo', 'la fotocamera', 'il microfono']) {
    await expect(scheda.locator('.tab-permessi'), 'la frase li dice tutti').toHaveAttribute('data-tip', new RegExp(cosa));
  }
  const altra = shell.locator('.tab:not(.active)', { hasNot: shell.locator('.tab-permessi .segno') }).nth(1);
  const loro = await altra.locator('.title').evaluate((t) => t.getBoundingClientRect().width);
  const mio = (await titolo()).w;
  expect(mio, `il titolo della chiamata (${mio}px) almeno metà di quello delle altre (${loro}px)`).toBeGreaterThanOrEqual(loro / 2);
});

test('il riquadro di un altro sito non chiede le notifiche col nome del giornale e non ne eredita il sì', async () => {
  test.setTimeout(60_000);
  await apri('/ospite');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const pagina = paginaDi(origine);
  await pagina.waitForLoadState('load');
  await pagina.locator('#attiva').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole mandarti notifiche');
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['notifiche:granted']);

  await pagina.frameLocator('#r').locator('#chiedi').click();
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
  expect(esiti[1]).toBe('riquadro:denied/denied');
  await expect(barra()).toBeHidden();
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

// Filo sono solo le sue pagine: un sito che si riscrive in un documento blob chiede come il sito (#591, giro 20).
test('una pagina che si riscrive in un documento blob non ottiene niente senza domanda', async () => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-copiata'));
  await apri('/blob');
  // Quale domanda arriva prima dipende da quanto ci mette la fotocamera ad accendersi (nel contenitore delle routine oltre
  // sei secondi): conta che il sito chieda col suo nome.
  await expect(barra()).toContainText(/microfono e fotocamera|quello che hai copiato/, { timeout: 10_000 });
  await expect(barra().locator('strong')).toHaveText(new URL(origine).host);
  await new Promise((ok) => setTimeout(ok, 2500));
  expect(esiti).toContain('notifiche:default');
  expect(esiti).not.toContain('media:concesso');
  expect(esiti).not.toContain('appunti:password-copiata');
  expect(existsSync(aperti) ? readFileSync(aperti, 'utf8').trim() : '').toBe('');
});

// Consenti vale per un clic dopo una pausa: una raffica che continua lo tiene spento (#591, giro 20).
test('una raffica di clic sul punto dove compare Consenti non concede; un clic dopo una pausa sì', async () => {
  test.setTimeout(60_000);
  await apri('/gioco');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/gioco'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#b').click();
  const si = barra().locator('.permesso-si');
  await expect(si).toBeVisible({ timeout: 10_000 });
  const box = await si.boundingBox();
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((ok) => setTimeout(ok, 200));
  }
  await new Promise((ok) => setTimeout(ok, 500));
  expect(esiti, 'concesso da un clic della raffica').toEqual([]);
  await expect(si).toBeEnabled({ timeout: 5_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso']);
});

// Le risposte restano dopo la chiusura, come in Chrome, e la pagina Sicurezza le elenca tutte (#591, giro 20).
test('le risposte date restano dopo aver riaperto Filo, e dalla pagina Sicurezza si vedono e si tolgono', async () => {
  test.setTimeout(120_000);
  await apri('/messaggi');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/messaggi'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt']);
  await pagina.locator('#attiva').click();
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt', 'notifiche:granted/granted']);
  await apri('/microfono');
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.includes('concesso:audio'), { timeout: 10_000 }).toBe(true);
  await chiudiApp(app);

  esiti.length = 0;
  await avvia();
  await apri('/messaggi');
  await expect.poll(() => esiti.some((x) => x.startsWith('stato:')), { timeout: 15_000 }).toBe(true);
  expect(esiti.filter((x) => x.startsWith('stato:')).every((x) => x === 'stato:granted/granted'), JSON.stringify(esiti)).toBe(true);
  await apri('/microfono');
  await expect.poll(() => esiti.includes('concesso:audio'), { timeout: 10_000 }).toBe(true);
  await expect(barra()).toBeHidden();

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sicurezza = null;
  await expect.poll(() => { sicurezza = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sicurezza); }, { timeout: 10_000 }).toBe(true);
  const righe = sicurezza.locator('#sec-perm-list li');
  await expect(righe).toHaveCount(2, { timeout: 10_000 });
  await expect(righe.filter({ hasText: 'Notifiche: consentito' })).toContainText('127.0.0.1');
  await expect(righe.filter({ hasText: 'Microfono: consentito' })).toHaveCount(1);
  await righe.filter({ hasText: 'Microfono' }).getByRole('button', { name: 'Togli' }).click();
  await expect(righe).toHaveCount(1);
  await apri('/microfono');
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
});

// Quello che Chrome chiede si chiede, quello che concede passa: prima di #591 passava tutto, dopo il giro 19 niente.
for (const [via, dopo, domanda] of [
  ['/schermi', 'schermi:letti', 'vuole usare tutti i tuoi schermi'],
  ['/presenza', 'presenza:granted', 'vuole sapere quando sei al computer'],
  ['/spazio', 'spazio:true', null],
]) {
  test(`dopo un clic sulla pagina, ${via.slice(1)}: ${domanda ? 'Filo chiede e col sì la pagina funziona' : 'passa come in Chrome'}`, async () => {
    test.setTimeout(60_000);
    await apri(via);
    let pagina = null;
    await expect.poll(() => { pagina = paginaDi(origine + via); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
    await pagina.waitForLoadState('domcontentloaded');
    await pagina.locator('#b').click();
    if (domanda) {
      await expect(barra()).toContainText(domanda, { timeout: 10_000 });
      expect(esiti).toEqual([]);
      const si = barra().getByRole('button', { name: 'Consenti', exact: true });
      await expect(si).toBeEnabled({ timeout: 5_000 });
      await si.click();
    }
    await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual([dopo]);
    if (!domanda) await expect(barra()).toBeHidden();
  });
}

// L'elenco dei font installati rivela i programmi ed è uguale in ogni sito: Electron non lo fa chiedere, quindi niente (#1524).
test('i font del computer: dopo un clic sulla pagina il sito non legge l\'elenco, e nessuna domanda', async () => {
  test.setTimeout(60_000);
  await apri('/font');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/font'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#b').click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['font:vuoti']);
  await expect(barra()).toBeHidden();
});

test('i nomi di microfoni e uscite audio il sito li legge solo dopo Consenti al microfono; la fotocamera resta senza', async () => {
  test.setTimeout(60_000);
  await apri('/dispositivi');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['prima:nessuno/prompt/prompt']);
  await expect(barra()).toBeHidden();
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/dispositivi'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.locator('#b').click();
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 5_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['prima:nessuno/prompt/prompt', 'dopo:audioinput,audiooutput']);

  await pagina.reload();
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(3);
  expect(esiti[2], 'il sì ricordato vale alla pagina dopo').toBe('prima:audioinput,audiooutput/granted/prompt');
});

test('le risposte ricordate le legge e le toglie solo una pagina di Filo, non un sito visitato', async () => {
  const out = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const sito = { tab: { id: 1, url: 'https://evil.example/' }, url: 'https://evil.example/' };
    const filo = { url: 'filo://security/security.html' };
    return {
      leggeSito: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PERMESSI_SITI_GET }, sito),
      togliSito: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PERMESSI_SITI_TOGLI, origine: 'https://x.example', parte: 'audio' }, sito),
      leggeFilo: await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PERMESSI_SITI_GET }, filo),
    };
  });
  expect(out.leggeSito).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  expect(out.togliSito).toEqual({ ok: false, code: 'forbidden', error: 'forbidden' });
  expect(out.leggeFilo).toEqual({ ok: true, scelte: [] });
});

// La domanda per la rete locale arriva con Electron 44 (#1068): la cornice la dice con le sue parole, non con quelle
// del microfono, che sono quelle di ripiego per un tipo che non conosce.
test('un sito che chiede la rete locale si vede chiedere proprio quella, col suo nome', async () => {
  await apri('/vuota');
  await expect.poll(() => app.windows().some((w) => w.url().startsWith(origine)), { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.webContents.send('tabs:permesso', {
      id: 'prova-rete', tabId: w._filoTabs.activeId, host: 'router.example', sotto: '', dominio: 'router.example', tipo: 'rete', parti: ['rete'],
    });
  });
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('router.example');
  await expect(barra()).toContainText('vuole collegarsi agli apparecchi della tua rete');
  await expect(barra()).not.toContainText('microfono');
});

// #1069 — la cartella data da leggere non diventa scrivibile senza un sì. La si dà al sito trascinandola, come con il
// selettore: la lettura è concessa, la scrittura no. Il trascinamento è quello vero del sistema, via DevTools.
async function daiLaCartella() {
  await apri('/cartella');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/cartella'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  const lasciato = await trascina(pagina, 'foto da caricare');
  return { pagina, lasciato };
}

// Nella cartella personale: Chromium nasconde ai siti la cartella dei dati di Filo e quelle accanto, dove stanno le temporanee.
async function trascina(pagina, nome) {
  const dir = join(cartellaInCasa('filo-test-cartella-'), nome);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mare.jpg'), 'foto');
  const prima = esiti.length;
  const s = await pagina.context().newCDPSession(pagina);
  const data = { items: [], files: [dir], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 60, y: 60, data });
  await expect.poll(() => esiti.slice(prima), { timeout: 10_000 }).toEqual(['cartella:directory:granted/prompt']);
  return join(dir, 'lasciato.txt');
}

test('una cartella data da leggere: il sito che vuole scriverci lo chiede col nome della cartella, e con Consenti scrive', async () => {
  test.setTimeout(60_000);
  const { pagina, lasciato } = await daiLaCartella();
  await expect(barra()).toBeHidden();
  await pagina.locator('#carica').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText(new URL(origine).host);
  await expect(barra()).toContainText('vuole creare, modificare e cancellare file in «foto da caricare»');
  await new Promise((ok) => setTimeout(ok, 500));
  expect(esiti.slice(1), 'nessuna scrittura prima della risposta').toEqual([]);
  expect(existsSync(lasciato)).toBe(false);
  await shell.screenshot({ path: 'tests/.shots/permesso-cartella.png' });
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['scrittura:granted', 'scritto']);
  expect(readFileSync(lasciato, 'utf8')).toBe('cifrato');
  await expect(barra()).toBeHidden();
});

test('Non consentire: il sito non scrive nella cartella data da leggere, e per quel sito la domanda non torna', async () => {
  test.setTimeout(60_000);
  const { pagina, lasciato } = await daiLaCartella();
  await pagina.locator('#carica').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['scrittura:denied']);
  expect(existsSync(lasciato)).toBe(false);
  // Un'altra cartella dello stesso sito: il no ricordato vale anche lì, senza domanda.
  const altro = await trascina(pagina, 'documenti');
  await pagina.locator('#carica').click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 })
    .toEqual(['scrittura:denied', 'cartella:directory:granted/prompt', 'scrittura:denied']);
  await expect(barra()).toBeHidden();
  expect(existsSync(altro)).toBe(false);
});
