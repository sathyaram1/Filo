// Esplorazione del giro 6 di #1623.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
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
  const c = await nelMondoDiFilo(app, page, () => {
    const m = document.querySelector('.sn-fb-modal');
    if (!m) return null;
    const b = m.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
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
    await lascia(page, [suDisco('a.png', PNG), suDisco('b.jpg', JPG)]);
    await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8000 }).toBe(2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/es6-aiuto-${tema}.png` });
  });
}
