// VERIFICA (verifier, feedback #438) — spec temporaneo, non va committato.
//
// Sintomo utente: in un'area di scrittura "ricca" (contenteditable) che sta
// DENTRO un blocco isolato (shadow root), il tasto destro su una parola
// scritta male non propone la correzione in cima al menu; sulla stessa
// identica area fuori dal blocco sì.
//
// Qui si asserisce il SUCCESSO (compare la correzione E applicarla cambia il
// testo), non l'assenza di un errore. Più stress test avversariali.

import { test, expect } from './fixtures/electron.mjs';

const STYLE = 'font:16px monospace;padding:8px;width:420px;height:70px;border:1px solid #ccc;margin:6px';

function pageHtml(lightText = 'wrlod ciao', shadowText = 'wrlod ciao') {
  return `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" style="${STYLE}">${lightText}</div>
  <open-block></open-block>
  <closed-block></closed-block>
  <script>
    const STYLE = ${JSON.stringify(STYLE)};
    const TXT = ${JSON.stringify(shadowText)};
    class OpenBlock extends HTMLElement {
      constructor() {
        super();
        const r = this.attachShadow({ mode: 'open' });
        const d = document.createElement('div');
        d.id = 's-ce'; d.contentEditable = 'true'; d.spellcheck = true;
        d.setAttribute('style', STYLE); d.textContent = TXT;
        r.appendChild(d);
      }
    }
    customElements.define('open-block', OpenBlock);
    class ClosedBlock extends HTMLElement {
      constructor() {
        super();
        const r = this.attachShadow({ mode: 'closed' });
        const d = document.createElement('div');
        d.id = 'c-ce'; d.contentEditable = 'true'; d.spellcheck = true;
        d.setAttribute('style', STYLE); d.textContent = TXT;
        r.appendChild(d);
        window.__closed = r;
      }
    }
    customElements.define('closed-block', ClosedBlock);

    // Helper DEL TEST (non dell'app): dove sta la n-esima parola, e che testo c'e'.
    window.__el = (which) => which === 'light'
      ? document.getElementById('ce')
      : which === 'open'
        ? document.querySelector('open-block').shadowRoot.getElementById('s-ce')
        : window.__closed.getElementById('c-ce');
    window.__wordPoint = (which, wordIndex) => {
      const el = window.__el(which);
      const tn = el.firstChild;
      const words = Array.from(tn.textContent.matchAll(/[^\\s]+/g));
      const m = words[wordIndex];
      const rg = document.createRange();
      rg.setStart(tn, m.index);
      rg.setEnd(tn, m.index + m[0].length);
      const r = rg.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    window.__text = (which) => window.__el(which).textContent;
  <\/script>
  </body></html>`;
}

// Come Electron in produzione: il main manda i suggerimenti SOLO quando la
// parola sotto il cursore e' segnata come errata (vedi tabs.js).
async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

async function openPage(openTab, testServer, html) {
  const url = testServer.html(html);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 },
  );
  return { page, host: new URL(url).host };
}

async function primeNative(app, page, host, word, suggestions) {
  const sent = await sendNative(app, host, word, suggestions);
  expect(sent).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(
    (w) => document.documentElement.dataset.filoNativeWord === w,
    word, { timeout: 8000 },
  );
}

async function rightClickWord(page, which, wordIndex) {
  const pt = await page.evaluate(([w, i]) => window.__wordPoint(w, i), [which, wordIndex]);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  return pt;
}

async function firstItemIsCorrection(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return false;
    const first = Array.from(menu.children).find(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    return !!first && first.classList.contains('sn-menu-correction');
  });
}

// ── 1. Baseline: fuori dal blocco isolato (deve funzionare gia' da prima) ────
test('baseline light DOM: correzione in cima', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);
  await rightClickWord(page, 'light', 0);
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu-correction:visible').first()).toContainText('world');
  expect(await firstItemIsCorrection(page)).toBe(true);
});

// ── 2. Il cuore del feedback: area ricca DENTRO il blocco isolato ────────────
test('shadow aperto: la correzione compare in cima E applicarla corregge il testo', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);
  await rightClickWord(page, 'open', 0);

  await expect(page.locator('.sn-menu')).toBeVisible();
  const corr = page.locator('.sn-menu-correction:visible').first();
  await expect(corr).toBeVisible({ timeout: 4000 });
  await expect(corr).toContainText('world');
  expect(await firstItemIsCorrection(page)).toBe(true);

  await page.screenshot({ path: 'tests/.shots/verifier-438-shadow-menu.png' }).catch(() => {});

  // L'obiettivo dell'utente non e' vedere la voce: e' correggere la parola.
  await corr.click();
  await expect.poll(
    () => page.evaluate(() => window.__text('open')),
    { timeout: 5000 },
  ).toBe('world ciao');
});

