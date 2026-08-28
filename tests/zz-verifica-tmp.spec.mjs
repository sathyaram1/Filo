// VERIFICA #500 (spec temporaneo, da cancellare) — menu del tasto destro:
// 1. la spiegazione AI che arriva allunga il menu → il menu si sposta/scorre
//    invece di uscire dal fondo, e l'ultima voce resta intera e cliccabile;
// 2. menu più alto della finestra → scorrevole, si legge fino in fondo;
// 3. letta la spiegazione fino in fondo, un giro di rotella in più NON porta
//    via il menu (menu su immagine: keepOnScroll è falso, quindi uno scroll di
//    pagina lo chiuderebbe);
// 4. finestra rimpicciolita a menu aperto → il menu rientra;
// 5. pannelli ed etichette agganciati al menu lo seguono quando si sposta.

import { test, expect } from './fixtures/electron.mjs';

// Provider finto nel processo main: risponde dopo `attesaMs` con un testo di
// `ripetizioni` frasi che finisce con "SPIEGONE FINE" (marcatore d'arrivo).
async function preparaProvider(app, { attesaMs = 2000, ripetizioni = 12 } = {}) {
  await app.evaluate(async (_electron, opts) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'flash-lite-3',
        [C.ACTIONS.DESCRIBE_IMAGE]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const testo = Array.from({ length: opts.ripetizioni }, (_, i) =>
      `Frase ${i + 1}: una spiegazione lunga e distesa del termine selezionato, con abbastanza parole da mandare a capo il riquadro stretto del menu piu volte. `,
    ).join('') + ' SPIEGONE FINE';
    globalThis.__origGemVerifica = globalThis.SN_PROVIDER_GEMINI;
    const risposta = async ({ onDelta }) => {
      await new Promise((r) => setTimeout(r, opts.attesaMs));
      if (onDelta) onDelta(testo);
      return { text: testo, usage: {} };
    };
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__origGemVerifica,
      streamComplete: risposta,
      complete: risposta,
    };
  }, { attesaMs, ripetizioni });
}

async function ripristinaProvider(app) {
  await app.evaluate(() => {
    if (globalThis.__origGemVerifica) globalThis.SN_PROVIDER_GEMINI = globalThis.__origGemVerifica;
  });
}

// Pagina con un bersaglio selezionabile in basso e tanto corpo scorrevole.
const PAGINA_SELEZIONE = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  #riempitivo { height: 260vh; padding: 20px; }
  #bersaglio { position: fixed; left: 40px; top: 82vh; font-size: 18px; margin: 0; }
</style>
<div id="riempitivo">Testo di contorno per dare corpo alla pagina.</div>
<p id="bersaglio">metempsicosi corporativa</p>`;

// PNG 1x1 rosso come data URI (fetch(data:) funziona, niente rete).
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PAGINA_IMMAGINE = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  #riempitivo { height: 260vh; padding: 20px; }
  #foto { position: fixed; left: 40px; top: 70vh; width: 140px; height: 100px; }
</style>
<div id="riempitivo">Testo di contorno per dare corpo alla pagina.</div>
<img id="foto" src="${PNG_1PX}" alt="una foto di prova">`;

