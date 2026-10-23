// #1623 — Un'immagine lasciata in un punto di Filo che non la vuole entra nella chat come allegato, uguale all'incolla:
// nella home la chat della home, sulle altre pagine l'Aiuto. Dove la pagina accoglie il rilascio vince lei.
// Il rilascio è quello vero del sistema, via DevTools: la pagina non lo fabbrica. Regole nel pattern.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from './helpers/percorsi.mjs';
import { nelMondoDiFilo, statoDi } from './helpers/riquadri.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

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

test('home: più immagini insieme entrano tutte; oltre i 4 MB col percorso entra il file, senza percorso rimpicciolita', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const piccole = immaginiSulDisco(3);
  await lascia(page, piccole, { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(3, { timeout: 5_000 });

  const [grande] = immaginiSulDisco(1, { byte: PNG_GRANDE, nome: () => 'grande.png' });
  await lascia(page, [grande], { x: 120, y: 120 });
  await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/grande\.png/, { timeout: 5_000 });

  // #1298 — incollata, una foto vera oltre i 4 MB non ha un percorso: entra rimpicciolita, come nell'Aiuto (#1623 giro 4).
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 1800, h = 1200, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG().toString('base64');
  });
  expect(Buffer.from(b64, 'base64').length).toBeGreaterThan(4 * 1024 * 1024);
  await page.evaluate((dati) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(dati), (c) => c.charCodeAt(0))], 'incollata.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(4, { timeout: 10_000 });
  const ultima = await page.locator('#imgPreviews .dash-img-preview img').nth(3).getAttribute('src');
  expect(ultima.slice(0, 23)).toBe('data:image/jpeg;base64,');
  expect(Math.floor((ultima.length - 23) * 3 / 4)).toBeLessThanOrEqual(4 * 1024 * 1024);
  await expect(page.locator('.sn-toast')).toHaveCount(0);
});

test('un’immagine in un formato che il modello non legge (SVG) entra come PNG, nella home e nell’Aiuto', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const casa = await home(app);
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#c45a3c"/></svg>');
  const [logo] = immaginiSulDisco(1, { byte: SVG, nome: () => 'logo.svg' });
  await lascia(casa, [logo], { x: 120, y: 120 });
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  expect((await casa.locator('#imgPreview img').getAttribute('src')).slice(0, 22)).toBe('data:image/png;base64,');
  await expect(casa.locator('#imgPreview')).toHaveAttribute('title', logo);

  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, AGENTE);
  await lascia(page, [logo]);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8_000 }).toBe(1);
  await page.keyboard.type('cos’è?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const [p] = await nelMondoDiFilo(app, page, () => globalThis.__richieste);
  const immagini = p.history.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'image_url');
  expect(immagini.map((c) => c.image_url.url.slice(0, 22))).toEqual(['data:image/png;base64,']);
});

