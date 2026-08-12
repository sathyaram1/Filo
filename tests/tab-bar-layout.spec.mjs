// Suite accorpata: layout e estetica della striscia delle schede (tab bar).
//
// Unisce gli ex spec tab-labels / tab-active-width-chrome / tab-overflow-scroll
// in UN solo avvio di Electron. Sono test puramente di shell/CSS sulla tab bar:
// non scrivono storage persistente, l'unica superficie condivisa è l'elenco
// delle tab aperte. Un beforeEach chiude tutte le tab (il TabManager riapre una
// newtab fresca), così ogni test parte da una sola scheda "Home" attiva — la
// pre-condizione che alcuni di questi test assumono (es. toHaveCount(1)).
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arrivano `shell`/`openTab` (helper locali sull'app condivisa) e
// l'inquadramento in describe per file di provenienza.

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

let app = null;
let shell = null;
let userData = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; }
      catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTab: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// Prima di ogni test: chiudi tutte le tab della finestra principale (il
// TabManager riapre automaticamente una newtab fresca), così ogni test riparte
// da una sola scheda "Home" attiva — come con un'app appena lanciata.
test.beforeEach(async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 8_000 }).toBe(1);
});

// ─────────────────────────────── tab-labels ────────────────────────────────
test.describe('etichette delle schede', () => {
  test('la newtab si chiama "Home" (non "Filo — Nuova scheda")', async () => {
    const title = shell.locator('.tab.active .title');
    await expect(title).toHaveText('Home', { timeout: 8_000 });
  });

  test('le pagine interne usano il nome del tasto, senza prefisso "Filo —"', async () => {
    // Opzioni → "Modelli" (nome del tasto che la apre).
    await openTab('filo://options/options.html');
    await expect(shell.locator('.tab .title', { hasText: 'Modelli' })).toBeVisible({ timeout: 8_000 });

    await openTab('filo://security/security.html');
    await expect(shell.locator('.tab .title', { hasText: 'Sicurezza' })).toBeVisible({ timeout: 8_000 });

    await openTab('filo://preferences/preferences.html');
    await expect(shell.locator('.tab .title', { hasText: 'Preferenze' })).toBeVisible({ timeout: 8_000 });

    // Nessuna scheda mostra il prefisso "Filo —".
    const titles = await shell.locator('.tab .title').allTextContents();
    for (const t of titles) {
      expect(t, `la scheda "${t}" non deve contenere "Filo"`).not.toMatch(/Filo\s*[—–-]/i);
    }
  });
});