async function seleziona(page) {
  await page.evaluate(() => {
    const p = document.querySelector('#bersaglio');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// Misura del menu principale (non il sotto-menu).
const misuraMenu = () => {
  const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  const cs = getComputedStyle(m);
  return {
    vh: window.innerHeight, vw: window.innerWidth,
    top: r.top, bottom: r.bottom, height: r.height,
    scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight,
    overflowY: cs.overflowY, overscroll: cs.overscrollBehaviorY || cs.overscrollBehavior,
    pageScrollY: window.scrollY,
  };
};

// L'ultima voce del menu (in fondo di tutto): intera, dentro lo schermo, e il
// punto al suo centro colpisce davvero lei. Se il menu scorre, prima si va in
// fondo — come farebbe l'utente.
const ultimaVoceCliccabile = () => {
  const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
  if (!m) return { ok: false, perche: 'menu assente' };
  if (m.scrollHeight > m.clientHeight + 1) m.scrollTop = m.scrollHeight;
  const items = m.querySelectorAll('.sn-menu-item');
  const last = items[items.length - 1];
  if (!last) return { ok: false, perche: 'nessuna voce' };
  const r = last.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  const dentroSchermo = r.top >= -1 && r.bottom <= window.innerHeight + 1;
  const intera = r.top >= mr.top - 1 && r.bottom <= mr.bottom + 1 && r.height > 10;
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const colpita = !!el && (el === last || last.contains(el));
  return {
    ok: dentroSchermo && intera && colpita,
    dentroSchermo, intera, colpita,
    label: (last.textContent || '').trim(),
    bottom: Math.round(r.bottom), vh: window.innerHeight,
  };
};

async function apriMenuSuSelezione(page) {
  await seleziona(page);
  await page.locator('#bersaglio').click({ button: 'right' });
  const menu = page.locator('.sn-menu:not(.sn-menu-sub)');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  return menu;
}

async function altezzaFinestra(page, px) {
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: px });
}

// ── 1. La spiegazione arriva e allunga il menu: resta dentro, ultima voce ok ──
test('selezione in basso: la spiegazione allunga il menu ma il fondo resta dentro e l\'ultima voce si clicca', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_SELEZIONE);
  await preparaProvider(app, { attesaMs: 2500, ripetizioni: 10 });

  const menu = await apriMenuSuSelezione(page);
  const daVuoto = await page.evaluate(misuraMenu);
  expect(daVuoto).not.toBeNull();

  // La spiegazione non deve essere già arrivata: la crescita è la scena del difetto.
  const testoIniziale = await menu.locator('.sn-menu-inline').textContent();
  expect(testoIniziale).not.toContain('SPIEGONE FINE');

  // Arriva la spiegazione…
  await expect(menu.locator('.sn-menu-inline')).toContainText('SPIEGONE FINE', { timeout: 15_000 });

  // …e il menu è cresciuto davvero (scenario vero).
  await expect.poll(async () => (await page.evaluate(misuraMenu)).height, { timeout: 5000 })
    .toBeGreaterThan(daVuoto.height + 80);

  // SUCCESSO: il fondo del menu è dentro la finestra…
  await expect.poll(async () => {
    const m = await page.evaluate(misuraMenu);
    return m ? m.bottom - m.vh : 999;
  }, { timeout: 5000, message: 'il fondo del menu è fuori dalla finestra' }).toBeLessThanOrEqual(1);
  const m = await page.evaluate(misuraMenu);
  expect(m.top).toBeGreaterThanOrEqual(-1);

  // …e l'ultima voce è intera e cliccabile.
  const esito = await page.evaluate(ultimaVoceCliccabile);
  expect(esito, `ultima voce non usabile: ${JSON.stringify(esito)}`).toMatchObject({ ok: true });

  // Cliccarla la esegue davvero: il menu si chiude (comportamento di ogni voce).
  await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    if (menu.scrollHeight > menu.clientHeight + 1) menu.scrollTop = menu.scrollHeight;
  });
  const lastItem = menu.locator('.sn-menu-item').last();
  await lastItem.click();
  await expect(page.locator('.sn-menu:not(.sn-menu-sub)')).toHaveCount(0);

  await ripristinaProvider(app);
});

// ── 2. Menu più alto della finestra: scorre, e in fondo c'è l'ultima voce ──
for (const altezza of [420, 280]) {
test(`finestra bassa (${altezza}px): il menu diventa scorrevole e l'ultima voce si raggiunge scorrendo`, async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_SELEZIONE);
  await altezzaFinestra(page, altezza);
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeLessThanOrEqual(altezza + 2);
  await preparaProvider(app, { attesaMs: 1500, ripetizioni: 40 });

  const menu = await apriMenuSuSelezione(page);
  await expect(menu.locator('.sn-menu-inline')).toContainText('SPIEGONE FINE', { timeout: 15_000 });

  // Lo scenario è quello vero: il contenuto del menu è più alto della finestra.
  await expect.poll(async () => {
    const m = await page.evaluate(misuraMenu);
    return m ? m.scrollHeight - m.vh : 0;
  }, { timeout: 5000, message: 'il menu non è più alto della finestra: scenario mancato' })
    .toBeGreaterThan(0);

  const m = await page.evaluate(misuraMenu);
  // SUCCESSO 1: il menu sta dentro (tetto d'altezza applicato) e scorre.
  expect(m.bottom, 'fondo del menu fuori dalla finestra bassa').toBeLessThanOrEqual(m.vh + 1);
  expect(m.top).toBeGreaterThanOrEqual(-1);
  expect(m.scrollHeight).toBeGreaterThan(m.clientHeight + 1);
  expect(m.overflowY).toBe('auto');

  // SUCCESSO 2: scorrendo fino in fondo, l'ultima voce è intera e cliccabile.
  const esito = await page.evaluate(ultimaVoceCliccabile);
  expect(esito, `ultima voce non usabile: ${JSON.stringify(esito)}`).toMatchObject({ ok: true });

  await ripristinaProvider(app);
});

