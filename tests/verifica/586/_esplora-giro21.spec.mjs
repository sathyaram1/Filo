// Esplorazione giro 21 (#586): il menu nato in un dialogo del sito e le regole del sito che lo raggiungono.
import { test, expect } from '../../fixtures/electron.mjs';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = 'tests/.shots';
fs.mkdirSync(SHOTS, { recursive: true });

async function misura(page, campo) {
  const box = await page.locator(campo).boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  return page.evaluate(() => {
    const root = document.querySelector('.sn-menu');
    const r = root.getBoundingClientRect();
    const voci = [...root.querySelectorAll('*')].filter((n) => !n.closest('svg')).map((n) => {
      const c = getComputedStyle(n);
      const a = getComputedStyle(n, '::after');
      const b = getComputedStyle(n, '::before');
      const bb = n.getBoundingClientRect();
      return [n.className, Math.round(bb.width), Math.round(bb.height), c.backgroundColor, c.color, c.webkitTextFillColor,
        c.fontWeight, c.fontSize, c.lineHeight, c.direction, c.letterSpacing, c.marginBottom, c.fontFeatureSettings,
        'after=' + a.content, 'before=' + b.content].join(' | ');
    });
    const icone = [...root.querySelectorAll('svg')].slice(0, 4).map((s) => {
      const c = getComputedStyle(s); const bb = s.getBoundingClientRect();
      return [Math.round(bb.width), Math.round(bb.height), c.fill, c.stroke, c.display].join(' ');
    });
    return { genitore: root.parentElement.id || root.parentElement.tagName, larghezza: Math.round(r.width), altezza: Math.round(r.height), voci, icone };
  });
}

async function confronta(page, nome) {
  const { genitore: g1, ...fuori } = await misura(page, '#fuori');
  await page.screenshot({ path: `${SHOTS}/586-giro21-${nome}-fuori.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('accedi').showModal());
  const { genitore: g2, ...dentro } = await misura(page, '#c');
  await page.screenshot({ path: `${SHOTS}/586-giro21-${nome}-dentro.png` });
  const diff = [];
  if (fuori.larghezza !== dentro.larghezza || fuori.altezza !== dentro.altezza) diff.push(`misura ${fuori.larghezza}x${fuori.altezza} -> ${dentro.larghezza}x${dentro.altezza}`);
  fuori.voci.forEach((v, i) => { if (v !== dentro.voci[i]) diff.push(`F ${v}\nD ${dentro.voci[i]}`); });
  fuori.icone.forEach((v, i) => { if (v !== dentro.icone[i]) diff.push(`iconaF ${v}\niconaD ${dentro.icone[i]}`); });
  console.log(`== ${nome} genitori ${g1} ${g2} differenze ${diff.length}\n` + diff.slice(0, 12).join('\n'));
  return diff;
}

const pagina = (css) => `<!doctype html><title>Accesso</title><style>${css}</style><body>
  <input id="fuori" style="margin:40px;width:300px">
  <dialog id="accedi" class="login" style="width:360px;padding:24px"><div><span>Email</span><input id="c" style="width:300px"></div><button>Accedi</button></dialog></body>`;

test('giro20 r1 ri-provato: regole normali del contenuto del dialogo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
  .login button { width:100%; padding:12px; background:#2563eb; color:#fff; border-radius:8px; font-weight:600 }
  dialog div { margin-bottom:16px }
  dialog span { font-weight:600; letter-spacing:.5px }`));
  expect(await confronta(page, 'normali')).toEqual([]);
});

test('regole !important del contenuto del dialogo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
  dialog button { background:#2563eb !important; color:#fff !important; padding:12px !important; border-radius:8px !important }
  dialog span { font-weight:700 !important; text-transform: uppercase !important }`));
  const d = await confronta(page, 'important');
  expect(d).toEqual([]);
});

test('pseudo-elementi del contenuto del dialogo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
  dialog button::after { content: " ›"; color: #c00 }
  dialog div::before { content: ""; display:block; height: 12px; background:#c00 }`));
  const d = await confronta(page, 'pseudo');
  expect(d).toEqual([]);
});

test('proprietà ereditate dal dialogo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
  dialog { line-height: 2.2; direction: rtl; -webkit-text-fill-color: #c00; font-feature-settings: "smcp"; word-break: break-all; color-scheme: dark }`));
  const d = await confronta(page, 'ereditate');
  expect(d).toEqual([]);
});

test('icone svg del contenuto del dialogo', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina(`
  dialog svg { width: 32px; height: 32px; display:inline }
  .login button svg { width: 40px !important; height: 40px !important }`));
  const d = await confronta(page, 'svg');
  expect(d).toEqual([]);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto del menu sul web, tema ${tema}, con cronologia aperta`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    await app.evaluate(({ clipboard }) => clipboard.writeText('testo-uno'));
    const banca = await testServer.openReady(openTab, '<!doctype html><title>Uno</title><input id="c">');
    await banca.locator('#c').click({ button: 'right' });
    await banca.locator('.sn-menu .sn-menu-paste-main').first().click();
    await app.evaluate(({ clipboard }) => clipboard.writeText('testo-due'));
    const page = await testServer.openReady(openTab, `<!doctype html><title>Sito</title><body style="font:16px Georgia;line-height:2"><input id="fuori" style="margin:40px;width:300px"></body>`);
    await page.locator('#fuori').click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
    await sleep(400);
    await page.screenshot({ path: `${SHOTS}/586-giro21-menu-${tema}.png` });
    const freccia = page.locator('.sn-menu-paste-arrow');
    if (await freccia.count()) await freccia.first().hover();
    await sleep(800);
    await page.screenshot({ path: `${SHOTS}/586-giro21-cronologia-${tema}.png` });
    const st = await page.evaluate(() => {
      const i = document.querySelector('.sn-menu-history-search-input');
      if (!i) return null;
      const c = getComputedStyle(i);
      return [c.backgroundColor, c.color, c.borderTopWidth, c.borderTopStyle, c.borderTopColor, c.fontFamily, c.fontSize, c.appearance].join(' | ');
    });
    console.log(`== tema ${tema} campo cerca: ${st}`);
  });
}
