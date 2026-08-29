// Verifica avversariale #495 — secondo giro: ricerca, azioni in blocco,
// leggibilità del numero sui due temi.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status, extra) {
  return {
    _id: id,
    text: `Feedback ${id}`,
    name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-20T10:00:00Z',
    images: [],
    status,
    ...(extra || {}),
  };
}

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  return page;
}

const tab = (page, name) => page.locator(`.mg-tab[data-tab="${name}"]`);

// Contrasto WCAG fra due colori rgb() risolti dal browser.
function contrasto(fgRgb, bgRgb) {
  const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(parse(fgRgb));
  const b = lum(parse(bgRgb));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// 1 ── La ricerca è una lista come le altre: deve dire quanti risultati ha.
test('#495/vfx2 — anche i risultati di ricerca portano il loro numero', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled', { name: 'la barra è lenta' }),
    fb('i2', 'unlabeled', { name: 'il menu non si apre' }),
    fb('q1', 'todo', { name: 'la barra sparisce' }),
  ]);

  // Il modello risponde senza rete: conta cosa finisce sullo schermo.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'manage_search') return { ok: true, ids: ['i1', 'q1'] };
      if (msg && String(msg.type || '').includes('search')) return { ok: true, ids: ['i1', 'q1'] };
      return orig(msg);
    };
  });

  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('barra');
  await page.locator('#mgSearchInput').press('Enter');

  await expect(page.locator('#mgList .mg-item')).toHaveCount(2, { timeout: 15000 });
  const testa = await page.locator('#mgListHead').innerText();
  expect(testa, 'intestazione della lista di ricerca').toMatch(/\(2\)/);
});

// 2 ── "Approva tutti gli allineati": sposta N feedback in un colpo. I due
//      numeri devono muoversi insieme.
test('#495/vfx2 — l\'approvazione in blocco muove entrambi i numeri', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  const blu = (id) => fb(id, 'aligned', { pipeline: { l2Class: 'aligned', verdicts: [{ class: 'aligned' }] } });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    blu('a1'), blu('a2'), blu('a3'), fb('q1', 'todo'),
  ]);
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (3)');
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');

  const barra = page.locator('#mgAlignedBar');
  if (await barra.isVisible()) {
    await page.locator('#mgAlignedBtn').click();
    await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)', { timeout: 20000 });
    await expect(tab(page, 'queue')).toHaveText('In coda (4)');
  }
});

// 3 ── "Accetta e sblocca" su un bloccato: da Ricevuti a In coda, subito.
test('#495/vfx2 — sbloccare un feedback aggiorna i numeri all\'istante', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('s1', 'spam'), fb('q1', 'todo'),
  ]);
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.locator('#mgList .mg-item').first().click();
  const bottone = page.locator('#mgAcceptBtn');
  if (await bottone.isVisible()) {
    await bottone.click();
    await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)', { timeout: 15000 });
    await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  }
});

// 4 ── Il numero si deve LEGGERE, su entrambi i temi, anche sulle schede
//      non attive: sono proprio quelle per cui l'owner l'ha chiesto.
test('#495/vfx2 — leggibilità del numero sui due temi', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('q1', 'todo'),
    fb('r1', 'done'), fb('z1', 'archived'),
  ]);

  const misura = async (tema) => {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/495-barra-${tema}.png` });
    return page.evaluate(() => {
      const sfondo = getComputedStyle(document.body).backgroundColor;
      const leggi = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return { color: cs.color, opacity: Number(cs.opacity), size: cs.fontSize };
      };
      return {
        sfondo,
        numeroInattivo: leggi('.mg-tab[data-tab="queue"] .mg-tab-count'),
        nomeInattivo: leggi('.mg-tab[data-tab="queue"]'),
        numeroAttivo: leggi('.mg-tab[data-tab="inbox"] .mg-tab-count'),
      };
    });
  };

  for (const tema of ['light', 'dark']) {
    const m = await misura(tema);
    // Il colore risolto è già rgb(); l'opacity va composta a mano sul fondo.
    const fondi = m.sfondo.match(/[\d.]+/g).slice(0, 3).map(Number);
    const componi = (c, a) => {
      const v = c.match(/[\d.]+/g).slice(0, 3).map(Number);
      return `rgb(${v.map((x, i) => Math.round(a * x + (1 - a) * fondi[i])).join(',')})`;
    };
    const cNum = contrasto(componi(m.numeroInattivo.color, m.numeroInattivo.opacity), m.sfondo);
    const cNome = contrasto(componi(m.nomeInattivo.color, m.nomeInattivo.opacity), m.sfondo);
    console.log(`[${tema}] numero inattivo ${cNum.toFixed(2)}:1 (${m.numeroInattivo.size}) — nome ${cNome.toFixed(2)}:1`);
    // Soglia minima assoluta: sotto 3:1 un testo piccolo non si legge.
    expect(cNum, `contrasto del numero, tema ${tema}`).toBeGreaterThan(3);
  }
});