test('Aiuto: una richiesta con un’immagine rifiutata dal fornitore non blocca le domande dopo, e lo si dice', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => {
    globalThis.__richieste = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        globalThis.__richieste.push(m.payload);
        return Promise.resolve(globalThis.__richieste.length === 1
          ? { ok: false, error: 'Invalid image', status: 400 }
          : { ok: true, text: '{"text":"Eccomi.","status":"done"}' });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  const foto = immaginiSulDisco(1);
  await lascia(page, foto);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8_000 }).toBe(1);
  await page.keyboard.type('cos’è?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 5_000 }).toMatch(/partono senza l’immagine/);
  await page.keyboard.type('e adesso?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBe(2);
  const secondo = await nelMondoDiFilo(app, page, () => globalThis.__richieste[1]);
  expect(secondo.history.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'image_url')).toEqual([]);
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

test('sito con un campo per caricare file, senza codice suo: il file entra nel campo, come in ogni browser', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input id="carica" type="file" style="position:fixed;left:0;top:0;width:400px;height:300px"></body></html>`);
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto], { x: 150, y: 150 });
  await expect.poll(() => page.evaluate(() => [...document.getElementById('carica').files].map((f) => f.name)), { timeout: 8_000 }).toEqual(['foto 1.png']);
  expect(await statoAiuto(app, page)).toMatchObject({ aperto: false, allegati: [] });
});

test('sito: più immagini entrano tutte nell’Aiuto, oltre i 4 MB rimpicciolita, e un rilascio finto della pagina non entra', async ({ app, openTab, testServer }) => {
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
    .toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }, { nome: 'foto 2.png' }, { nome: 'grande.png' }] });
  // Oltre il tetto l'Aiuto la rimpicciolisce finché ci sta (#1623 giro 1): entra, sotto i 4 MB.
  const [, , ridotta] = (await statoAiuto(app, page)).allegati;
  expect(ridotta.byte).toBeLessThan(4 * 1024 * 1024 * 4 / 3);
  expect(await nelMondoDiFilo(app, page, () => document.querySelector('.sn-toast')?.textContent || '')).not.toContain('MB');
});

test('sito: una foto oltre i 4 MB lasciata sulla fila delle schede entra nell’Aiuto rimpicciolita', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [grande] = immaginiSulDisco(1, { byte: PNG_GRANDE, nome: () => 'grande.png' });
  const box = await shell.locator('.tab').last().boundingBox();
  await lascia(shell, [grande], { x: box.x + box.width + 260, y: box.y + box.height / 2 });
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome), { timeout: 8_000 }).toEqual(['grande.png']);
  expect((await statoAiuto(app, page)).allegati[0].byte).toBeLessThan(4 * 1024 * 1024 * 4 / 3);
});

test('sito: un’immagine lasciata sopra una casella di testo o un editor va all’Aiuto e il sito non la vede; se la casella il file lo accetta, resta suo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><input id="q" type="search" placeholder="Cerca" style="position:fixed;left:50px;top:50px;width:500px;height:60px">
    <div id="ed" contenteditable="true" style="position:fixed;left:50px;top:140px;width:500px;height:40px">scrivi</div>
    <textarea id="t" style="position:fixed;left:50px;top:200px;width:500px;height:120px"></textarea>
    <script>
      window.ricevuti = [];
      window.visti = [];
      // Ascolta i rilasci senza accettarli: in ogni browser non ne riceverebbe nessuno (#1623 giro 5).
      window.addEventListener('drop', (e) => { for (const f of e.dataTransfer.files) window.visti.push(f.name); }, true);
      t.addEventListener('dragover', (e) => e.preventDefault());
      t.addEventListener('drop', (e) => { e.preventDefault(); window.ricevuti.push(...[...e.dataTransfer.files].map((f) => f.name)); });
    </script></body></html>`);
  const [foto, sulEditor, altra] = immaginiSulDisco(3);
  await lascia(page, [foto], { x: 200, y: 80 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }] });
  expect(await page.locator('#q').inputValue()).toBe('');
  await lascia(page, [sulEditor], { x: 200, y: 160 });
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome), { timeout: 8_000 }).toEqual(['foto 1.png', 'foto 2.png']);
  expect(await page.evaluate(() => window.visti)).toEqual([]);
  // La casella che il passaggio del file l'ha accettato il rilascio lo riceve: l'Aiuto non cambia.
  await lascia(page, [altra], { x: 200, y: 260 });
  await expect.poll(() => page.evaluate(() => window.ricevuti), { timeout: 8_000 }).toEqual(['foto 3.png']);
  await page.waitForTimeout(300);
  expect((await statoAiuto(app, page)).allegati.map((a) => a.nome)).toEqual(['foto 1.png', 'foto 2.png']);
});

test('riquadro incorporato: l’immagine lasciata sulla sua casella va all’Aiuto e il riquadro non la vede', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0;height:100vh"><input style="width:300px;height:80px">
    <script>window.visti = []; window.addEventListener('drop', (e) => { for (const f of e.dataTransfer.files) window.visti.push(f.name); }, true);</script></body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><iframe src="${dentro}" style="position:fixed;left:0;top:0;width:400px;height:300px;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url() === dentro && f !== page.mainFrame())).toBe(true);
  const fr = page.frames().find((f) => f.url() === dentro);
  await fr.waitForLoadState('domcontentloaded');
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto], { x: 100, y: 30 });
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome), { timeout: 8_000 }).toEqual(['foto 1.png']);
  expect(await fr.evaluate(() => window.visti)).toEqual([]);
});

