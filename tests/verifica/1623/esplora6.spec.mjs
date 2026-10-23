// Esplorazione del giro 6 di #1623.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');

function suDisco(nome, byte) {
  const p = join(cartellaInCasa('filo-test-es6-'), nome);
  writeFileSync(p, byte);
  return p;
}
async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: globalThis.__filoSidebarTest?.allegati?.() || [],
}));
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina.</p><script>window.visti=[];'
  + "for (const t of ['drop','paste']) window.addEventListener(t, (e) => { const f=[...(e.dataTransfer?.files||[]), ...[...(e.clipboardData?.items||[])].map((i)=>i.getAsFile()).filter(Boolean)]; if (f.length) window.visti.push(t); }, true);"
  + '</script></body></html>';

test('jfif direttamente sul sito e dalla fila delle schede', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const jfif = suDisco('foto.jfif', JPG);
  await lascia(page, [jfif]);
  await page.waitForTimeout(1500);
  console.log('DIRETTO', JSON.stringify(await statoAiuto(app, page)), JSON.stringify(await statoDi(app, page, '.sn-toast')));
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.close({ davvero: true }); return 1; });
  const jfif2 = suDisco('altra.jfif', JPG);
  const box = await shell.locator('.tab').last().boundingBox();
  await lascia(shell, [jfif2], { x: box.x + box.width + 260, y: box.y + box.height / 2 });
  await page.waitForTimeout(1500);
  console.log('FILA', JSON.stringify(await statoAiuto(app, page)), JSON.stringify(await statoDi(app, page, '.sn-toast')));
});

test('modale del feedback sul sito: il sito vede il file lasciato?', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_FEEDBACK_UI.open(); return 1; });
  await page.waitForTimeout(800);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const c = { x: vp.w / 2, y: vp.h - 120 };
  await page.screenshot({ path: 'tests/.shots/es6-feedback-prima.png' });
  console.log('MODALE', JSON.stringify(c));
  const foto = suDisco('estratto.png', PNG);
  await lascia(page, [foto], c);
  await page.waitForTimeout(1000);
  console.log('VISTI', JSON.stringify(await page.evaluate(() => window.visti)), JSON.stringify(await statoAiuto(app, page)));
  await page.screenshot({ path: 'tests/.shots/es6-feedback.png' });
});

for (const tema of ['dark', 'light']) {
  test(`aspetto allegati Aiuto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    const page = await testServer.openReady(openTab, SITO);
    await lascia(page, [suDisco('a.png', readFileSync('/tmp/claude-0/-home-user-Filo/5ec4466b-23be-5ea3-8750-dbb5adbcd3ee/scratchpad/foto.png')), suDisco('b.jpg', readFileSync('/tmp/claude-0/-home-user-Filo/5ec4466b-23be-5ea3-8750-dbb5adbcd3ee/scratchpad/foto2.jpg'))]);
    await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8000 }).toBe(2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/es6-aiuto-${tema}.png` });
  });
}