// ── 3. La variante "sigillata" che il report dichiara coperta ────────────────
test('shadow chiuso: correzione mostrata e applicata', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  // Ordine di produzione: prima il click destro, POI Electron consegna i
  // suggerimenti sull'evento context-menu.
  const pt = await rightClickWord(page, 'closed', 0);
  await expect(page.locator('.sn-menu')).toBeVisible();
  expect(await sendNative(app, host, 'wrlod', ['world', 'word'])).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1200);
  console.log('DIAG closed', JSON.stringify({
    pt,
    nativeWord: await page.evaluate(() => document.documentElement.dataset.filoNativeWord),
    items: await page.evaluate(() => Array.from(document.querySelectorAll('.sn-menu > *'))
      .filter((c) => c.style.display !== 'none')
      .map((c) => `${c.className}|${(c.textContent || '').trim().slice(0, 28)}`)),
  }));
  const corr = page.locator('.sn-menu-correction:visible').first();
  await expect(corr).toBeVisible({ timeout: 4000 });
  await expect(corr).toContainText('world');
  await page.screenshot({ path: 'tests/.shots/verifier-438-closed-menu.png' }).catch(() => {});

  const before = await page.evaluate(() => ({
    active: document.activeElement && document.activeElement.tagName,
    text: window.__text('closed'),
  }));
  await corr.click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    menuOpen: !!document.querySelector('.sn-menu') &&
      getComputedStyle(document.querySelector('.sn-menu')).display !== 'none',
    active: document.activeElement && document.activeElement.tagName,
    text: window.__text('closed'),
  }));
  console.log('DIAG closed-apply', JSON.stringify({ before, after }));
  expect(after.text).toBe('world ciao');
});

// ── 4. AVVERSARIALE: suggerimento vecchio su parola giusta ───────────────────
// Electron NON rimanda niente quando la parola cliccata e' scritta bene: se il
// menu ripescasse l'ultimo suggerimento, offrirebbe di sostituire una parola
// corretta con una che non c'entra (e applicarla distruggerebbe il testo).
test('parola corretta dopo una errata: nessuna correzione fuorviante', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);

  for (const which of ['open', 'closed']) {
    await rightClickWord(page, which, 1); // "ciao", scritta bene
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.waitForTimeout(700); // lascia arrivare eventuali suggerimenti async
    const shown = await page.locator('.sn-menu-correction:visible').count();
    expect(shown, `su "ciao" (${which}) non deve comparire nessuna correzione`).toBe(0);
    const text = await page.evaluate((w) => window.__text(w), which);
    expect(text).toBe('wrlod ciao');
    await page.keyboard.press('Escape');
  }
});

// ── 5. AVVERSARIALE: suggerimento ostile (XSS) ───────────────────────────────
test('suggerimento con HTML ostile: non viene eseguito', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  const hostile = '<img src=x onerror="window.__xss=1">';
  await primeNative(app, page, host, 'wrlod', [hostile, 'world']);
  await rightClickWord(page, 'open', 0);
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(600);
  const xss = await page.evaluate(() => ({
    fired: !!window.__xss,
    injected: !!document.querySelector('.sn-menu img[src="x"]'),
  }));
  expect(xss.fired).toBe(false);
  expect(xss.injected).toBe(false);
});

// ── 6. AVVERSARIALE: testo lunghissimo ───────────────────────────────────────
test('area ricca con 10.000 caratteri dentro il blocco: la correzione arriva lo stesso', async ({ app, openTab, testServer }) => {
  const filler = 'parola '.repeat(1400); // ~9.8k caratteri
  const { page, host } = await openPage(openTab, testServer, pageHtml('wrlod ciao', `${filler}wrlod ciao`));
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);
  // Porta l'ultima riga (dove sta "wrlod") sotto gli occhi, come farebbe
  // l'utente scrollando fino in fondo a quello che ha scritto.
  const diag = await page.evaluate(() => {
    const el = window.__el('open');
    el.style.overflow = 'auto';
    el.scrollTop = el.scrollHeight;
    const tn = el.firstChild;
    const i = tn.textContent.lastIndexOf('wrlod');
    const rg = document.createRange();
    rg.setStart(tn, i); rg.setEnd(tn, i + 5);
    const r = rg.getBoundingClientRect();
    return {
      len: tn.textContent.length,
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      vw: innerWidth, vh: innerHeight,
      elRect: { t: el.getBoundingClientRect().top, b: el.getBoundingClientRect().bottom },
    };
  });
  console.log('DIAG long-text', JSON.stringify(diag));
  await page.mouse.click(diag.x, diag.y, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu-correction:visible').first()).toContainText('world', { timeout: 5000 });
});

// ── 7. AVVERSARIALE: doppio tasto destro rapido ──────────────────────────────
test('due click destro rapidi: dentro e fuori dal blocco si comportano uguale', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml());
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);

  const res = {};
  for (const which of ['light', 'open']) {
    const pt = await page.evaluate((w) => window.__wordPoint(w, 0), which);
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.waitForTimeout(900);
    res[which] = {
      menus: await page.locator('.sn-menu').count(),
      corrections: await page.locator('.sn-menu-correction:visible').count(),
    };
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  console.log('DIAG doppio-click', JSON.stringify(res));
  // Parita': il blocco isolato non deve comportarsi peggio del light DOM.
  expect(res.open.menus).toBe(res.light.menus);
  expect(res.open.corrections).toBe(res.light.corrections);
});

// ── 8. AVVERSARIALE: area vuota / solo spazi ─────────────────────────────────
test('area ricca vuota dentro il blocco: nessun crash, il menu si apre', async ({ app, openTab, testServer }) => {
  const { page, host } = await openPage(openTab, testServer, pageHtml('wrlod ciao', '   '));
  await primeNative(app, page, host, 'wrlod', ['world', 'word']);
  const box = await page.evaluate(() => {
    const r = window.__el('open').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  // La pagina deve restare viva e reattiva.
  expect(await page.evaluate(() => window.__text('open'))).toBe('   ');
});