// ───────────────────────── tab-active-width-chrome ─────────────────────────
test.describe('larghezza e separatori stile Chrome', () => {
  test('la tab selezionata è più larga delle altre', async () => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

    // Apre qualche tab così che ce ne sia più d'una e una sia attiva.
    await openTab('filo://newtab/');
    await openTab('filo://newtab/');
    await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });
    await expect(shell.locator('.tab.active')).toHaveCount(1);

    // Attendi che il layout flex si assesti: subito dopo l'apertura la riga di
    // tab può misurare 0px per un frame (corsa di layout), falsando i confronti.
    await expect
      .poll(() => shell.locator('.tab.active').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(0);

    const widths = await shell.locator('.tab').evaluateAll((els) =>
      els.map((el) => ({
        active: el.classList.contains('active'),
        width: el.getBoundingClientRect().width,
      })),
    );

    const active = widths.find((w) => w.active);
    const inactive = widths.filter((w) => !w.active);
    expect(active).toBeTruthy();
    expect(inactive.length).toBeGreaterThan(0);

    // La tab attiva deve essere strettamente più larga di OGNI tab inattiva.
    for (const t of inactive) {
      expect(active.width).toBeGreaterThan(t.width);
    }
  });

  test('le tab si toccano e usano un separatore verticale in stile Chrome', async () => {
    await openTab('filo://newtab/');
    await openTab('filo://newtab/');
    await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });

    // Niente gap fra le tab: si toccano come in Chrome.
    const gap = await shell.locator('.tabs').evaluate(
      (el) => getComputedStyle(el).columnGap || getComputedStyle(el).gap,
    );
    expect(gap).toBe('0px');

    // Una tab inattiva NON ultima ha il separatore ::after visibile (largo 1px);
    // la tab attiva non lo ha (display:none).
    // Lettura atomica dentro la pagina: risolvere i nodi in un giro e leggerli
    // nel successivo (`evaluateAll`) li espone a un ridisegno della striscia,
    // che li stacca dal documento — e uno stile calcolato su un nodo staccato
    // torna vuoto, facendo fallire il test per un motivo che non c'entra.
    const probe = await shell.evaluate(() => {
      const els = [...document.querySelectorAll('#tabs .tab')];
      const result = { inactiveDivider: null, activeDivider: null };
      for (const el of els) {
        const after = getComputedStyle(el, '::after');
        const isActive = el.classList.contains('active');
        const isLast = el === els[els.length - 1];
        if (isActive) {
          result.activeDivider = { display: after.display, width: after.width };
        } else if (!isLast && result.inactiveDivider === null) {
          result.inactiveDivider = { display: after.display, width: after.width };
        }
      }
      return result;
    });

    // La scheda attiva non mostra la sottile linea verticale da 1px (al suo posto
    // ::after fa da piedino "a goccia", largo 8px — vedi test dedicato).
    expect(probe.activeDivider).toBeTruthy();
    expect(probe.activeDivider.width).not.toBe('1px');
    expect(probe.inactiveDivider).toBeTruthy();
    expect(probe.inactiveDivider.display).not.toBe('none');
    expect(probe.inactiveDivider.width).toBe('1px');
  });

  test('la scheda attiva ha le curve "a goccia" in stile Chrome', async () => {
    await openTab('filo://newtab/');
    await openTab('filo://newtab/');
    await expect(shell.locator('.tab.active')).toHaveCount(1, { timeout: 8_000 });
    await expect
      .poll(() => shell.locator('.tab.active').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(0);

    // I due piedini curvi sono pseudo-elementi ::before/::after sulla scheda
    // attiva: devono essere visibili (display block, 8px) e disegnati con un
    // radial-gradient (l'arco concavo che fonde la scheda con la barra).
    // Lettura atomica dentro la pagina (vedi nota nel test precedente).
    const feet = await shell.evaluate(() => {
      const el = document.querySelector('#tabs .tab.active');
      const read = (sel) => {
        const s = getComputedStyle(el, sel);
        return { display: s.display, width: s.width, bg: s.backgroundImage };
      };
      return { before: read('::before'), after: read('::after') };
    });

    for (const foot of [feet.before, feet.after]) {
      expect(foot.display).not.toBe('none');
      expect(foot.width).toBe('8px');
      expect(foot.bg).toContain('radial-gradient');
    }
  });
});

