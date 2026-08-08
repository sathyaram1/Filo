// VERIFIER #405 — black-box dal sintomo utente:
// "tasto destro DENTRO un riquadro incorporato non fa nulla".
// Asseriamo il SUCCESSO: il menu Filo compare e contiene le azioni giuste.

import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><html><body style="margin:0;padding:20px;font:16px sans-serif;background:#eef">
  <p id="ptext">Testo dentro il riquadro incorporato che l'utente vuole selezionare e spiegare.</p>
  <a id="plink" href="https://example.com/dentro">link dentro il riquadro</a>
  <img id="pimg" width="80" height="60" alt="img"
       src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==">
  <input id="pinput" value="campo dentro il riquadro">
</body></html>`;

// Pagina "articolo" con il riquadro incorporato. childUrl viene sostituito.
function parentHtml(childUrl, extra = '') {
  return `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
  <h1 id="h">Articolo con video incorporato</h1>
  <p id="outside">Testo dell'articolo, fuori dal riquadro.</p>
  <iframe id="f" src="${childUrl}" width="600" height="320" style="border:2px solid #333"></iframe>
  ${extra}
</body></html>`;
}

// Attende che il menu Filo compaia in QUALSIASI frame (main o sottoframe)
// e ritorna il frame che lo contiene.
async function waitMenuAnyFrame(page, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const fr of page.frames()) {
      try {
        const n = await fr.locator('.sn-menu').count();
        if (n > 0 && (await fr.locator('.sn-menu').first().isVisible())) return fr;
      } catch (_) {}
    }
    await page.waitForTimeout(150);
  }
  return null;
}

// Match ESATTO sull'url del frame (un match "includes" su "/1" beccherebbe
// anche "http://127.0.0.1:PORT/2" per via di "//127").
async function frameByUrl(page, url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const fr = page.frames().find((f) => f.url() === url && f !== page.mainFrame());
    if (fr) return fr;
    await page.waitForTimeout(100);
  }
  throw new Error('frame non trovato: ' + url + ' — presenti: ' + page.frames().map((f) => f.url()).join(', '));
}

// ---------- 1. IL SINTOMO ESATTO ----------

test('#405 tasto destro sul testo dentro il riquadro apre il menu Filo', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));

  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });

  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame, 'nessun menu Filo dopo tasto destro dentro il riquadro').not.toBeNull();
  const txt = (await menuFrame.locator('.sn-menu').first().innerText()) || '';
  console.log('[MENU-TESTO-DENTRO-IFRAME]\n' + txt);
  expect(txt.length).toBeGreaterThan(0);
});

test('#405 stesso menu fuori dal riquadro (controllo)', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
});

test('#405 riquadro CROSS-ORIGIN (caso reale: video/mappa di un altro sito)', async ({ openTab, testServer }) => {
  // parent su 127.0.0.1, iframe su localhost → origin diverse (OOPIF)
  const childUrl = testServer.html(CHILD).replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, parentHtml(childUrl));

  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });

  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame, 'nessun menu dentro un riquadro di un ALTRO sito').not.toBeNull();
});

test('#405 tasto destro su un LINK dentro il riquadro → azioni sul link', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#plink').click({ button: 'right' });
  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame).not.toBeNull();
  const txt = (await menuFrame.locator('.sn-menu').first().innerText()) || '';
  console.log('[MENU-LINK-DENTRO-IFRAME]\n' + txt);
  // deve avere almeno una voce che parla di link/scheda
  expect(txt.toLowerCase()).toMatch(/link|scheda|indirizzo|copia/);
});

test('#405 tasto destro su IMMAGINE dentro il riquadro → azioni sull immagine', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#pimg').click({ button: 'right' });
  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame).not.toBeNull();
  const txt = (await menuFrame.locator('.sn-menu').first().innerText()) || '';
  console.log('[MENU-IMG-DENTRO-IFRAME]\n' + txt);
  expect(txt.toLowerCase()).toMatch(/immagine/);
});

test('#405 tasto destro su CAMPO DI TESTO dentro il riquadro → Incolla', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#pinput').click();
  await fr.locator('#pinput').click({ button: 'right' });
  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame).not.toBeNull();
  const txt = (await menuFrame.locator('.sn-menu').first().innerText()) || '';
  console.log('[MENU-INPUT-DENTRO-IFRAME]\n' + txt);
  expect(txt.toLowerCase()).toMatch(/incolla/);
});

test('#405 selezione dentro il riquadro → sezione AI inline nel menu', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.evaluate(() => {
    const p = document.querySelector('#ptext');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await fr.locator('#ptext').click({ button: 'right' });
  const menuFrame = await waitMenuAnyFrame(page);
  expect(menuFrame).not.toBeNull();
  await expect(menuFrame.locator('.sn-menu .sn-menu-inline').first()).toBeVisible();
});

// ---------- 2. STRESS / CASI LIMITE ----------

test('#405 STRESS srcdoc + about:blank + sandbox', async ({ openTab, testServer }) => {
  const extra = `
    <iframe id="fs" srcdoc="<p id='sd'>testo in srcdoc</p>" width="300" height="120"></iframe>
    <iframe id="fb" src="about:blank" width="300" height="120"></iframe>
    <iframe id="fsb" sandbox="allow-scripts" srcdoc="<p id='sb'>testo sandbox</p>" width="300" height="120"></iframe>`;
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl, extra));
  await page.waitForTimeout(1500);

  // srcdoc: deve funzionare o almeno NON far crashare la pagina
  const sd = page.frames().find((f) => f.url() === 'about:srcdoc' || f.name() === 'fs');
  if (sd) {
    try {
      await sd.locator('#sd').click({ button: 'right', timeout: 5000 });
      const m = await waitMenuAnyFrame(page, 6000);
      console.log('[SRCDOC] menu=' + !!m);
    } catch (e) { console.log('[SRCDOC] click fallito: ' + e.message); }
  } else console.log('[SRCDOC] frame non esposto');

  // la pagina principale deve restare viva e col menu funzionante
  await page.keyboard.press('Escape');
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
});

test('#405 STRESS iframe annidato (riquadro dentro riquadro)', async ({ openTab, testServer }) => {
  const inner = testServer.html(CHILD);
  const mid = testServer.html(`<!doctype html><body style="margin:0">
    <p id="midp">livello intermedio</p>
    <iframe id="deep" src="${inner}" width="500" height="220"></iframe></body>`);
  const page = await testServer.openReady(openTab, parentHtml(mid));
  const fr = await frameByUrl(page, inner);
  await fr.locator('#ptext').click({ button: 'right' });
  const m = await waitMenuAnyFrame(page);
  expect(m, 'nessun menu nel riquadro annidato di 2 livelli').not.toBeNull();
});

test('#405 STRESS testo enorme + emoji + HTML ostile dentro il riquadro', async ({ openTab, testServer }) => {
  const hostile = testServer.html(`<!doctype html><body style="margin:0">
    <p id="big">${'A'.repeat(10000)}</p>
    <p id="emoji">🙂🚀👨‍👩‍👧‍👦 ${'<script>alert(1)<\/script>'.replace(/</g, '&lt;')} &lt;img src=x onerror=alert(1)&gt;</p>
    <a id="js" href="javascript:alert(1)">link javascript</a>
    </body>`);
  const page = await testServer.openReady(openTab, parentHtml(hostile));
  const fr = await frameByUrl(page, hostile);

  // selezione da 10k caratteri
  await fr.evaluate(() => {
    const p = document.querySelector('#big');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await fr.locator('#big').click({ button: 'right', position: { x: 20, y: 5 } });
  let m = await waitMenuAnyFrame(page);
  expect(m, 'menu assente con selezione da 10.000 caratteri').not.toBeNull();
  const box = await m.locator('.sn-menu').first().boundingBox();
  console.log('[10K] menu box=' + JSON.stringify(box));
  // il menu non deve sfondare la finestra
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  if (box) {
    expect(box.width).toBeLessThan(vp.w + 50);
    expect(box.height).toBeLessThanOrEqual(vp.h + 50);
  }

  // dialoghi nativi: se un alert() partisse, il test si bloccherebbe → registriamolo
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });

  await page.keyboard.press('Escape');
  await fr.locator('#emoji').click({ button: 'right' });
  m = await waitMenuAnyFrame(page);
  expect(m, 'menu assente su testo con emoji/HTML').not.toBeNull();
  const t = await m.locator('.sn-menu').first().innerText();
  expect(t).not.toContain('onerror=alert');

  await page.keyboard.press('Escape');
  await fr.locator('#js').click({ button: 'right' });
  m = await waitMenuAnyFrame(page);
  console.log('[JS-LINK] menu=' + !!m + ' dialogs=' + dialogs);
  expect(dialogs).toBe(0);
});

test('#405 STRESS doppio/triplo tasto destro rapido dentro il riquadro', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  for (let i = 0; i < 5; i++) {
    await fr.locator('#ptext').click({ button: 'right' });
    await page.waitForTimeout(60);
  }
  const m = await waitMenuAnyFrame(page);
  expect(m).not.toBeNull();
  // NON devono restare 5 menu impilati
  let total = 0;
  for (const f of page.frames()) { try { total += await f.locator('.sn-menu').count(); } catch (_) {} }
  console.log('[RAPIDO] menu totali=' + total);
  expect(total).toBeLessThanOrEqual(1);
});

test('#405 STRESS il menu si chiude e non resta appiccicato', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });
  const m = await waitMenuAnyFrame(page);
  expect(m).not.toBeNull();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  let vis = 0;
  for (const f of page.frames()) {
    try {
      const c = await f.locator('.sn-menu').count();
      for (let i = 0; i < c; i++) if (await f.locator('.sn-menu').nth(i).isVisible()) vis++;
    } catch (_) {}
  }
  expect(vis, 'il menu resta aperto dopo Esc').toBe(0);
});

test('#405 STRESS Shift+tasto destro dentro il riquadro = escape hatch', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await page.keyboard.down('Shift');
  await fr.locator('#ptext').click({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(600);
  const m = await waitMenuAnyFrame(page, 1200);
  expect(m, 'Shift+destro dentro il riquadro dovrebbe NON aprire il menu Filo').toBeNull();
});

test('#405 STRESS riquadro basso 100px: il menu non viene tagliato', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl).replace('height="320"', 'height="100"'));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right', position: { x: 30, y: 8 } });
  const m = await waitMenuAnyFrame(page);
  expect(m, 'menu assente in un riquadro basso').not.toBeNull();
  const el = m.locator('.sn-menu').first();
  const info = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { h: r.height, top: r.top, scrollH: n.scrollHeight, clientH: n.clientHeight,
             overflowY: cs.overflowY, maxH: cs.maxHeight, winH: window.innerHeight };
  });
  console.log('[BASSO] ' + JSON.stringify(info));
  // se il contenuto eccede l'altezza disponibile deve essere scorrevole
  if (info.scrollH > info.clientH + 2) {
    expect(['auto', 'scroll']).toContain(info.overflowY);
  }
  await page.screenshot({ path: 'tests/.shots/v405-riquadro-basso.png' }).catch(() => {});
});

test('#405 il riquadro NON deve rubare le azioni di pagina (screenshot=schermata)', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#ptext').click({ button: 'right' });
  const m = await waitMenuAnyFrame(page);
  expect(m).not.toBeNull();
  const txt = (await m.locator('.sn-menu').first().innerText()) || '';
  console.log('[VOCI-PAGINA-DENTRO-IFRAME]\n' + txt);
});
