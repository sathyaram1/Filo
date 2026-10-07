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

test.skip('esc nel dialogo: chiude il menu, il dialogo resta', async ({ openTab, testServer }) => {
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
  const dentro = await misura(true);
  console.log('DENTRO', JSON.stringify(dentro));
});

test.skip('dialogo spostato con transform: il menu nasce sotto il cursore', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>T</title><body>
    <dialog id="d" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;width:360px;padding:20px"><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(300);
  const r = await page.evaluate(() => { const m = document.querySelector('.sn-menu').getBoundingClientRect(); return { left: m.left, top: m.top }; });
  console.log('TRANSFORM', JSON.stringify(r), 'cursore', box.x + 30, box.y + 8);
});

test.skip('campo in un popover del sito: Incolla incolla e il popover resta', async ({ app, openTab, testServer }) => {
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

test.skip('dialogo modale: Invio nel campo domanda del menu non invia il modulo del dialogo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>F</title><body>
    <dialog id="d" style="width:360px;padding:20px"><form method="dialog" id="f"><input id="c" style="width:300px"><button>OK</button></form></dialog>
    <script>window.__chiuso = 0; d.addEventListener('close', () => { window.__chiuso++; }); window.__tasti = []; d.addEventListener('keydown', (e) => window.__tasti.push(e.key)); d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  const inputs = await page.evaluate(() => [...document.querySelectorAll('.sn-menu input')].map((i) => i.className + ':' + i.type));
  console.log('INPUT MENU', JSON.stringify(inputs));
});

for (const [nome, css] of [
  ['elementi', 'dialog div { margin-bottom:16px } dialog span { font-weight:600; letter-spacing:.5px } dialog button { padding:12px 20px; background:#2563eb; color:#fff; border-radius:8px }'],
  ['classe', '.login button { width:100%; padding:12px; background:#2563eb; color:#fff; border-radius:8px; font-weight:600 } .login { text-align:left }'],
  ['id', '#accedi button { padding:10px 18px; background:#111; color:#fff; border:0; border-radius:6px; margin-top:12px }'],
]) {
  test(`realistico ${nome}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><title>R</title><style>${css}</style><body>
      <dialog id="accedi" class="login" style="width:360px;padding:24px"><div><span>Email</span><input id="c" style="width:300px"></div><button>Accedi</button></dialog><script>accedi.showModal()</script></body>`);
    const box = await page.locator('#c').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
    await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
    await sleep(400);
    const m = await page.evaluate(() => {
      const root = document.querySelector('.sn-menu');
      const r = root.getBoundingClientRect();
      const item = root.querySelector('.sn-menu-paste-main');
      return { w: Math.round(r.width), h: Math.round(r.height), parent: root.parentElement.tagName, bg: getComputedStyle(item).backgroundColor, color: getComputedStyle(item).color };
    });
    console.log('REAL', nome, JSON.stringify(m));
    await page.screenshot({ path: `tests/.shots/586-g20-real-${nome}.png` });
  });
}