test('csp img-src self: le anteprime si vedono?', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="img-src 'self'; default-src 'self' 'unsafe-inline'"></head>
    <body style="margin:0;height:100vh">csp</body></html>`);
  const S = '/tmp/claude-0/-home-user-Filo/5ec4466b-23be-5ea3-8750-dbb5adbcd3ee/scratchpad';
  const errori = [];
  page.on('console', (m) => errori.push(m.text()));
  await lascia(page, [suDisco('a.png', readFileSync(`${S}/foto.png`)), suDisco('b.jpg', readFileSync(`${S}/foto2.jpg`))]);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8000 }).toBe(2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/es6-csp.png' });
  console.log('CONSOLE', JSON.stringify(errori.filter((t) => /Content Security|img-src/i.test(t)).slice(0, 3)));
});

test('home: il campo acceso sfarfalla passando fra elementi?', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#input')).toBeVisible();
  await page.evaluate(() => {
    window.__giri = [];
    const f = document.getElementById('inputForm');
    window.__lasci = [];
    document.addEventListener('dragleave', (e) => window.__lasci.push([e.target.id || e.target.localName, e.relatedTarget ? (e.relatedTarget.id || e.relatedTarget.localName) : null]));
    new MutationObserver(() => window.__giri.push(f.classList.contains('dash-input-bersaglio'))).observe(f, { attributes: true, attributeFilter: ['class'] });
  });
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const foto = suDisco('a.png', PNG);
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files: [foto], dragOperationsMask: 1 };
  await s.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 10, y: 10, data });
  for (let i = 0; i < 30; i++) {
    await s.send('Input.dispatchDragEvent', { type: 'dragOver', x: 10 + i * (vp.w - 20) / 30, y: 10 + i * (vp.h - 20) / 30, data });
    await page.waitForTimeout(30);
  }
  console.log('GIRI', JSON.stringify(await page.evaluate(() => window.__giri)));
  await s.send('Input.dispatchDragEvent', { type: 'dragOver', x: -40, y: -40, data }).catch((e) => console.log('fuori', e.message));
  await page.waitForTimeout(200);
  console.log('FUORI', await page.locator('#inputForm').getAttribute('class'));
  await s.send('Input.dispatchDragEvent', { type: 'dragCancel', x: 10, y: 10, data }).catch((e) => console.log('cancel', e.message));
  await page.waitForTimeout(300);
  console.log('LASCI', JSON.stringify(await page.evaluate(() => window.__lasci)));
  console.log('DOPO', await page.locator('#inputForm').getAttribute('class'));
});

test('tempi: cinque foto da 10 MB sul sito', async ({ app, openTab, testServer }) => {
  const S = '/tmp/claude-0/-home-user-Filo/5ec4466b-23be-5ea3-8750-dbb5adbcd3ee/scratchpad';
  const page = await testServer.openReady(openTab, SITO);
  const b = readFileSync(`${S}/foto12mp.jpg`);
  const files = Array.from({ length: 5 }, (_, i) => suDisco(`f${i}.jpg`, b));
  const t0 = Date.now();
  await lascia(page, files);
  let aperto = 0;
  await expect.poll(async () => { const st = await statoAiuto(app, page); if (st.aperto && !aperto) aperto = Date.now() - t0; return st.allegati.length; }, { timeout: 60000, intervals: [100] }).toBe(5);
  console.log('TEMPI aperto', aperto, 'tutte', Date.now() - t0);
  await page.screenshot({ path: 'tests/.shots/es6-cinque.png' });
});

test('corsa: invio subito dopo il rilascio di foto grandi', async ({ app, openTab, testServer }) => {
  const S = '/tmp/claude-0/-home-user-Filo/5ec4466b-23be-5ea3-8750-dbb5adbcd3ee/scratchpad';
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => {
    globalThis.__richieste = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        globalThis.__richieste.push(m.payload);
        return Promise.resolve({ ok: true, text: '{"text":"ok","status":"done"}' });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  const b = readFileSync(`${S}/foto12mp.jpg`);
  const files = Array.from({ length: 3 }, (_, i) => suDisco(`f${i}.jpg`, b));
  await lascia(page, files);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/es6-in-preparazione.png' });
  const fuoco = await nelMondoDiFilo(app, page, () => document.activeElement === document.querySelector('.sn-sidebar-input textarea'));
  await page.keyboard.type('quale?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  const r = await nelMondoDiFilo(app, page, () => globalThis.__richieste.map((p) => { const u = p.history[p.history.length - 1]; return Array.isArray(u.content) ? u.content.filter((c) => c.type === 'image_url').length : 0; }));
  console.log('CORSA fuoco', fuoco, 'immagini mandate', JSON.stringify(r), 'restate', (await statoAiuto(app, page)).allegati.length);
});
