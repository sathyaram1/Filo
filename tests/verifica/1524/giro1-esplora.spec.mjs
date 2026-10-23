// Esplorazione della verifica #1524: MIDI senza sysex, riquadri di altri siti e l'elenco dei dispositivi.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ALTRO = 'incorporato.example';
const esiti = [];
const NOMI = "const nomi = () => navigator.mediaDevices.enumerateDevices().then((l) => [...new Set(l.filter((d) => d.label).map((d) => d.kind))].sort().join(',') || 'nessuno');";
const PAGINE = {
  '/midi': `<!doctype html><button id="b" style="position:fixed;top:200px;left:200px">Midi</button><script>
const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
document.getElementById('b').addEventListener('click', () => navigator.requestMIDIAccess().then(() => m('midi:si'), (e) => m('midi:' + e.name)));
</script>`,
  '/figlio': `<!doctype html><script>
const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
${NOMI}
nomi().then((n) => m('figlio:' + n));
</script>`,
  '/sinkid': `<!doctype html><script>
const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
navigator.mediaDevices.enumerateDevices().then((l) => {
  const out = l.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  if (!out.length) return m('sink:nessuna-uscita:' + l.map((d) => d.kind + '=' + d.deviceId.slice(0, 6)).join(','));
  return new Audio().setSinkId(out[0].deviceId).then(() => m('sink:si'), (e) => m('sink:' + e.name));
});
</script>`,
};

let server, origine, porta, app, shell, userData;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/con-figlio') {
      res.end(`<!doctype html><iframe allow="microphone; camera" src="http://${ALTRO}:${server.address().port}/figlio"></iframe>`);
      return;
    }
    res.end(PAGINE[u.pathname] || '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
  origine = `http://127.0.0.1:${porta}`;
});
test.afterAll(async () => { await new Promise((ok) => server.close(ok)); });

test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-1524-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', `--host-resolver-rules=MAP ${ALTRO} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${ALTRO}:${porta}`, '.'],
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

const apri = (p) => shell.evaluate((u) => window.filoShell.tabs.open(u), origine + p);
const barra = () => shell.locator('#permesso-bar');
const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));

test('MIDI senza sysex: la cornice chiede', async () => {
  test.setTimeout(60_000);
  await apri('/midi');
  let pagina = null;
  await expect.poll(() => { pagina = paginaDi(origine + '/midi'); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#b').click();
  await expect(barra()).toContainText('strumenti musicali', { timeout: 10_000 });
});

test('riquadro di un altro sito con microfono delegato: niente nomi prima del sì', async () => {
  test.setTimeout(60_000);
  await apri('/con-figlio');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['figlio:nessuno']);
});

test('uscita audio diversa da quella di sistema: prima del sì non si sceglie', async () => {
  test.setTimeout(60_000);
  await apri('/sinkid');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(1);
  console.log('ESITO sinkid', esiti[0]);
  expect(esiti[0]).not.toBe('sink:si');
});