// ─────────────────── larghezze ferme dopo una chiusura ─────────────────────
// Chiudendo una scheda col puntatore sulla striscia, le superstiti devono
// restare della LORO larghezza (così la X della successiva finisce sotto il
// cursore e se ne possono chiudere più di fila); si riassestano solo quando il
// puntatore lascia la striscia.
test.describe('larghezze delle schede alla chiusura', () => {
  // Misura in UN solo passaggio nella pagina: `locator.evaluateAll` risolve
  // prima i nodi e poi li misura in un secondo giro, e fra i due un ridisegno
  // della striscia può averli staccati dal documento — un nodo staccato misura
  // 0 e il confronto diventa rumore.
  const widthsById = () => shell.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('#tabs .tab')) {
      out[el.dataset.id] = el.getBoundingClientRect().width;
    }
    return out;
  });

  // Apre `n` schede in più e aspetta che la striscia si sia ASSESTATA. Non
  // basta contare i nodi: finché le pagine caricano, al posto della favicon c'è
  // la rotella (slot più stretto) e la striscia — larga quanto il suo contenuto
  // — cambia misura sotto i piedi, falsando qualunque confronto di larghezze.
  // Quindi aspettiamo due misure identiche e non nulle di seguito.
  async function openMany(n) {
    await shell.evaluate((k) => {
      for (let i = 0; i < k; i++) window.filoShell.tabs.open('filo://newtab/');
    }, n);
    await expect.poll(
      () => shell.evaluate(() => document.querySelectorAll('#tabs .tab').length),
      { timeout: 15_000 },
    ).toBe(n + 1);
    let prev = null;
    await expect.poll(async () => {
      const cur = await widthsById();
      const vals = Object.values(cur);
      const ok = vals.length === n + 1 && vals.every((w) => w > 1)
        && prev !== null && JSON.stringify(cur) === prev;
      prev = JSON.stringify(cur);
      return ok;
    }, { timeout: 15_000, intervals: [250] }).toBe(true);
  }

  // Con poche schede la striscia è più corta dello spazio disponibile e ognuna
  // sta alla sua misura naturale: chiuderne una non ridimensiona nessuno. Il
  // caso del feedback è la striscia PIENA, dove le schede si spartiscono lo
  // spazio e ogni chiusura le riallarga tutte.
  const FULL = 14; // 15 schede: sotto la misura naturale, sopra il minimo

  test('col puntatore sulla striscia le schede superstiti non cambiano larghezza', async () => {
    await openMany(FULL);

    const before = await widthsById();
    const ids = Object.keys(before);
    expect(ids.length).toBe(FULL + 1);
    // Pre-condizione: la striscia è piena (le schede sono strette, non alla
    // loro misura naturale) — solo qui una chiusura le ridimensionerebbe.
    expect(Math.min(...Object.values(before))).toBeLessThan(80);

    // Chiudi una scheda inattiva cliccandone la X: il click porta davvero il
    // puntatore sulla striscia (è la situazione descritta nel feedback).
    const victim = ids[2];
    await shell.locator(`#tabs .tab[data-id="${victim}"] .close`).click();
    await expect.poll(
      () => shell.evaluate(() => document.querySelectorAll('#tabs .tab').length),
      { timeout: 8_000 },
    ).toBe(FULL);

    // Le superstiti conservano ESATTAMENTE la larghezza che avevano.
    const during = await widthsById();
    expect(Object.keys(during).sort()).toEqual(ids.filter((id) => id !== victim).sort());
    for (const id of Object.keys(during)) {
      expect(Math.abs(during[id] - before[id]),
        `la scheda ${id} si è ridimensionata mentre il puntatore era sulla striscia`,
      ).toBeLessThan(1);
    }

    // Uscendo dalla zona delle schede (la striscia è alta 40px) si riassestano:
    // con una scheda in meno ora sono più larghe.
    await shell.mouse.move(600, 300);
    await expect.poll(async () => {
      const after = await widthsById();
      const id = Object.keys(after)[0];
      return after[id] - before[id];
    }, { timeout: 8_000 }).toBeGreaterThan(1);
  });

  test('col puntatore fuori dalla striscia la chiusura riassesta subito', async () => {
    await openMany(FULL);
    await shell.mouse.move(600, 300); // puntatore sulla pagina, non sulle schede

    const before = await widthsById();
    const ids = Object.keys(before);
    const victim = ids[2];
    await shell.evaluate((id) => window.filoShell.tabs.close(id), victim);

    await expect.poll(async () => {
      const after = await widthsById();
      const id = ids.find((x) => x !== victim);
      return Object.keys(after).length === FULL ? after[id] - before[id] : 0;
    }, { timeout: 8_000 }).toBeGreaterThan(1);
  });
});

// ─────────────────────────── tab-overflow-scroll ───────────────────────────
test.describe('overflow della tab bar', () => {
  test('con molte tab la striscia scrolla e tiene in vista la tab attiva', async () => {
    // Apri molte schede interne (leggere) per superare la larghezza della barra.
    const N = 30;
    await shell.evaluate(async (n) => {
      for (let i = 0; i < n; i++) window.filoShell.tabs.open('filo://newtab/');
    }, N);

    // Aspetta che la shell abbia renderizzato abbastanza schede.
    await expect.poll(async () => shell.evaluate(
      () => document.querySelectorAll('#tabs .tab').length,
    ), { timeout: 15_000 }).toBeGreaterThanOrEqual(N);

    // La striscia è in overflow → è scrollabile (non clippata).
    const dims = await shell.evaluate(() => {
      const tabsEl = document.getElementById('tabs');
      return { scrollW: tabsEl.scrollWidth, clientW: tabsEl.clientWidth };
    });
    expect(dims.scrollW).toBeGreaterThan(dims.clientW);

    // La scheda attiva (l'ultima aperta) è effettivamente in vista nella striscia.
    await expect.poll(async () => shell.evaluate(() => {
      const tabsEl = document.getElementById('tabs');
      const active = tabsEl.querySelector('.tab.active');
      if (!active) return false;
      const a = active.getBoundingClientRect();
      const c = tabsEl.getBoundingClientRect();
      // tollera 2px di arrotondamento
      return a.left >= c.left - 2 && a.right <= c.right + 2;
    }), { timeout: 8_000 }).toBe(true);
  });
});
