// #498 — verifica avversariale: «espandi le aree, fai partire le sezioni
// (ricevuti, in coda…) un poco più in alto».
//
// Si riprova il sintomo dell'utente e le porte già trovate nei giri passati
// (il riquadro delle fusioni in attesa che schiacciava le aree; la barra di
// ricerca appiccicata alla riga delle sezioni), poi si cerca dove il "prenditi
// quello che avanza" può ancora rompersi: finestre basse, zoom, tutto acceso
// insieme, le altre schede.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
  await new Promise((r) => setTimeout(r, 400));
}

function richiestaFinta(i) {
  return {
    id: `req-${i}`,
    branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`,
    origin: 'routine',
    feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000,
    expiresAtMs: Date.now() + 6 * 86400_000,
    blocks: [
      { kind: 'protected-paths', items: ['src/main/main.js', 'package.json'] },
      { kind: 'workflow', items: ['.github/workflows/release.yml'] },
    ],
  };
}

async function geom(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const grid = document.getElementById('mgReviewGrid');
    const tabs = document.getElementById('mgTabs');
    const blocco = document.getElementById('mgMergeApprovals');
    const r = grid.getBoundingClientRect();
    return {
      tabsTop: Math.round(tabs.getBoundingClientRect().top),
      gridTop: Math.round(r.top),
      gridH: Math.round(r.height),
      gridBottom: Math.round(r.bottom),
      bloccoH: blocco.hidden ? 0 : Math.round(blocco.getBoundingClientRect().height),
      bloccoScrollH: blocco.hidden ? 0 : blocco.scrollHeight,
      viewport: doc.clientHeight,
      scrollH: doc.scrollHeight,
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
    };
  });
}

async function preparaOwner(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
}

async function mettiFusioni(page, quante) {
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, Array.from({ length: quante }, (_, i) => richiestaFinta(i)));
  await page.waitForTimeout(250);
}

// ── 1. Il sintomo, su finestre di altezze diverse ────────────────────────
test('le sezioni partono in alto e le aree riempiono la finestra a ogni altezza', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);

  for (const [w, h] of [[1280, 900], [1100, 700], [1000, 600], [900, 520], [820, 420]]) {
    await setSize(app, w, h);
    const g = await geom(page);
    expect(g.tabsTop, `${w}x${h}: le sezioni non partono in alto`).toBeLessThanOrEqual(20);
    expect(g.scrollW, `${w}x${h}: sbordo laterale`).toBeLessThanOrEqual(g.clientW + 1);
    // Sotto una certa altezza il minimo delle aree (300px) è più della finestra:
    // lì scorrere è legittimo. Sopra, no.
    if (h >= 600) {
      expect(g.scrollH, `${w}x${h}: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 1);
      expect(g.viewport - g.gridBottom, `${w}x${h}: vuoto in fondo`).toBeLessThanOrEqual(28);
    }
  }
  await setSize(app, 1280, 900);
});