// ── 3. Rotella in più a fine spiegazione: il menu non se ne va ──
// Menu su IMMAGINE: senza selezione keepOnScroll è falso, quindi se la rotella
// "scappa" alla pagina lo scroll di pagina chiude il menu — è il caso peggiore.
test('menu su immagine, letto fino in fondo: un giro di rotella in più non porta via il menu', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_IMMAGINE);
  await altezzaFinestra(page, 420);
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeLessThanOrEqual(420);
  await preparaProvider(app, { attesaMs: 1200, ripetizioni: 40 });

  await page.locator('#foto').click({ button: 'right' });
  const menu = page.locator('.sn-menu:not(.sn-menu-sub)');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toContainText('SPIEGONE FINE', { timeout: 20_000 });

  // Il menu è scorrevole (più alto della finestra).
  await expect.poll(async () => {
    const m = await page.evaluate(misuraMenu);
    return m ? m.scrollHeight - m.clientHeight : 0;
  }, { timeout: 5000 }).toBeGreaterThan(1);

  // Rotella VERA sopra il menu, fino in fondo.
  const box = await menu.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2));
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 300);
    const m = await page.evaluate(misuraMenu);
    if (!m) break;
    if (m.scrollTop + m.clientHeight >= m.scrollHeight - 2) break;
    await page.waitForTimeout(30);
  }
  const inFondo = await page.evaluate(misuraMenu);
  expect(inFondo, 'il menu è sparito mentre si scorreva la spiegazione').not.toBeNull();
  expect(inFondo.scrollTop + inFondo.clientHeight).toBeGreaterThanOrEqual(inFondo.scrollHeight - 2);

  // Il giro (anzi tre) di rotella IN PIÙ: il menu deve restare, la pagina ferma.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);

  const dopo = await page.evaluate(misuraMenu);
  expect(dopo, 'la rotella in più ha portato via il menu').not.toBeNull();
  expect(dopo.pageScrollY, 'lo scroll è scappato alla pagina sotto il menu').toBe(0);
  await expect(menu).toBeVisible();

  // E l'ultima voce resta cliccabile anche adesso.
  const esito = await page.evaluate(ultimaVoceCliccabile);
  expect(esito, `ultima voce non usabile: ${JSON.stringify(esito)}`).toMatchObject({ ok: true });

  await ripristinaProvider(app);
});

// ── 4. Finestra rimpicciolita a menu aperto: il menu rientra ──
test('finestra rimpicciolita a menu aperto: il menu rientra e l\'ultima voce resta raggiungibile', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_SELEZIONE);
  await preparaProvider(app, { attesaMs: 800, ripetizioni: 14 });

  const menu = await apriMenuSuSelezione(page);
  await expect(menu.locator('.sn-menu-inline')).toContainText('SPIEGONE FINE', { timeout: 15_000 });
  const prima = await page.evaluate(misuraMenu);
  expect(prima.bottom).toBeLessThanOrEqual(prima.vh + 1);

  // La finestra si accorcia sotto il menu posato.
  const nuovaAltezza = Math.max(320, Math.round(prima.height * 0.6));
  await altezzaFinestra(page, nuovaAltezza);
  // Tolleranza di 2px: setViewportSize può arrotondare per il DPI scaling.
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeLessThanOrEqual(nuovaAltezza + 2);

  // SUCCESSO: il menu rientra da solo (si sposta e/o si dà un tetto e scorre).
  await expect.poll(async () => {
    const m = await page.evaluate(misuraMenu);
    if (!m) return 999;
    return m.bottom - m.vh;
  }, { timeout: 5000, message: 'accorciata la finestra, il menu è rimasto fuori' })
    .toBeLessThanOrEqual(1);
  const dopo = await page.evaluate(misuraMenu);
  expect(dopo.top).toBeGreaterThanOrEqual(-1);

  const esito = await page.evaluate(ultimaVoceCliccabile);
  expect(esito, `ultima voce non usabile dopo il ridimensionamento: ${JSON.stringify(esito)}`).toMatchObject({ ok: true });

  await ripristinaProvider(app);
});

