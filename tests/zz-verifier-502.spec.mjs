// Verifica avversariale #502 (file temporaneo del verificatore, non da tenere).
import { test, expect } from './fixtures/electron.mjs';

async function provider(app, { attesa = 300, testo = null, pezzi = 12 } = {}) {
  await app.evaluate(async (_e, cfg) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3', [C.ACTIONS.EXPLAIN]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const chunks = cfg.testo
      ? [cfg.testo]
      : Array.from({ length: cfg.pezzi }, (_, i) => `Paragrafo ${i + 1}: spiegazione distesa con testo a sufficienza per far crescere il riquadro fino al tetto. `);
    globalThis.__orig502 = globalThis.__orig502 || globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__orig502,
      complete: async () => ({ text: 'spiegazione breve', usage: {} }),
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, cfg.attesa));
        for (const p of chunks) { onDelta(p); await new Promise((r) => setTimeout(r, 25)); }
        return { text: chunks.join(''), usage: {} };
      },
    };
  }, { attesa, testo, pezzi });
}

const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const input = root.querySelector('.sn-popup-input');
  const r = root.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  const el = document.elementFromPoint(i.left + i.width / 2, i.top + i.height / 2);
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
    inputTop: i.top, inputBottom: i.bottom,
    cliccabile: !!el && (el === input || input.contains(el)),
  };
};

const fuori = (m) => {
  if (!m) return ['riquadro sparito'];
  const out = [];
  if (m.bottom > m.vh + 1) out.push(`fondo fuori di ${Math.round(m.bottom - m.vh)} (vh=${m.vh})`);
  if (m.top < -1) out.push(`cima fuori di ${Math.round(-m.top)}`);
  if (m.left < -1) out.push(`sinistra fuori di ${Math.round(-m.left)}`);
  if (m.right > m.vw + 1) out.push(`destra fuori di ${Math.round(m.right - m.vw)}`);
  if (m.inputBottom > m.vh + 1) out.push(`riga fuori sotto di ${Math.round(m.inputBottom - m.vh)}`);
  if (m.inputTop < -1) out.push(`riga fuori sopra di ${Math.round(-m.inputTop)}`);
  if (!m.cliccabile) out.push('riga per scrivere NON cliccabile');
  return out;
};