// ── 2. Le fusioni in attesa: la porta chiusa al giro scorso ───────────────
test('con le fusioni in attesa le aree restano intere, anche su finestra bassa', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);

  for (const [w, h] of [[1280, 900], [1100, 700], [1000, 620]]) {
    await setSize(app, w, h);
    await mettiFusioni(page, 0);
    const senza = (await geom(page)).gridH;

    for (const quante of [1, 2, 3, 8, 20]) {
      await mettiFusioni(page, quante);
      const g = await geom(page);
      expect(g.scrollH, `${w}x${h}, ${quante} fusioni: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 1);
      expect(g.gridBottom, `${w}x${h}, ${quante} fusioni: le aree escono`).toBeLessThanOrEqual(g.viewport + 1);
      expect(g.gridH, `${w}x${h}, ${quante} fusioni: aree schiacciate`).toBeGreaterThan(senza / 2);
      // Niente sparisce: se il riquadro è tagliato, si raggiunge scorrendo.
      if (g.bloccoScrollH > g.bloccoH + 1) {
        const arrivaInFondo = await page.evaluate(() => {
          const b = document.getElementById('mgMergeApprovals');
          b.scrollTop = b.scrollHeight;
          return b.scrollTop > 0 && b.scrollTop + b.clientHeight >= b.scrollHeight - 2;
        });
        expect(arrivaInFondo, `${w}x${h}, ${quante} fusioni: il riquadro non scorre fino in fondo`).toBe(true);
        await page.evaluate(() => { document.getElementById('mgMergeApprovals').scrollTop = 0; });
      }
    }
  }
  await setSize(app, 1280, 900);
});

// ── 3. L'ultima richiesta del riquadro è raggiungibile e cliccabile ───────
test('con molte fusioni in attesa i pulsanti dell ultima si raggiungono', async ({ openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);
  await mettiFusioni(page, 8);

  const info = await page.evaluate(() => {
    const b = document.getElementById('mgMergeApprovals');
    b.scrollTop = b.scrollHeight;
    const bottoni = b.querySelectorAll('button');
    const ultimo = bottoni[bottoni.length - 1];
    if (!ultimo) return { bottoni: 0 };
    const r = ultimo.getBoundingClientRect();
    const box = b.getBoundingClientRect();
    return {
      bottoni: bottoni.length,
      dentro: r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      inFinestra: r.bottom <= document.documentElement.clientHeight + 1 && r.top >= 0,
    };
  });
  expect(info.bottoni, 'nessun pulsante nelle richieste in attesa').toBeGreaterThan(0);
  expect(info.dentro, 'scorrendo in fondo l ultima richiesta resta tagliata').toBe(true);
  expect(info.inFinestra, 'l ultima richiesta cade fuori dalla finestra').toBe(true);
});

// ── 4. Tutto acceso insieme: banner + riga «niente sezioni» + ricerca + fusioni
test('banner, riga di stato, ricerca e fusioni insieme non fanno scorrere la pagina', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);
  await setSize(app, 1200, 800);

  await page.evaluate(() => {
    document.getElementById('mgBanner').hidden = false;
    const p = document.getElementById('mgNoSections');
    p.hidden = false;
    p.textContent = 'Le sezioni non si disegnano: su questo computer manca la chiave.';
  });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await mettiFusioni(page, 4);
  await page.waitForTimeout(200);

  const g = await geom(page);
  expect(g.scrollH, 'tutto acceso: la pagina scrolla').toBeLessThanOrEqual(g.viewport + 1);
  expect(g.gridBottom, 'tutto acceso: le aree escono dalla finestra').toBeLessThanOrEqual(g.viewport + 1);
  expect(g.gridH, 'tutto acceso: aree ridotte a niente').toBeGreaterThan(250);
  await page.screenshot({ path: 'tests/.shots/v498-g11-tutto-acceso.png' });
  await setSize(app, 1280, 900);
});

// ── 5. Lo stacco della ricerca, con e senza banner, e a schede andate a capo
test('la barra di ricerca resta staccata anche a finestra stretta e col banner', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);

  for (const [w, h, banner] of [[1280, 900, false], [1280, 900, true], [700, 800, false], [560, 800, false]]) {
    await setSize(app, w, h);
    await page.evaluate((v) => { document.getElementById('mgBanner').hidden = !v; }, banner);
    const aperta = await page.locator('#mgSearchBar').isVisible();
    if (!aperta) await page.locator('#mgSearchToggle').click();
    await expect(page.locator('#mgSearchBar')).toBeVisible();

    const s = await page.evaluate(() => {
      const t = document.getElementById('mgTabs').getBoundingClientRect();
      const b = document.getElementById('mgSearchBar').getBoundingClientRect();
      const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
      return { sopra: Math.round(b.top - t.bottom), sotto: Math.round(g.top - b.bottom) };
    });
    expect(s.sopra, `${w}x${h} banner=${banner}: campo appiccicato alla riga`).toBeGreaterThanOrEqual(6);
    expect(s.sopra, `${w}x${h} banner=${banner}: sopra più largo di sotto`).toBeLessThan(s.sotto);
  }
  await setSize(app, 1280, 900);
});

// ── 6. Le altre schede: contenuto lungo, la pagina deve poter scorrere ────
test('le schede senza aree scorrono ancora quando il contenuto è lungo', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);
  await setSize(app, 1200, 700);

  for (const tab of ['stats', 'support', 'auto', 'log']) {
    const btn = page.locator(`.mg-tab[data-tab="${tab}"]`);
    if (!(await btn.count())) continue;
    if (!(await btn.isVisible())) continue;
    await btn.click();
    await page.waitForTimeout(300);
    const g = await page.evaluate(() => {
      const doc = document.documentElement;
      const attivo = document.querySelector('.mg-panel--active');
      const r = attivo ? attivo.getBoundingClientRect() : null;
      return {
        id: attivo ? attivo.id : null,
        panelH: r ? Math.round(r.height) : 0,
        panelBottom: r ? Math.round(r.bottom) : 0,
        viewport: doc.clientHeight,
        scrollH: doc.scrollHeight,
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
      };
    });
    // Se il contenuto è più alto della finestra la pagina deve scorrere fino
    // in fondo: nessun pezzo tagliato via da un contenitore senza scorrimento.
    if (g.scrollH > g.viewport + 1) {
      const arriva = await page.evaluate(() => {
        const doc = document.documentElement;
        doc.scrollTop = doc.scrollHeight;
        return doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 2;
      });
      expect(arriva, `scheda ${tab}: la pagina non scorre fino in fondo`).toBe(true);
      await page.evaluate(() => { document.documentElement.scrollTop = 0; });
    }
    expect(g.scrollW, `scheda ${tab}: sbordo laterale`).toBeLessThanOrEqual(g.clientW + 1);
    expect(g.panelBottom, `scheda ${tab}: pannello vuoto`).toBeGreaterThan(0);
  }
  await setSize(app, 1280, 900);
});

// ── 7. Cambio scheda avanti e indietro col riquadro delle fusioni acceso ──
test('passando fra le sezioni le aree tornano intere e non restano schiacciate', async ({ openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);

  const pieno = (await geom(page)).gridH;
  await mettiFusioni(page, 3);
  const conFusioni = (await geom(page)).gridH;
  expect(conFusioni).toBeLessThan(pieno);

  await page.locator('.mg-tab[data-tab="queue"]').click();
  await page.waitForTimeout(250);
  const inCoda = await geom(page);
  expect(inCoda.gridH, 'In coda: le aree non tornano intere').toBeGreaterThanOrEqual(pieno - 4);
  expect(inCoda.scrollH).toBeLessThanOrEqual(inCoda.viewport + 1);

  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await page.waitForTimeout(250);
  const tornato = await geom(page);
  expect(tornato.scrollH, 'tornando ai Ricevuti la pagina scrolla').toBeLessThanOrEqual(tornato.viewport + 1);
  expect(tornato.gridBottom).toBeLessThanOrEqual(tornato.viewport + 1);
});

// ── 8. Zoom della pagina, col riquadro acceso ────────────────────────────
test('lo zoom non fa uscire le aree né tornare lo scorrimento', async ({ openTab }) => {
  const page = await openTab(URL);
  await preparaOwner(page);
  await mettiFusioni(page, 3);

  for (const z of [-2, -1, 0, 1, 2, 3]) {
    await page.evaluate((v) => {
      require('electron').webFrame.setZoomLevel(v);
    }, z).catch(async () => {
      await page.keyboard.press(z > 0 ? 'Control+=' : 'Control+-');
    });
    await page.waitForTimeout(300);
    const g = await geom(page);
    expect(g.scrollH, `zoom ${z}: la pagina scrolla`).toBeLessThanOrEqual(g.viewport + 2);
    expect(g.gridBottom, `zoom ${z}: le aree escono`).toBeLessThanOrEqual(g.viewport + 2);
    expect(g.scrollW, `zoom ${z}: sbordo laterale`).toBeLessThanOrEqual(g.clientW + 2);
    expect(g.gridH, `zoom ${z}: aree a niente`).toBeGreaterThan(150);
  }
});
