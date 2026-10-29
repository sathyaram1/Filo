// #589.17 — Nella barra dell'Aiuto su un sito due bottoni danno qualcosa al sito: il microfono e il documento trovato,
// che trascinato arriva alla pagina. Il sito li copre con un velo che lascia passare il mouse: il clic (o il
// trascinamento) vale solo se il browser li vede scoperti. Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { cartellaDellaProva, BOLLETTA_MARZO } from './helpers/documentiFinti.mjs';
import { confermaSopraPagina, clickConfirm } from './helpers/confirm.mjs';
import { nelMondoDiFilo } from './helpers/riquadri.mjs';

// Lo script del sito: un velo bianco sopra tutto, che il mouse attraversa.
const SITO = `
  window.stendi = (z = 2147483647) => {
    const v = document.createElement('div');
    v.id = 'velo';
    v.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;font:20px sans-serif;padding:20px;z-index:' + z;
    v.textContent = 'Clicca il quadrato per continuare';
    document.body.appendChild(v);
  };
  window.togli = () => { const v = document.getElementById('velo'); if (v) v.remove(); };
`;
const pagina = (corpo = '<h1>Un sito</h1>', stile = '') => `<!doctype html><html${stile ? ` style="${stile}"` : ''}><head><title>Fornitore Energia</title></head>
<body style="padding:40px;font:16px sans-serif">${corpo}<script>${SITO}</script></body></html>`;

const avvisoCoperto = (page) => page.locator('.sn-toast', { hasText: 'L\'Aiuto era coperto' });

async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

// Il microfono finto conta quante volte parte: l'ascolto vero non serve a dire se il clic è passato.
const contaAscolti = (app, page) => nelMondoDiFilo(app, page, () => {
  globalThis.__ascolti = 0;
  globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
  return true;
});
const ascolti = (app, page) => nelMondoDiFilo(app, page, () => globalThis.__ascolti);
// La guardia conterebbe un clic adesso (il browser l'ha visto scoperto, e non da poco). Un bottone che la guardia non
// guarda è sempre pronto: senza la cura le prove cadono sul clic sotto il velo, non qui.
const pronto = (app, page, sel) => nelMondoDiFilo(app, page, (s) => {
  const el = document.querySelector(s);
  const V = globalThis.SN_VISTO;
  return !!el && (V._test.stato(el) === null || V._test.pronta(el));
}, sel);

async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('il microfono dell\'Aiuto sotto il velo del sito non si accende e lo dice; scoperto parte al primo clic', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  const mic = page.locator('.sn-sidebar .sn-voce-btn');
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  const p = await centro(mic);

  // Senza velo: parte al primo clic.
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ascolti(app, page)).toBe(1);
  await expect(avvisoCoperto(page)).toHaveCount(0);

  // Velo bianco sopra tutto: il clic vero non accende niente, e l'avviso lo dice.
  await page.evaluate(() => window.stendi());
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);
  await expect(avvisoCoperto(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await ascolti(app, page), 'il microfono non parte sotto il velo').toBe(1);
  await page.screenshot({ path: 'tests/.shots/aiuto-coperto-avviso.png' });

  // Tolto il velo mentre la mano arriva: prima va visto.
  await page.evaluate(() => window.togli());
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  expect(await ascolti(app, page), 'appena scoperto non conta ancora').toBe(1);
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ascolti(app, page)).toBe(2);

  // Un velo più basso del menu ma più alto dell'Aiuto lo copre lo stesso: le sonde stanno all'altezza dell'Aiuto.
  await expect(avvisoCoperto(page), 'sotto un velo che resta, un avviso solo').toHaveCount(1);
  await expect(avvisoCoperto(page)).toHaveCount(0, { timeout: 8_000 });
  const z = Number(await page.locator('.sn-sidebar').evaluate((el) => getComputedStyle(el).zIndex));
  await page.evaluate((zz) => window.stendi(zz), z + 3);
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  expect(await ascolti(app, page), 'il velo appena sopra l\'Aiuto ferma il clic').toBe(2);
  await expect(avvisoCoperto(page)).toBeVisible();
});