test('un file immagine rovinato non entra come anteprima rotta: nell’Aiuto e nella home lo dice un avviso', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const casa = await home(app);
  const rovinata = () => immaginiSulDisco(1, { byte: Buffer.from('questo non è un png'), nome: () => 'rovinata.png' });
  await casa.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['questo non è un png'], 'image.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(casa.locator('.sn-toast')).toContainText('non si è aperta', { timeout: 5_000 });
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(0);

  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, rovinata());
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 8_000 }).toContain('non si è aperta');
  expect((await statoAiuto(app, page)).allegati).toEqual([]);
});

test('sito che accetta il passaggio del file ovunque ma lo prende solo in una zona: fuori dalla zona va all’Aiuto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div id="zona" style="position:fixed;left:0;top:0;width:100px;height:100px">Carica qui</div>
    <script>
      window.ricevuti = [];
      document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      zona.addEventListener('drop', (e) => { e.preventDefault(); window.ricevuti.push(...[...e.dataTransfer.files].map((f) => f.name)); });
    </script></body></html>`);
  const [foto, altra] = immaginiSulDisco(2);
  await lascia(page, [foto], { x: 400, y: 400 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }] });
  await lascia(page, [altra], { x: 50, y: 50 });
  await expect.poll(() => page.evaluate(() => window.ricevuti), { timeout: 8_000 }).toEqual(['foto 2.png']);
  expect((await statoAiuto(app, page)).allegati.map((a) => a.nome)).toEqual(['foto 1.png']);
});

test('quello che si dà al pannello dell’Aiuto, lasciato o incollato, il sito non lo vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x
    <script>
      window.visti = [];
      for (const t of ['drop', 'paste', 'filo:paste-image']) {
        window.addEventListener(t, (e) => {
          const f = [...(e.dataTransfer?.files || []), ...[...(e.clipboardData?.items || [])].map((it) => it.getAsFile()).filter(Boolean)];
          if (f.length || e.detail?.blob) window.visti.push(t);
        }, true);
      }
    </script></body></html>`);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  await page.waitForSelector('.sn-sidebar-input textarea');
  const sul = await nelMondoDiFilo(app, page, () => {
    const b = document.querySelector('.sn-sidebar').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 3 };
  });
  const [foto] = immaginiSulDisco(1);
  const [pdf] = immaginiSulDisco(1, { byte: Buffer.from('%PDF-1.4'), nome: () => 'contratto.pdf' });
  await lascia(page, [foto, pdf], sul);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome), { timeout: 8_000 }).toEqual(['foto 1.png']);
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 5_000 }).toContain('non è un’immagine');

  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
  }, PNG.toString('base64'));
  const t = await nelMondoDiFilo(app, page, () => {
    const b = document.querySelector('.sn-sidebar-input textarea').getBoundingClientRect();
    return { x: b.x + 20, y: b.y + 10 };
  });
  await page.mouse.click(t.x, t.y);
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 5_000 }).toBe(2);
  // «Incolla» del tasto destro e della cronologia degli appunti.
  await nelMondoDiFilo(app, page, (b64) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const ev = globalThis.SN_FILO_UI.nostro(new CustomEvent('filo:paste-image', { bubbles: true, cancelable: true, detail: { blob } }));
    document.querySelector('.sn-sidebar-input textarea').dispatchEvent(ev);
    return 1;
  }, PNG.toString('base64'));
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 5_000 }).toBe(3);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.visti)).toEqual([]);
});