const PAGINA = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif}#riempi{height:78vh;padding:20px}#bersaglio{padding:0 20px}</style>
<div id="riempi">Testa della pagina.</div>
<p id="bersaglio">La parola supercalifragilistico sta in fondo alla finestra.</p>`;

// ── 1. La SECONDA strada della segnalazione: la freccetta dentro il riquadro
// del tasto destro. Deve comportarsi come Alt+E.
test('#502 freccetta del menu tasto destro su selezione in basso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await provider(app, { attesa: 1500 });

  await page.locator('#bersaglio').dblclick();
  await expect.poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');
  await page.locator('#bersaglio').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const arrow = page.locator('.sn-menu-inline-arrow');
  await expect(arrow, 'la freccetta di approfondimento non c\'è nel menu').toBeVisible({ timeout: 8000 });
  await arrow.click();

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  const vuoto = await page.evaluate(misura);
  expect(vuoto.height, 'la risposta è arrivata prima della misura da vuoto').toBeLessThan(350);

  const rotture = [];
  const fine = Date.now() + 25_000;
  let max = vuoto.height;
  while (Date.now() < fine) {
    const m = await page.evaluate(misura);
    if (!m) break;
    max = Math.max(max, m.height);
    const f = fuori(m);
    if (f.length) rotture.push(f);
    const t = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (t && t.includes('€')) break;
    await page.waitForTimeout(60);
  }
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  expect(max, 'il riquadro non è cresciuto: scenario non vero').toBeGreaterThan(vuoto.height + 100);
  expect(fuori(await page.evaluate(misura))).toEqual([]);
  expect(rotture.slice(0, 3)).toEqual([]);
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');
});

// ── 2. Conversazione che continua: domanda successiva lunga (auto-grow della
// casella) e seconda risposta. Il riquadro cresce due volte.
test('#502 domanda successiva lunga e seconda risposta: resta dentro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await provider(app, { attesa: 200 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'parola', sentence: 'frase' },
    anchor: { x: 120, y: Math.round(window.innerHeight * 0.8) },
    title: 'Approfondisci',
  }));
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  expect(fuori(await page.evaluate(misura))).toEqual([]);

  // Domanda lunga: la casella cresce fino al suo tetto (120px).
  const input = page.locator('.sn-popup .sn-popup-input');
  await input.click();
  await input.fill('riga\n'.repeat(40));
  await page.waitForTimeout(200);
  expect(fuori(await page.evaluate(misura)), 'la casella cresciuta ha spinto il riquadro fuori').toEqual([]);

  await input.press('Shift+Enter');
  await input.fill('e questo?');
  await input.press('Enter');
  await expect(page.locator('.sn-popup .sn-msg-user')).toHaveCount(1, { timeout: 5000 });
  const rotture = [];
  const fine = Date.now() + 25_000;
  while (Date.now() < fine) {
    const f = fuori(await page.evaluate(misura));
    if (f.length) rotture.push(f);
    const t = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (t && t.includes('€') && (await page.locator('.sn-popup .sn-msg-assistant').count()) >= 2) break;
    await page.waitForTimeout(60);
  }
  expect(rotture.slice(0, 3), 'durante il secondo turno il riquadro è uscito').toEqual([]);
  expect(fuori(await page.evaluate(misura))).toEqual([]);
});

// ── 3. Punti ancorati estremi + due riquadri aperti insieme.
test('#502 ancora al bordo estremo e due riquadri insieme', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await provider(app, { attesa: 200 });

  for (const y of ['fondo', 'cima', 'oltre']) {
    await page.evaluate((k) => {
      document.querySelectorAll('.sn-popup').forEach((el) => el.querySelector('.sn-popup-close')?.click());
      const vh = window.innerHeight;
      const yy = k === 'fondo' ? vh : (k === 'cima' ? 0 : vh + 900);
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'x', sentence: 'y' },
        anchor: { x: k === 'oltre' ? -400 : 10, y: yy },
        title: 'Approfondisci',
      });
    }, y);
    await page.waitForSelector('.sn-popup', { timeout: 8000 });
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
    await page.waitForTimeout(200);
    expect(fuori(await page.evaluate(misura)), `ancora ${y}`).toEqual([]);
  }

  // Due riquadri aperti insieme, tutti e due in basso.
  await page.evaluate(() => {
    document.querySelectorAll('.sn-popup').forEach((el) => el.querySelector('.sn-popup-close')?.click());
    for (const y of [0.7, 0.9]) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'x', sentence: 'y' },
        anchor: { x: 120, y: Math.round(window.innerHeight * y) },
        title: 'Approfondisci',
      });
    }
  });
  await expect(page.locator('.sn-popup')).toHaveCount(2);
  await page.waitForTimeout(6000);
  const tutti = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-popup')).map((root) => {
    const i = root.querySelector('.sn-popup-input').getBoundingClientRect();
    const r = root.getBoundingClientRect();
    return { vh: window.innerHeight, vw: window.innerWidth, top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, inputTop: i.top, inputBottom: i.bottom, cliccabile: true };
  }));
  for (const m of tutti) expect(fuori(m), 'uno dei due riquadri è fuori').toEqual([]);
});

// ── 4. Aperture e chiusure rapide in sequenza, poi una vera.
test('#502 apri/chiudi ripetuto non lascia il riquadro fuori posto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await provider(app, { attesa: 200 });
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'x', sentence: 'y' },
        anchor: { x: 120, y: Math.round(window.innerHeight * 0.85) },
        title: 'Approfondisci',
      });
      document.querySelector('.sn-popup .sn-popup-close').click();
    });
  }
  await expect(page.locator('.sn-popup')).toHaveCount(0);
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'x', sentence: 'y' },
    anchor: { x: 120, y: Math.round(window.innerHeight * 0.85) },
    title: 'Approfondisci',
  }));
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await page.waitForTimeout(200);
  expect(fuori(await page.evaluate(misura))).toEqual([]);
});

// ── 5. Contenuto ostile e ingombrante: 10k caratteri, emoji, HTML, parola
// lunghissima senza spazi (larghezza), marcatori di script.
test('#502 risposta ostile: 10k caratteri, emoji, HTML, parola infinita', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  const ostile = '😀🔥'.repeat(200)
    + '<img src=x onerror="window.__pwn502=1">'
    + '<script>window.__pwn502b=1<\/script>'
    + '[link](javascript:window.__pwn502c=1) '
    + 'A'.repeat(3000) + ' '
    + 'testo normale '.repeat(400);
  await provider(app, { attesa: 200, testo: ostile });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'x', sentence: 'y' },
    anchor: { x: 120, y: Math.round(window.innerHeight * 0.8) },
    title: 'Approfondisci',
  }));
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 25_000 });
  await page.waitForTimeout(400);
  expect(fuori(await page.evaluate(misura)), 'contenuto ostile: riquadro fuori').toEqual([]);
  const pwn = await page.evaluate(() => [!!window.__pwn502, !!window.__pwn502b, !!window.__pwn502c,
    !!document.querySelector('.sn-popup script'), !!document.querySelector('.sn-popup a[href^="javascript:"]')]);
  expect(pwn, 'contenuto della risposta eseguito come HTML').toEqual([false, false, false, false, false]);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifier-502-ostile.png' }); } catch (_) {}
});

// ── 6. Zoom mentre il riquadro è stato trascinato dall'utente.
test('#502 trascinato + finestra accorciata: resta dentro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await provider(app, { attesa: 200 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'x', sentence: 'y' },
    anchor: { x: 120, y: Math.round(window.innerHeight * 0.5) },
    title: 'Approfondisci',
  }));
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  const hb = await page.locator('.sn-popup-header').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2 + 90, { steps: 8 });
  await page.mouse.up();
  const dopoDrag = await page.evaluate(misura);
  expect(fuori(dopoDrag), 'dopo il trascinamento è già fuori').toEqual([]);

  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: 420 });
  await expect.poll(async () => fuori(await page.evaluate(misura)), { timeout: 6000 }).toEqual([]);
  const finale = await page.evaluate(misura);
  expect(finale.height, 'trascinato + finestra bassa: il riquadro si è stirato').toBeLessThanOrEqual(finale.vh + 1);
});

// ── 7. Tema scuro: traccia visiva.
test('#502 tema scuro: traccia visiva', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await provider(app, { attesa: 200 });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'x', sentence: 'y' },
    anchor: { x: 120, y: Math.round(window.innerHeight * 0.75) },
    title: 'Approfondisci',
  }));
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await page.waitForTimeout(300);
  expect(fuori(await page.evaluate(misura))).toEqual([]);
  try { await page.screenshot({ path: 'tests/.shots/zz-verifier-502-scuro.png' }); } catch (_) {}
});