// Spostato l'Aiuto dalla testata, lo specchio del correttore restava dove stava la casella e copriva il microfono, e
// gli avvisi tornavano nell'angolo sopra il pannello: la guardia li prendeva per un velo del sito (#1340).
test('spostato dalla testata, il microfono dell\'Aiuto parte al primo clic e l\'avviso della guardia non lo copre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  const mic = page.locator('.sn-sidebar .sn-voce-btn');
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 90, h.y + h.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  const p = await centro(mic);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ascolti(app, page)).toBe(1);
  await expect(avvisoCoperto(page)).toHaveCount(0);

  // Sotto un velo l'avviso compare a fianco del pannello: tolto il velo, il microfono si vede e risponde.
  await page.evaluate(() => window.stendi());
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);
  await expect(avvisoCoperto(page)).toBeVisible();
  const a = await avvisoCoperto(page).boundingBox();
  const s = await page.locator('.sn-sidebar').boundingBox();
  expect(a.x + a.width <= s.x || a.x >= s.x + s.width, 'l\'avviso sta a fianco dell\'Aiuto').toBe(true);
  await page.evaluate(() => window.togli());
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ascolti(app, page)).toBe(2);
  await page.screenshot({ path: 'tests/.shots/aiuto-spostato-avviso.png' });
});

test('su una pagina in grigio il microfono dell\'Aiuto risponde, e la pagina resta grigia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<h1 style="color:#c00">Un sito in lutto</h1>', 'filter:grayscale(1)'));
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-voce-btn')).toBe(true);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => ascolti(app, page)).toBe(1);
  await expect(avvisoCoperto(page)).toHaveCount(0);
  // Il titolo rosso del sito si vede grigio: il filtro torna sulla pagina dal fondo sotto l'Aiuto.
  const titolo = await page.locator('h1').boundingBox();
  const shot = await page.screenshot({ clip: { x: titolo.x + 2, y: titolo.y + titolo.height / 2 - 4, width: 120, height: 8 } });
  await page.screenshot({ path: 'tests/.shots/aiuto-coperto-grigio.png' });
  const colorato = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, Math.abs(d[i] - d[i + 1]), Math.abs(d[i] - d[i + 2]));
    return max;
  }, shot.toString('base64'));
  expect(colorato, 'nessun pixel colorato nel titolo').toBeLessThan(24);
});

// L'Aiuto riceve la risposta della prima coppia [parola, risposta] la cui parola sta nell'ultimo messaggio dell'utente.
async function aiutoFinto(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
    globalThis.__trascinati = [];
    globalThis.__aperti = [];
  }, risposte);
  await app.evaluate(({ shell, webContents }) => {
    shell.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    for (const wc of webContents.getAllWebContents()) wc.startDrag = (item) => { globalThis.__trascinati.push(item.file); };
  });
}

const RISPOSTE = [
  ['ho cercato fra i documenti', JSON.stringify({ text: 'Eccola: trascinala nel campo «Bolletta».', file: 1, status: 'done' })],
  ['', JSON.stringify({ action: 'documenti', cosa: 'bolletta luce marzo', text: 'La cerco fra i tuoi documenti.' })],
];

async function trascina(page, box) {
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.move(box.x - 200, box.y - 200, { steps: 6 });
  await page.mouse.up();
}

test('il documento trovato dall\'Aiuto, sotto il velo del sito, non si trascina e non si apre; scoperto sì', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Scansioni');
  cartellaDellaProva(dir);
  const bolletta = join(dir, BOLLETTA_MARZO);
  const page = await testServer.openReady(openTab, pagina('<h1>Carica la tua bolletta</h1><input type="file" id="bolletta">'));
  await aiutoFinto(app, RISPOSTE);
  await apriAiuto(shell, page);
  await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
  const file = page.locator('.sn-sidebar .sn-sidebar-file');
  await expect(file).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-sidebar-file')).toBe(true);
  const box = await file.boundingBox();

  // Il velo copre la barra: il trascinamento vero dell'utente non porta il file alla pagina, e nemmeno il clic lo apre.
  await page.evaluate(() => window.stendi());
  await page.waitForTimeout(700);
  await trascina(page, box);
  await expect(avvisoCoperto(page)).toBeVisible();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await page.waitForTimeout(600);
  expect(await app.evaluate(() => globalThis.__trascinati), 'il file non parte sotto il velo').toEqual([]);
  expect(await app.evaluate(() => globalThis.__aperti)).toEqual([]);

  // Tolto il velo e visto il bottone, lo stesso gesto porta il file.
  await page.evaluate(() => window.togli());
  await expect.poll(() => pronto(app, page, '.sn-sidebar .sn-sidebar-file')).toBe(true);
  await trascina(page, box);
  await expect.poll(() => app.evaluate(() => globalThis.__trascinati)).toEqual([bolletta]);
});
