// Esplorazione verifica #586 giro 20: menu dentro un dialogo modale o un popover del sito.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cliccaIncolla(page) {
  const voce = page.locator('.sn-menu .sn-menu-paste-main').first();
  await expect(voce).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
}

test('esc nel dialogo: chiude il menu, il dialogo resta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>D</title><body>
    <dialog id="d" style="width:360px;padding:20px"><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(500);
  const r = await page.evaluate(() => ({ menu: document.querySelectorAll('.sn-menu').length, open: document.getElementById('d').open }));
  console.log('ESC', JSON.stringify(r));
  expect(r.menu).toBe(0);
  expect(r.open).toBe(true);
});

test('dialogo con regole di classe del sito: misure del menu', async ({ openTab, testServer }) => {
  const css = `<style>
    .modal button { background:#1e88e5 !important; color:#fff; text-transform:uppercase; width:100%; margin:8px 0; padding:14px; border-radius:20px; font-size:18px }
    .modal span { display:block; font-size:22px; color:#c00 }
    .modal > * { margin-bottom:24px }
    .modal div { border:2px solid red; padding:10px }
  </style>`;
  const misura = async (dentro) => {
    const page = await testServer.openReady(openTab, `<!doctype html><title>M</title>${css}<body>
      ${dentro ? '<dialog id="d" class="modal" style="width:360px;padding:20px"><input id="c" style="width:300px"></dialog><script>d.showModal()</script>'
        : '<input id="c" style="width:300px;margin:60px">'}</body>`);
    const box = await page.locator('#c').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
    await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
    await sleep(400);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.sn-menu');
      const r = root.getBoundingClientRect();
      const item = root.querySelector('.sn-menu-paste-main') || root.querySelector('.sn-menu-item');
      const lab = item && item.querySelector('.sn-menu-label');
      const ci = item ? getComputedStyle(item) : {};
      const cl = lab ? getComputedStyle(lab) : {};
      return { w: Math.round(r.width), h: Math.round(r.height), parent: root.parentElement.tagName,
        itemBg: ci.backgroundColor, itemTT: ci.textTransform, itemFs: ci.fontSize, labFs: cl.fontSize, labColor: cl.color, labDisplay: cl.display,
        rootMargin: getComputedStyle(root).marginBottom, divBorder: [...root.querySelectorAll('div')].map((d) => getComputedStyle(d).borderTopWidth).filter((x) => x !== '0px').length };
    });
    await page.screenshot({ path: `tests/.shots/586-g20-classi-${dentro ? 'dialogo' : 'pagina'}.png` });
    return m;
  };
  const fuori = await misura(false);
  const dentro = await misura(true);
  console.log('FUORI', JSON.stringify(fuori));
  console.log('DENTRO', JSON.stringify(dentro));
});

test('dialogo spostato con transform: il menu nasce sotto il cursore', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>T</title><body>
    <dialog id="d" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;width:360px;padding:20px"><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(300);
  const r = await page.evaluate(() => { const m = document.querySelector('.sn-menu').getBoundingClientRect(); return { left: m.left, top: m.top }; });
  console.log('TRANSFORM', JSON.stringify(r), 'cursore', box.x + 30, box.y + 8);
});

test('campo in un popover del sito: Incolla incolla e il popover resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>P</title><body>
    <button popovertarget="p">Cerca</button>
    <div id="p" popover style="width:360px;padding:20px"><input id="c" style="width:300px"></div><script>p.showPopover()</script></body>`);
  await app.evaluate(({ clipboard }) => clipboard.writeText('popover-586'));
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await cliccaIncolla(page);
  await sleep(800);
  const r = await page.evaluate(() => ({ v: document.getElementById('c').value, open: document.getElementById('p').matches(':popover-open') }));
  console.log('POPOVER', JSON.stringify(r));
});

test('dialogo modale: Invio nel campo domanda del menu non invia il modulo del dialogo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>F</title><body>
    <dialog id="d" style="width:360px;padding:20px"><form method="dialog" id="f"><input id="c" style="width:300px"><button>OK</button></form></dialog>
    <script>window.__chiuso = 0; d.addEventListener('close', () => { window.__chiuso++; }); window.__tasti = []; d.addEventListener('keydown', (e) => window.__tasti.push(e.key)); d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  const inputs = await page.evaluate(() => [...document.querySelectorAll('.sn-menu input')].map((i) => i.className + ':' + i.type));
  console.log('INPUT MENU', JSON.stringify(inputs));
});