test('dialogo: i riquadri aperti dal menu si vedono e rispondono', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>S</title><body>
    <dialog id="d" style="width:420px;padding:24px"><p id="t">Il gatto dorme sul divano rosso della nonna.</p><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const t = await page.locator('#t').boundingBox();
  await page.evaluate(() => { const r = document.createRange(); const n = document.getElementById('t').firstChild; r.setStart(n, 3); r.setEnd(n, 8); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.mouse.click(t.x + 40, t.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const voci = await page.evaluate(() => [...document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu .sn-menu-row-btn')].map((b) => (b.getAttribute('aria-label') || b.dataset.snTip || b.title || b.textContent || '').trim().slice(0, 30)));
  console.log('VOCI', JSON.stringify(voci));
  await page.screenshot({ path: 'tests/.shots/586-g20-dialogo-selezione.png' });
});

for (const voce of ['QR code della pagina', 'Invia feedback', 'Aiuto', 'Traduci']) {
  test(`dialogo: ${voce} aperto dal menu si vede e risponde`, async ({ openTab, testServer, shell }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><title>S</title><body>
      <dialog id="d" style="width:420px;padding:24px"><p id="t">Il gatto dorme sul divano rosso della nonna.</p><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
    const t = await page.locator('#t').boundingBox();
    if (voce === 'Traduci') await page.evaluate(() => { const r = document.createRange(); const n = document.getElementById('t').firstChild; r.setStart(n, 3); r.setEnd(n, 8); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.mouse.click(t.x + 40, t.y + 8, { button: 'right' });
    await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
    await sleep(500);
    const b = await page.evaluate((v) => {
      const el = [...document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu .sn-menu-row-btn')].find((x) => ((x.getAttribute('aria-label') || x.dataset.snTip || x.title || x.textContent || '').trim()).startsWith(v));
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, voce);
    if (!b) { console.log('NON TROVATA', voce); return; }
    await page.mouse.move(b.x, b.y, { steps: 3 }); await sleep(200);
    await page.mouse.down(); await page.mouse.up();
    await sleep(2000);
    const r = await page.evaluate(() => {
      const nuovi = [...document.documentElement.children].filter((n) => n.tagName !== 'HEAD' && n.tagName !== 'BODY')
        .concat([...document.getElementById('d').children].filter((n) => !['P', 'INPUT'].includes(n.tagName)));
      return nuovi.map((n) => {
        const rr = n.getBoundingClientRect();
        const cx = rr.x + Math.min(rr.width / 2, 40), cy = rr.y + Math.min(rr.height / 2, 40);
        const hit = document.elementFromPoint(cx, cy);
        return { tag: n.tagName, cls: String(n.className).slice(0, 40), parent: n.parentElement.tagName, w: Math.round(rr.width), h: Math.round(rr.height), sopra: !!(hit && (n === hit || n.contains(hit))), hit: hit && (hit.id || hit.tagName) };
      }).filter((x) => x.w > 0);
    });
    console.log('APERTO', voce, JSON.stringify(r));
    await page.screenshot({ path: `tests/.shots/586-g20-dialogo-${voce.split(' ')[0]}.png` });
  });
}

test('schermo intero: Invia feedback aperto dal menu si vede', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>F</title><body>
    <div id="pl" style="width:400px;height:300px;background:#246"><button id="fs" onclick="pl.requestFullscreen()">FS</button><p id="t" style="color:#fff">Lettore</p></div></body>`);
  await page.locator('#fs').click();
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  await sleep(800);
  const t = await page.locator('#t').boundingBox();
  await page.mouse.click(t.x + 20, t.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.sn-menu .sn-menu-item')].find((x) => x.textContent.trim().startsWith('Invia feedback'));
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(b.x, b.y, { steps: 3 }); await sleep(200);
  await page.mouse.down(); await page.mouse.up();
  await sleep(2000);
  const r = await page.evaluate(() => {
    const ta = document.querySelector('.sn-fb-overlay textarea, .sn-fb textarea');
    if (!ta) return { ta: false, fs: !!document.fullscreenElement };
    const rr = ta.getBoundingClientRect(); const hit = document.elementFromPoint(rr.x + 20, rr.y + 10);
    return { ta: true, fs: !!document.fullscreenElement, sopra: ta === hit || ta.contains(hit), hit: hit && (hit.id || hit.className) };
  });
  console.log('FS', JSON.stringify(r));
  await page.screenshot({ path: 'tests/.shots/586-g20-fs-feedback.png' });
});

test('dialogo: nel riquadro del feedback aperto dal menu si scrive', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>S</title><body>
    <dialog id="d" style="width:420px;padding:24px"><p id="t">Testo</p><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const t = await page.locator('#t').boundingBox();
  await page.mouse.click(t.x + 20, t.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(500);
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.sn-menu .sn-menu-item')].find((x) => x.textContent.trim().startsWith('Invia feedback'));
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(b.x, b.y, { steps: 3 }); await sleep(200);
  await page.mouse.down(); await page.mouse.up();
  await sleep(1500);
  const ta = page.locator('.sn-fb-overlay textarea').first();
  const bb = await ta.boundingBox();
  await page.mouse.click(bb.x + 40, bb.y + 20);
  await page.keyboard.type('ciao filo');
  await sleep(300);
  const r = await page.evaluate(() => ({ val: document.querySelector('.sn-fb-overlay textarea').value, att: document.activeElement && (document.activeElement.id || document.activeElement.tagName), open: document.getElementById('d').open, c: document.getElementById('c').value }));
  console.log('SCRIVE', JSON.stringify(r));
});