// ── 5. Pannelli ed etichette agganciati seguono il menu che si sposta ──
test('pannello ancorato e tooltip: quando la spiegazione sposta il menu, il pannello segue e l\'etichetta non resta appesa', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_SELEZIONE);
  await preparaProvider(app, { attesaMs: 4500, ripetizioni: 14 });

  const menu = await apriMenuSuSelezione(page);

  // Apre il pannello "Altro…" (griglia icone) dalla riga in alto, pinnato col clic.
  const overflow = menu.locator('.sn-menu-row-overflow');
  await expect(overflow).toBeVisible();
  await overflow.click();
  const sub = page.locator('.sn-menu-sub');
  await expect(sub).toBeVisible();

  // Etichetta (tooltip) su un'icona della riga: compare dopo l'attesa di cortesia.
  const primaIcona = menu.locator('.sn-menu-row-btn').first();
  await primaIcona.hover();
  await expect(page.locator('.sn-tooltip')).toBeVisible({ timeout: 3000 });

  const posePrima = await page.evaluate(() => {
    const root = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    const sub = document.querySelector('.sn-menu-sub');
    const anchor = document.querySelector('.sn-menu-row-overflow');
    return {
      menuTop: root.getBoundingClientRect().top,
      subTop: sub.getBoundingClientRect().top,
      anchorTop: anchor.getBoundingClientRect().top,
    };
  });

  // Arriva la spiegazione: il menu cresce e scivola in su.
  await expect(menu.locator('.sn-menu-inline')).toContainText('SPIEGONE FINE', { timeout: 20_000 });
  await expect.poll(async () => {
    const t = await page.evaluate(() => document.querySelector('.sn-menu:not(.sn-menu-sub)')?.getBoundingClientRect().top);
    return t == null ? 0 : posePrima.menuTop - t;
  }, { timeout: 5000, message: 'il menu non si è spostato: scenario mancato (crescita senza scivolata)' })
    .toBeGreaterThan(20);

  // SUCCESSO 1: il pannello ancorato ha seguito la sua freccetta invece di
  // restare appeso a mezz'aria dov'era.
  await expect.poll(async () => {
    const d = await page.evaluate(() => {
      const sub = document.querySelector('.sn-menu-sub');
      const anchor = document.querySelector('.sn-menu-row-overflow');
      if (!sub || !anchor) return null;
      return Math.abs(sub.getBoundingClientRect().top - anchor.getBoundingClientRect().top);
    });
    // Se il pannello si è chiuso (ancora fuori dal bordo) va bene lo stesso:
    // l'importante è che NON galleggi staccato. Qui l'ancora resta visibile,
    // quindi pretendiamo che segua.
    return d;
  }, { timeout: 5000, message: 'il pannello ancorato non ha seguito il menu' })
    .toBeLessThanOrEqual(10);

  const poseDopo = await page.evaluate(() => {
    const sub = document.querySelector('.sn-menu-sub');
    return { subTop: sub ? sub.getBoundingClientRect().top : null };
  });
  expect(poseDopo.subTop, 'il pannello è rimasto fermo mentre il menu si spostava').not.toBe(posePrima.subTop);

  // SUCCESSO 2: l'etichetta non è rimasta appesa sopra un bottone che si è mosso.
  const tooltipVisibile = await page.evaluate(() => {
    const t = document.querySelector('.sn-tooltip');
    return !!t && t.style.display !== 'none';
  });
  expect(tooltipVisibile, 'l\'etichetta è rimasta appesa dopo lo spostamento del menu').toBe(false);

  await ripristinaProvider(app);
});
