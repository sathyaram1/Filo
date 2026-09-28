// Esplorazione (si cancella): cosa arriva al main per getDisplayMedia e per la strada vecchia.
import { test } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('dettagli', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>D</title><button id="b">b</button><script>
    window.r = [];
    document.getElementById('b').onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((s) => r.push('gdm:' + s.getTracks().map((t) => t.kind + ':' + t.label)), (e) => r.push('gdm-err:' + e.name + ':' + e.message));
    window.vecchia = () => navigator.mediaDevices.getUserMedia({ video: (() => { let n = 0; return { get mandatory() { return n++ ? { chromeMediaSource: 'desktop' } : {}; } }; })() })
      .then((s) => r.push('old:' + s.getTracks().map((t) => t.kind + ':' + t.label)), (e) => r.push('old-err:' + e.name + ':' + e.message));
    window.cam = () => navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => r.push('cam:' + s.getTracks().map((t) => t.kind + ':' + t.label)), (e) => r.push('cam-err:' + e.name));
  </script>`);
  await app.evaluate(({ webContents }, risposta) => {
    const wc = webContents.getAllWebContents().find((w) => /\/t\//.test(w.getURL()) || w.getTitle() === 'D');
    globalThis.__log = [];
    const ses = wc.session;
    ses.setPermissionRequestHandler((w, perm, cb, d) => { globalThis.__disp = false; globalThis.__log.push({ perm, t: Date.now(), types: d.mediaTypes }); cb(risposta); globalThis.__log.push({ dopoCb: globalThis.__disp }); if (perm === 'media' && !(d.mediaTypes || []).length && !globalThis.__disp) { globalThis.__log.push({ uccido: true }); try { w.forcefullyCrashRenderer(); } catch (e) { globalThis.__log.push({ err: String(e) }); } } });
    ses.setPermissionCheckHandler(() => true);
    ses.setDisplayMediaRequestHandler((req, cb) => {
      globalThis.__disp = true; globalThis.__log.push({ t: Date.now(), display: { audioRequested: req.audioRequested, videoRequested: req.videoRequested, userGesture: req.userGesture, securityOrigin: req.securityOrigin } });
      cb({});
    });
  }, true);
  await page.click('#b');
  await sleep(1000);
  console.log('PAGINA1', JSON.stringify(await page.evaluate(() => window.r)));
  let morta = false; page.on('crash', () => { morta = true; });
  await page.evaluate(() => { window.vecchia(); }).catch((e) => console.log('EVAL', String(e).slice(0, 80)));
  await sleep(1500);
  console.log('MORTA', morta);
  console.log('LOG', JSON.stringify(await app.evaluate(() => globalThis.__log)));
});
