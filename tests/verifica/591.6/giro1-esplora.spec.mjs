// Verifica #591.6, giro 1: la copia nascosta muta e senza finestre anche a pagina caricata; i permessi tolti
// dall'incognito restano tolti; la pagina Sicurezza aperta si aggiorna da qualunque strada e da qualunque finestra.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const BIP = (() => {
  const n = 8000; const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(100 * Math.sin(i / 3));
  return 'data:audio/wav;base64,' + b.toString('base64');
})();

const esiti = [];
const PAGINE = {
  // Il finto avviso che aspetta di aver finito di caricare: allora chiede la stampa, apre l'avviso e suona.
  '/dopo-carico': `<!doctype html><meta charset="utf-8"><title>Avviso</title><p>Il tuo computer è infetto</p>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  m('inizio');
  addEventListener('load', () => {
    m('caricata');
    setTimeout(() => { const a = new Audio(${JSON.stringify(BIP)}); a.loop = true; a.play().then(() => m('allarme:suona'), (e) => m('allarme:' + e.name)); }, 100);
    setTimeout(() => { const u = new SpeechSynthesisUtterance('chiama il numero'); u.onstart = () => m('voce:parla'); u.onerror = (e) => m('voce:' + e.error); speechSynthesis.speak(u); }, 150);
    setTimeout(() => { m('notifica:' + Notification.permission); }, 200);
    setTimeout(() => { const t = performance.now(); alert('Il tuo computer è infetto, chiama il numero'); m('avviso:' + Math.round(performance.now() - t)); }, 400);
    setTimeout(() => { const t = performance.now(); window.print(); m('stampa:' + Math.round(performance.now() - t)); }, 700);
    setTimeout(() => { m('fine'); }, 1000);
  });
</script>`,
  '/microfono': `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>stanza</p>
<script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
</script>`,
};

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
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
async function avvia() {
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
}
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-5916-');
  await avvia();
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const barra = (s = shell) => s.locator('#permesso-bar');
const paginaDi = (pred) => app.windows().find((w) => pred(w.url()));
async function aspettaPagina(pred, perche) {
  await expect.poll(() => Boolean(paginaDi(pred)), { timeout: 15_000, message: perche }).toBe(true);
  const p = paginaDi(pred);
  await p.waitForLoadState('domcontentloaded');
  return p;
}
const fotoSchermo = (nome) => {
  try { execFileSync('import', ['-window', 'root', join(SHOTS, nome)], { env: process.env, timeout: 10_000 }); } catch (e) { console.log('foto non riuscita', e.message); }
};

async function consentiMicrofono() {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toContain('concesso:audio');
}

for (const via of ['destinazione', 'detonate']) {
  test(`esplora: copia nascosta a pagina caricata (${via})`, async () => {
    test.setTimeout(60_000);
    app.on('window', (p) => p.on('dialog', () => {}));
    const finito = app.evaluate(async (_e, [u, v]) => {
      const S = globalThis.SN_SAFEBROWSE.sandbox;
      // Per detonate: la destinazione finale «lenta» tiene viva la copia dopo il caricamento.
      const r = v === 'destinazione' ? await S.destinazione(u, () => true) : await S.detonate(u + '?x', () => new Promise((ok) => setTimeout(() => ok(null), 3000)));
      return JSON.stringify(r);
    }, [origine + '/dopo-carico', via]);
    await new Promise((ok) => setTimeout(ok, 2000));
    fotoSchermo(`5916-${via}-durante.png`);
    console.log('RISULTATO', via, await finito);
    console.log('ESITI', via, JSON.stringify(esiti));
    fotoSchermo(`5916-${via}-dopo.png`);
    expect(esiti).toContain('fine');
  });
}

test('esplora: tolto dalla pagina Sicurezza in incognito, alla riapertura resta tolto', async () => {
  test.setTimeout(90_000);
  await consentiMicrofono();
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await aspettaPagina((u) => u.startsWith('filo://shell/shell.html?incognito=1'), 'incognito');
  await inc.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const sec = await aspettaPagina((u) => u.startsWith('filo://security'), 'sicurezza in incognito');
  const riga = sec.locator('#sec-perm-list li', { hasText: 'Microfono' });
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await riga.getByRole('button', { name: 'Togli' }).click();
  await expect(sec.locator('#sec-perm-list')).toContainText('Nessuna risposta data a un sito', { timeout: 10_000 });
  await chiudiApp(app);
  esiti.length = 0;
  await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await expect(barra(), 'il sito torna a chiedere').toBeVisible({ timeout: 10_000 });
  expect(esiti).toEqual([]);
});

test('esplora: tolto dalla chat di una finestra in incognito, alla riapertura resta tolto', async () => {
  test.setTimeout(90_000);
  await consentiMicrofono();
  const r = await app.evaluate(async (_e, root) => {
    const S = process.mainModule.require(root + '/src/main/shim/storage.js');
    const P = process.mainModule.require(root + '/src/main/services/permessiPagine.js');
    return S.runIncognito(async () => P.togliPerChat('127.0.0.1', 'microfono'));
  }, APP_ROOT);
  console.log('CHAT', JSON.stringify(r));
  await chiudiApp(app);
  esiti.length = 0;
  await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await expect(barra(), 'il sito torna a chiedere').toBeVisible({ timeout: 10_000 });
});

test('esplora: la pagina Sicurezza aperta in incognito vede la risposta data nella finestra normale, e quella tolta dalla chat', async () => {
  test.setTimeout(90_000);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await aspettaPagina((u) => u.startsWith('filo://shell/shell.html?incognito=1'), 'incognito');
  await inc.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const sec = await aspettaPagina((u) => u.startsWith('filo://security'), 'sicurezza in incognito');
  await expect(sec.locator('#sec-perm-list')).toContainText('Nessuna risposta data a un sito', { timeout: 10_000 });
  await consentiMicrofono();
  await expect(sec.locator('#sec-perm-list li', { hasText: 'Microfono' })).toBeVisible({ timeout: 10_000 });
  await togliDallaChat();
  await expect(sec.locator('#sec-perm-list')).toContainText('Nessuna risposta data a un sito', { timeout: 10_000 });
});

test('esplora: pagina Sicurezza in una scheda dietro, risposta nella scheda davanti, poi si torna', async () => {
  test.setTimeout(90_000);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const sec = await aspettaPagina((u) => u.startsWith('filo://security'), 'sicurezza');
  await expect(sec.locator('#sec-perm-list')).toContainText('Nessuna risposta data a un sito', { timeout: 10_000 });
  await consentiMicrofono();
  await shell.locator('#tabs .tab', { hasText: /Sicurezza/i }).first().click();
  await expect(sec.locator('#sec-perm-list li', { hasText: 'Microfono' })).toBeVisible({ timeout: 10_000 });
  await app.evaluate(async () => process.mainModule.require('./services/permessiPagine').togliPerChat('127.0.0.1', 'microfono'));
  await expect(sec.locator('#sec-perm-list')).toContainText('Nessuna risposta data a un sito', { timeout: 10_000 });
});
