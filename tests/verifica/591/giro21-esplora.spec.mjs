// Esplorazione del giro 21 di #591: finestra nascosta del controllo profondo, pagina Sicurezza in incognito, aspetto.

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
const M = "const m=(x)=>fetch('/esito?m='+encodeURIComponent(x));";
const PAGINE = {
  '/allarme': `<!doctype html><meta charset="utf-8"><title>Avviso</title><script>${M}
    const c = new AudioContext(); const o = c.createOscillator(); o.connect(c.destination); o.start();
    m('audio:' + c.state);
    alert('Il tuo computer è infetto: chiama subito il numero 800 000 000');
    m('dopo-alert');
  </script><p>avviso</p>`,
  '/stampa': `<!doctype html><meta charset="utf-8"><title>Avviso</title><script>${M}
    m('prima'); window.print(); m('dopo-stampa');
  </script><iframe src="/lento"></iframe>`,
  '/microfono': `<!doctype html><meta charset="utf-8"><title>Riunione</title><script>${M}
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (s) => m('concesso:' + s.getTracks().map((t) => t.kind).join(',')), (e) => m('negato:' + e.name));
  </script>`,
};

let server;
let origine;
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 30_000); t.unref?.(); return; }
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
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-g21-');
  await avvia();
});
async function avvia() {
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
}
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

// Lo schermo intero, visto dal sistema: la finestra di Filo nei test sta fuori schermo, quindi quello che si vede è
// solo ciò che compare da sé (una finestra di dialogo).
async function schermo(nome) {
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

test('la pagina riaperta di nascosto non suona e non lascia finestre di dialogo sullo schermo', async () => {
  test.setTimeout(90_000);
  expect(await schermo('giro21-prima.png'), 'schermo non vuoto prima della prova').toBeLessThan(50);
  const fatto = app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), origine + '/allarme');
  await expect.poll(() => esiti.includes('audio:running'), { timeout: 10_000 }).toBe(true);
  const suono = await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed() && w.webContents.getURL().startsWith(u))
    .map((w) => ({ visibile: w.isVisible(), suona: w.webContents.isCurrentlyAudible(), muto: w.webContents.isAudioMuted() })),
  origine + '/allarme');
  console.log('finestra nascosta:', JSON.stringify(suono));
  await fatto;
  await new Promise((ok) => setTimeout(ok, 1500));
  const accesi = await schermo('giro21-dialogo-dopo.png');
  console.log('esiti:', JSON.stringify(esiti), 'pixel accesi:', accesi);
  expect(suono.length, 'la finestra nascosta non si è trovata').toBeGreaterThan(0);
  expect(suono.some((x) => x.suona && !x.muto), 'la copia nascosta suona').toBe(false);
  expect(accesi, 'a controllo finito resta sullo schermo la finestra di dialogo della pagina sospetta').toBeLessThan(50);
});

test('la pagina riaperta di nascosto non apre la finestra di stampa del sistema', async () => {
  test.setTimeout(90_000);
  expect(await schermo('giro21-prima-stampa.png')).toBeLessThan(50);
  const fatto = app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), origine + '/stampa');
  await expect.poll(() => esiti.includes('prima'), { timeout: 10_000 }).toBe(true);
  await new Promise((ok) => setTimeout(ok, 2500));
  const durante = await schermo('giro21-stampa-durante.png');
  await fatto;
  console.log('esiti:', JSON.stringify(esiti), 'pixel accesi durante:', durante);
  expect(durante, 'la finestra di stampa della pagina sospetta compare sullo schermo').toBeLessThan(50);
});

test('una risposta tolta dalla pagina Sicurezza aperta in incognito resta tolta dopo aver riaperto Filo', async () => {
  test.setTimeout(150_000);
  const barra = () => shell.locator('#permesso-bar');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  const si = barra().getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.includes('concesso:audio'), { timeout: 10_000 }).toBe(true);

  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab('filo://security/security.html');
  });
  let sicurezza = null;
  await expect.poll(() => { sicurezza = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sicurezza); }, { timeout: 15_000 }).toBe(true);
  const righe = sicurezza.locator('#sec-perm-list li');
  await expect(righe.filter({ hasText: 'Microfono: consentito' })).toHaveCount(1, { timeout: 10_000 });
  await righe.filter({ hasText: 'Microfono' }).getByRole('button', { name: 'Togli' }).click();
  await expect(righe.filter({ hasText: 'Microfono' })).toHaveCount(0, { timeout: 10_000 });
  await new Promise((ok) => setTimeout(ok, 2000));
  await chiudiApp(app);

  esiti.length = 0;
  await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await new Promise((ok) => setTimeout(ok, 4000));
  console.log('esiti dopo la riapertura:', JSON.stringify(esiti));
  expect(esiti, 'il microfono tolto in incognito torna concesso senza domanda dopo la riapertura').not.toContain('concesso:audio');
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
});

test('aspetto: striscia della domanda e pagina Sicurezza in chiaro e in scuro', async () => {
  test.setTimeout(120_000);
  const barra = () => shell.locator('#permesso-bar');
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => {
      const MSG = globalThis.SN_MSG.MSG;
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: t } }, { url: 'filo://options/options.html' });
    }, tema);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono?' + tema);
    await expect(barra()).toBeVisible({ timeout: 10_000 });
    await new Promise((ok) => setTimeout(ok, 1200));
    await shell.screenshot({ path: join(SHOTS, `giro21-barra-${tema}.png`) });
    await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    let sicurezza = null;
    await expect.poll(() => { sicurezza = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sicurezza); }, { timeout: 10_000 }).toBe(true);
    await sicurezza.locator('#sec-site-perms').scrollIntoViewIfNeeded();
    await new Promise((ok) => setTimeout(ok, 800));
    await sicurezza.screenshot({ path: join(SHOTS, `giro21-sicurezza-${tema}.png`) });
  }
});