test('un file che non è un’immagine, lasciato insieme a una: nell’Aiuto lo dice un avviso, nella home entra col percorso', async ({ app, shell, openTab, testServer }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const casa = await home(app);
  const [foto] = immaginiSulDisco(1);
  const [pdf] = immaginiSulDisco(1, { byte: Buffer.from('%PDF-1.4'), nome: () => 'contratto.pdf' });
  const box = await shell.locator('.tab').first().boundingBox();
  await lascia(shell, [foto, pdf], { x: box.x + box.width + 120, y: box.y + box.height / 2 });
  await expect(casa.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
  await expect(casa.locator('#imgPreviews .dash-file-chip')).toHaveText(/contratto\.pdf/);

  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [foto, pdf]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }] });
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '', { timeout: 5_000 }).toContain('non è un’immagine');
});

// Il modello finto risponde subito e tiene da parte quello che l'Aiuto gli manda.
const AGENTE = () => {
  globalThis.__richieste = [];
  globalThis.__nelFilo = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...r) => {
    if (m && m.type === globalThis.SN_MSG.MSG.FILO_CONVERSAZIONE_APP) globalThis.__nelFilo.push(...m.messaggi);
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
  // Una foto con una misura vera, per guardare anteprima e bolla come le vede l'utente.
  const vera = Buffer.from(await app.evaluate(({ nativeImage }) => {
    const w = 160, h = 100, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set(i % w < w / 2 ? [60, 120, 200, 255] : [40, 160, 90, 255], i * 4);
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG().toString('base64');
  }), 'base64');
  const foto = immaginiSulDisco(2, { byte: vera });
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
  await lascia(page, [foto[1]]);
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 8_000 }).toBe(1);
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/rilascio-aiuto-scuro.png' });
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
  // «Incolla» del tasto destro manda l'immagine con l'evento di Filo; lo stesso evento fabbricato dalla pagina non vale.
  await page.evaluate(() => document.querySelector('.sn-sidebar-input textarea').dispatchEvent(new CustomEvent('filo:paste-image', {
    bubbles: true, cancelable: true, detail: { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) },
  })));
  await nelMondoDiFilo(app, page, (b64) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const ev = globalThis.SN_FILO_UI.nostro(new CustomEvent('filo:paste-image', { bubbles: true, cancelable: true, detail: { blob } }));
    document.querySelector('.sn-sidebar-input textarea').dispatchEvent(ev);
    return 1;
  }, PNG.toString('base64'));
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.length, { timeout: 5_000 }).toBe(2);
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const [p] = await nelMondoDiFilo(app, page, () => globalThis.__richieste);
  expect(p.userMessage).toContain('senza scrivere niente');
  expect(p.history[p.history.length - 1].content.some((c) => c.type === 'image_url')).toBe(true);
  // Nel filo della home la domanda c'è, e dice quante immagini aveva.
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__nelFilo), { timeout: 5_000 })
    .toEqual([{ role: 'user', text: '(2 immagini allegate)' }, { role: 'filo', text: 'È un quadratino rosso.' }]);
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

test('riquadro incorporato e barra laterale: l’immagine lasciata lì arriva all’Aiuto della pagina', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:100vh;background:#eef">un riquadro</body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><iframe id="r" src="${dentro}" style="position:fixed;left:0;top:0;width:400px;height:300px;border:0"></iframe></body></html>`);
  await expect.poll(() => page.frames().some((f) => f.url() === dentro && f !== page.mainFrame())).toBe(true);
  await page.frames().find((f) => f.url() === dentro).waitForLoadState('domcontentloaded');
  const [foto, altra] = immaginiSulDisco(2);
  await lascia(page, [foto], { x: 150, y: 150 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }] });

  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const box = await barra.locator('#pannello').boundingBox();
  await lascia(barra, [altra], { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect.poll(async () => (await statoAiuto(app, page)).allegati.map((a) => a.nome), { timeout: 8_000 }).toEqual(['foto 1.png', 'foto 2.png']);
});

test('una pagina di Filo che non è la home: l’immagine lasciata lì va all’Aiuto di quella pagina', async ({ app, openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  const [foto] = immaginiSulDisco(1);
  await lascia(page, [foto], { x: 300, y: 300 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: [{ nome: 'foto 1.png' }], fuoco: true });
});
