// #1623 — Un'immagine lasciata in un punto di Filo che non la vuole entra nella chat come allegato, uguale all'incolla:
// nella home la chat della home, sulle altre pagine l'Aiuto. Dove la pagina accoglie il rilascio vince lei.
// Il rilascio è quello vero del sistema, via DevTools: la pagina non lo fabbrica. Regole nel pattern.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from './helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from './helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// Un PNG vero oltre i 4 MB: in coda ai byte dell'immagine, che restano leggibili.
const PNG_GRANDE = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024 + 1024)]);

function immaginiSulDisco(n = 1, { byte = PNG, nome = (i) => `foto ${i + 1}.png` } = {}) {
  const dir = cartellaInCasa('filo-test-rilascio-');
  return Array.from({ length: n }, (_, i) => {
    const p = join(dir, nome(i));
    writeFileSync(p, byte);
    return p;
  });
}

// Trascinamento vero, dal sistema, sul punto (x, y): `fasi` senza 'drop' lascia l'immagine sospesa sopra la pagina.
async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: globalThis.__filoSidebarTest?.allegati?.() || [],
  fuoco: document.activeElement === document.querySelector('.sn-sidebar-input textarea'),
}));

async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';

test('home: un’immagine lasciata fuori dal campo entra in anteprima, e mentre la si trascina il campo si accende', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
  await expect(page.locator('#inputForm')).toHaveClass(/dash-input-bersaglio/);
  await page.screenshot({ path: 'tests/.shots/rilascio-home-campo-acceso.png' });
  await lascia(page, [foto], { x: 120, y: 120, fasi: ['drop'] });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('#imgPreview')).toHaveAttribute('title', foto);
  await expect(page.locator('#inputForm')).not.toHaveClass(/dash-input-bersaglio/);
  await expect(page.locator('#input')).toBeFocused();
});

test('home: più immagini insieme entrano tutte; oltre i 4 MB col percorso entra il file, senza percorso lo si dice', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const piccole = immaginiSulDisco(3);
  await lascia(page, piccole, { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(3, { timeout: 5_000 });

  const [grande] = immaginiSulDisco(1, { byte: PNG_GRANDE, nome: () => 'grande.png' });
  await lascia(page, [grande], { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/grande\.png/, { timeout: 5_000 });

  // #1298 — incollata, l'immagine grande non ha un percorso: prima spariva senza dire niente.
  await page.evaluate((n) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(n)], 'incollata.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG_GRANDE.length);
  await expect(page.locator('.sn-toast').filter({ hasText: 'supera i 4 MB' })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(3);
});

test('sito che il rilascio non lo gestisce: l’immagine entra nell’Aiuto già allegata, col fuoco nella casella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 })
    .toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }], fuoco: true });
  await page.screenshot({ path: 'tests/.shots/rilascio-aiuto-allegata.png' });
});

test('sito che il rilascio lo gestisce (preventDefault): il file va alla pagina e l’Aiuto non si apre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div id="zona" style="position:fixed;inset:0">Carica qui</div>
    <script>
      window.ricevuti = [];
      zona.addEventListener('dragover', (e) => e.preventDefault());
      zona.addEventListener('drop', (e) => { e.preventDefault(); window.ricevuti.push(...[...e.dataTransfer.files].map((f) => f.name)); });
    </script></body></html>`);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto]);
  await expect.poll(() => page.evaluate(() => window.ricevuti), { timeout: 8_000 }).toEqual(['foto 1.png']);
  await page.waitForTimeout(400);
  expect(await statoAiuto(app, page)).toMatchObject({ aperto: false, allegati: [] });
});

test('sito: più immagini entrano tutte nell’Aiuto, oltre i 4 MB lo dice, e un rilascio finto della pagina non entra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  // Il rilascio che la pagina si fabbrica da sé non arriva all'Aiuto.
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], 'finta.png', { type: 'image/png' }));
    for (const t of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, PNG.toString('base64'));
  await page.waitForTimeout(400);
  expect(await statoAiuto(app, page)).toMatchObject({ aperto: false, allegati: [] });

  const foto = immaginiSulDisco(2);
  const [grande] = immaginiSulDisco(1, { byte: PNG_GRANDE, nome: () => 'grande.png' });
  await lascia(page, [...foto, grande]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 })
    .toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }, { nome: 'foto 2.png' }] });
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 5_000 }).toContain('supera i 4 MB');
});

// Il modello finto risponde subito e tiene da parte quello che l'Aiuto gli manda.
const AGENTE = () => {
  globalThis.__richieste = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
      globalThis.__richieste.push(m.payload);
      return Promise.resolve({ ok: true, text: '{"text":"È un quadratino rosso.","status":"done"}' });
    }
    return orig(m, ...r);
  };
  return 1;
};

test('Aiuto: l’immagine allegata parte col messaggio, si vede nella bolla, e la × la toglie prima dell’invio', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, AGENTE);
  const foto = immaginiSulDisco(2);
  await lascia(page, foto);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8_000 }).toBe(2);

  const x = await nelMondoDiFilo(app, page, () => globalThis.__filoSidebarTest.puntoTogli(1));
  await page.mouse.click(x.x, x.y);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome)).toEqual(['foto 1.png']);

  await page.keyboard.type('cos’è?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const [p] = await nelMondoDiFilo(app, page, () => globalThis.__richieste);
  const ultimo = p.history[p.history.length - 1];
  expect(ultimo.role).toBe('user');
  expect(ultimo.content.filter((c) => c.type === 'image_url').map((c) => c.image_url.url.slice(0, 22))).toEqual(['data:image/png;base64,']);
  expect(ultimo.content[0].text).toContain('cos’è?');
  expect(ultimo.content[0].text).toContain('l’ha allegata l’utente');
  expect(await nelMondoDiFilo(app, page, () => globalThis.__filoSidebarTest.immaginiNelleBolle())).toEqual([1]);
  expect((await statoAiuto(app, page)).allegati).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/rilascio-aiuto-inviata.png' });
});

test('Aiuto: Ctrl+V di un’immagine nella casella la allega, e le sole immagini senza testo partono lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, AGENTE);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  await page.waitForSelector('.sn-sidebar-input textarea');
  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
  }, PNG.toString('base64'));
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 5_000 }).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const [p] = await nelMondoDiFilo(app, page, () => globalThis.__richieste);
  expect(p.userMessage).toContain('senza scrivere niente');
  expect(p.history[p.history.length - 1].content.some((c) => c.type === 'image_url')).toBe(true);
});

test('fila delle schede: l’immagine lasciata lì va alla chat della scheda davanti, la home o l’Aiuto del sito', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const casa = await home(app);
  const [foto] = immaginiSulDisco(1);
  const box = await shell.locator('.tab').first().boundingBox();
  await lascia(shell, [foto], { x: box.x + box.width + 120, y: box.y + box.height / 2 });
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });

  const page = await testServer.openReady(openTab, SITO);
  await lascia(shell, [foto], { x: box.x + box.width + 260, y: box.y + box.height / 2 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }] });
});
