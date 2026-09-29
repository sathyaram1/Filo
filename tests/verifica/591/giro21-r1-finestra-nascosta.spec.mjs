// Giro 21 di #591, rilievo 1: la copia nascosta di una pagina sospetta non deve arrivare all'utente, né col suono né
// con una finestra di dialogo che resta sullo schermo. Nei test la finestra di Filo sta fuori schermo: lo schermo è nero
// e ogni pixel acceso è qualcosa comparso da sé.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const esiti = [];
// Come un finto avviso di virus: allarme sonoro e finestra di dialogo appena si apre; il riquadro lento tiene viva la copia.
const ALLARME = `<!doctype html><meta charset="utf-8"><title>Avviso</title><script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  const c = new AudioContext(); const o = c.createOscillator(); o.connect(c.destination); o.start();
  m('audio:' + c.state);
  alert('Il tuo computer è infetto: chiama subito il numero 800 000 000');
</script><p>avviso</p><iframe src="/lento"></iframe>`;

let server;
let origine;
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 30_000); t.unref?.(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ALLARME);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-g21r1-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  await (await app.firstWindow()).waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

async function pixelAccesi(nome) {
  const r = await app.evaluate(async ({ desktopCapturer }) => {
    const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 800, height: 600 } });
    const img = s[0].thumbnail;
    const bmp = img.toBitmap();
    let accesi = 0;
    for (let i = 0; i < bmp.length; i += 4) if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 60) accesi++;
    return { png: img.toPNG().toString('base64'), accesi };
  });
  writeFileSync(join(SHOTS, nome), Buffer.from(r.png, 'base64'));
  return r.accesi;
}

test('la pagina sospetta riaperta di nascosto non suona e non lascia la sua finestra di dialogo sullo schermo', async () => {
  test.setTimeout(90_000);
  expect(await pixelAccesi('591-giro21-r1-prima.png'), 'lo schermo non è vuoto già prima della prova').toBeLessThan(50);
  const fatto = app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), origine + '/allarme');
  await expect.poll(() => esiti.includes('audio:running'), { timeout: 10_000 }).toBe(true);
  const copie = await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && w.webContents.getURL().startsWith(u))
    .map((w) => ({ visibile: w.isVisible(), suona: w.webContents.isCurrentlyAudible(), muta: w.webContents.isAudioMuted() })),
  origine + '/allarme');
  expect(copie.length, 'la copia nascosta non si è trovata').toBeGreaterThan(0);
  expect(copie.some((x) => x.suona && !x.muta), 'la copia nascosta fa sentire il suo allarme').toBe(false);
  await fatto;
  await new Promise((ok) => setTimeout(ok, 1500));
  expect(await pixelAccesi('591-giro21-r1-dopo.png'), 'a controllo finito la finestra di dialogo della pagina sospetta è ancora sullo schermo').toBeLessThan(50);
});
