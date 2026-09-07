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

    // La misura si ripete finché non cade su un disegno buono. Due motivi:
    // subito dopo l'apertura la riga di tab può misurare 0px per un frame
    // (corsa di layout), e la shell RICREA tutti i nodi .tab a ogni
    // aggiornamento (titolo, favicon, caricamento) — una lettura può quindi
    // finire su un nodo appena staccato, che misura zero.
    await expect.poll(async () => shell.locator('.tab').evaluateAll((els) => {
      const w = els.map((el) => ({
        active: el.classList.contains('active'),
        width: el.getBoundingClientRect().width,
      }));
      const active = w.find((x) => x.active);
      const inactive = w.filter((x) => !x.active);
      if (!active || !active.width || !inactive.length) return null;
      if (inactive.some((t) => !t.width)) return null;
      // La tab attiva deve essere strettamente più larga di OGNI tab inattiva.
      return inactive.every((t) => active.width > t.width);
    }).catch(() => null), { timeout: 8_000 }).toBe(true);
  });

  // #429 — con la barra mezza vuota i titoli restavano tagliati ("Cro…") perché
  // lo spazio veniva ripartito a proporzione fissa senza mai guardarli. Il test
  // verifica la cosa dal punto di vista di chi guarda: se nella barra avanza
  // spazio, il nome della scheda si legge per intero.
  test('con spazio libero nella barra nessun titolo resta tagliato', async () => {
    await openTab('filo://history/history.html');      // "Cronologia AI"
    await openTab('filo://preferences/preferences.html'); // "Preferenze"
    await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });

    // I titoli arrivano dopo il caricamento della pagina: aspetta che tutte e
    // tre le schede abbiano un nome e una larghezza vera prima di misurare.
    await expect.poll(() => shell.evaluate(() => {
      const els = [...document.querySelectorAll('#tabs .tab')];
      return els.length === 3
        && els.every((el) => el.getBoundingClientRect().width > 0
          && (el.querySelector('.title').textContent || '').trim().length > 0);
    }), { timeout: 8_000 }).toBe(true);

    const probe = await shell.evaluate(() => {
      const row = document.querySelector('.tab-row').getBoundingClientRect();
      const plus = document.querySelector('.tab-new').getBoundingClientRect();
      const titles = [...document.querySelectorAll('#tabs .tab .title')].map((t) => ({
        text: t.textContent,
        // Tagliato = il testo non ci sta nella sua casella (ellissi visibile).
        clipped: t.scrollWidth > Math.ceil(t.getBoundingClientRect().width) + 1,
      }));
      return { freeSpace: row.right - plus.right, titles };
    });

    // Pre-condizione del feedback: nella barra AVANZA spazio dopo il "+".
    // Senza spazio libero il test non direbbe niente, quindi lo dichiariamo.
    expect(probe.freeSpace, 'la barra deve avere spazio libero perché il test abbia senso')
      .toBeGreaterThan(100);
    expect(probe.titles.length).toBe(3);
    for (const t of probe.titles) {
      expect(t.clipped, `il titolo "${t.text}" è tagliato benché nella barra avanzi spazio`).toBe(false);
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
    const probe = await shell.locator('.tab').evaluateAll((els) => {
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
    // La lettura si ripete: la shell ricrea i nodi .tab a ogni aggiornamento e
    // su un nodo appena staccato getComputedStyle ritorna stringhe vuote.
    const foot = { display: 'block', width: '8px', gradient: true };
    await expect.poll(async () => shell.locator('.tab.active').evaluate((el) => {
      const read = (sel) => {
        const s = getComputedStyle(el, sel);
        return { display: s.display, width: s.width, gradient: /radial-gradient/.test(s.backgroundImage) };
      };
      return { before: read('::before'), after: read('::after') };
    }).catch(() => null), { timeout: 8_000 }).toEqual({ before: foot, after: foot });
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
