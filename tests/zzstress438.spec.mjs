// STRESS #438 (temporaneo, black-box).
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const CACHE = '/tmp/filo-dict';
function dictServer() {
  mkdirSync(CACHE, { recursive: true });
  return createServer((req, res) => {
    const name = req.url.replace(/^\/+/, '').split('?')[0];
    const local = `${CACHE}/${name}`;
    try {
      if (!existsSync(local)) {
        execFileSync('curl', ['-sSL', '--max-time', '60', '-o', local,
          `https://redirector.gvt1.com/edgedl/chrome/dict/${name}`], { stdio: 'ignore' });
      }
      const buf = readFileSync(local);
      if (buf.length < 1000) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
      res.end(buf);
    } catch (_) { res.writeHead(404); res.end('nope'); }
  });
}

function pageHtml() {
  return `<!doctype html><html><body style="padding:20px;font:18px sans-serif">
    <open-block id="openb"></open-block>
    <sealed-block id="sealedb"></sealed-block>
    <script>
      globalThis.__xss = 0;
      function mk(root) {
        const ed = document.createElement('div');
        ed.setAttribute('contenteditable', 'true');
        ed.setAttribute('spellcheck', 'true');
        ed.style.cssText = 'border:1px solid #999;min-height:50px;padding:8px;max-height:200px;overflow:auto';
        root.appendChild(ed);
        return ed;
      }
      function api(host, ed) {
        host.edFocus = () => { ed.focus(); };
        host.edText = () => ed.textContent;
        host.edHtml = () => ed.innerHTML;
        host.edExec = (cmd) => { ed.focus(); document.execCommand(cmd); };
        host.edClear = () => {
          ed.focus();
          const r = document.createRange(); r.selectNodeContents(ed);
          const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          document.execCommand('delete');
        };
        host.edWordRect = (word) => {
          const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
          let n; const nodes = [];
          while ((n = walk.nextNode())) nodes.push(n);
          for (const node of nodes) {
            const i = node.data.indexOf(word);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(node, i); r.setEnd(node, i + word.length);
            const b = r.getBoundingClientRect();
            if (b.width === 0 && b.height === 0) continue;
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          }
          return null;
        };
      }
      class OpenBlock extends HTMLElement {
        constructor() { super(); api(this, mk(this.attachShadow({ mode: 'open' }))); }
      }
      class SealedBlock extends HTMLElement {
        constructor() { super(); api(this, mk(this.attachShadow({ mode: 'closed' }))); }
      }
      customElements.define('open-block', OpenBlock);
      customElements.define('sealed-block', SealedBlock);
    </script>
  </body></html>`;
}

const ev = (page, sel, fn, arg) => page.evaluate(
  ({ s, f, a }) => document.querySelector(s)[f](a), { s: sel, f: fn, a: arg });

async function setup(app, openTab, testServer) {
  const srv = dictServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await app.evaluate(({ session }, url) => {
    const ses = session.defaultSession;
    ses.setSpellCheckerDictionaryDownloadURL(url);
    ses.setSpellCheckerLanguages(['en-US']);
  }, `http://127.0.0.1:${port}/`);
  const page = await testServer.openReady(openTab, pageHtml());
  await page.waitForTimeout(3500);
  return { page, srv };
}

async function typeInto(page, sel, text, delay = 20) {
  await ev(page, sel, 'edFocus');
  await page.keyboard.type(text, { delay });
  await page.waitForTimeout(1200);
}

async function rightClick(page, sel, word) {
  const r = await ev(page, sel, 'edWordRect', word);
  expect(r, `rect di "${word}"`).toBeTruthy();
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await page.waitForFunction(() => {
    const m = document.querySelector('.sn-menu');
    return !!m && m.style.display !== 'none';
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function menuState(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu || menu.style.display === 'none') return { open: false };
    const items = Array.from(menu.children).filter(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    const first = items[0];
    return {
      open: true,
      firstIsCorrection: !!first && first.classList.contains('sn-menu-correction'),
      firstLabel: first ? (first.querySelector('.sn-menu-label')?.textContent || first.textContent).trim() : null,
      labels: items.map((i) => (i.querySelector('.sn-menu-label')?.textContent || i.textContent).trim()),
      correctionHtml: menu.querySelector('.sn-menu-correction')?.outerHTML?.slice(0, 900) || null,
    };
  });
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

test.describe.configure({ mode: 'serial' });

for (const [label, sel] of [['open', '#openb'], ['sealed', '#sealedb']]) {
  test(`stress ${label}: parola corretta, campo vuoto, testo enorme, doppio clic, formattazione`, async ({ app, openTab, testServer }) => {
    test.setTimeout(300_000);
    const { page, srv } = await setup(app, openTab, testServer);
    try {
      // --- 1. campo VUOTO: click destro non deve rompere nulla ---
      await ev(page, sel, 'edFocus');
      const box = await page.evaluate((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return { x: b.left + 20, y: b.top + 20 };
      }, sel);
      await page.mouse.click(box.x, box.y, { button: 'right' });
      await page.waitForTimeout(1200);
      let st = await menuState(page);
      console.log(`[${label}] VUOTO`, JSON.stringify(st.labels));
      expect(st.open, 'il menu si apre anche su campo vuoto').toBe(true);
      expect(st.firstIsCorrection, 'nessuna correzione su campo vuoto').toBe(false);
      await closeMenu(page);

      // --- 2. struttura della voce correzione (per il sottomenu) ---
      await typeInto(page, sel, 'wrlod ciao');
      await rightClick(page, sel, 'wrlod');
      st = await menuState(page);
      console.log(`[${label}] CORRECTION_HTML`, st.correctionHtml);
      expect(st.firstLabel).toBe('world');

      // --- 3. sottomenu: applica un'alternativa (warlord) ---
      const sub = await page.evaluate(() => {
        const c = document.querySelector('.sn-menu .sn-menu-correction');
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return { x: b.left + b.width - 10, y: b.top + b.height / 2 };
      });
      await page.mouse.move(sub.x, sub.y);
      await page.waitForTimeout(900);
      const subItems = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.sn-menu .sn-menu-sub, .sn-submenu, .sn-menu-submenu'));
        return nodes.map((n) => ({ cls: n.className, txt: n.textContent.trim().slice(0, 120), vis: n.offsetParent !== null }));
      });
      console.log(`[${label}] SUB`, JSON.stringify(subItems));
      const clicked = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('.sn-menu *'));
        const t = all.find((n) => n.children.length === 0 && n.textContent.trim() === 'warlord');
        if (!t) return false;
        const el = t.closest('[class*="item"], [class*="menu-"]') || t;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      console.log(`[${label}] WARLORD`, JSON.stringify(clicked));
      if (clicked && clicked.x) {
        await page.mouse.click(clicked.x, clicked.y);
        await page.waitForTimeout(1000);
        const t = await ev(page, sel, 'edText');
        console.log(`[${label}] DOPO SOTTOMENU="${t}"`);
        expect(t, 'anche il sottomenu applica').toBe('warlord ciao');
      } else {
        await closeMenu(page);
        console.log(`[${label}] sottomenu alternative non trovato`);
      }
      await ev(page, sel, 'edClear');

      // --- 4. parola scritta BENE: nessuna correzione stantia ---
      await typeInto(page, sel, 'hello ciao');
      await rightClick(page, sel, 'hello');
      st = await menuState(page);
      console.log(`[${label}] PAROLA OK`, JSON.stringify(st.labels));
      expect(st.firstIsCorrection, 'nessuna correzione su parola corretta').toBe(false);
      await closeMenu(page);
      await ev(page, sel, 'edClear');

      // --- 5. testo ENORME (10k caratteri) ---
      await ev(page, sel, 'edFocus');
      await page.keyboard.insertText('lorem ipsum dolor sit amet '.repeat(370)); // ~10k
      await page.keyboard.type(' wrlod fine', { delay: 20 });
      await page.waitForTimeout(2500);
      const lenBefore = (await ev(page, sel, 'edText')).length;
      console.log(`[${label}] LEN`, lenBefore);
      expect(lenBefore).toBeGreaterThan(9000);
      await rightClick(page, sel, 'wrlod');
      st = await menuState(page);
      console.log(`[${label}] ENORME`, JSON.stringify(st.labels.slice(0, 3)));
      expect(st.firstIsCorrection, 'correzione anche su testo enorme').toBe(true);
      await page.locator('.sn-menu .sn-menu-correction').first().click();
      await page.waitForTimeout(1500);
      const big = await ev(page, sel, 'edText');
      expect(big.includes('world fine'), 'corretta anche nel testo enorme').toBe(true);
      expect(big.includes('wrlod'), 'la vecchia parola sparisce').toBe(false);
      expect(big.length).toBeGreaterThan(9000);
      await ev(page, sel, 'edClear');

      // --- 6. formattazione ricca: il grassetto deve sopravvivere ---
      await ev(page, sel, 'edFocus');
      await ev(page, sel, 'edExec', 'bold');
      await page.keyboard.type('wrlod', { delay: 25 });
      await ev(page, sel, 'edExec', 'bold');
      await page.keyboard.type(' ciao', { delay: 25 });
      await page.waitForTimeout(1500);
      console.log(`[${label}] HTML PRIMA`, await ev(page, sel, 'edHtml'));
      await rightClick(page, sel, 'wrlod');
      st = await menuState(page);
      expect(st.firstIsCorrection, 'correzione su testo formattato').toBe(true);
      await page.locator('.sn-menu .sn-menu-correction').first().click();
      await page.waitForTimeout(1000);
      const html = await ev(page, sel, 'edHtml');
      const txt = await ev(page, sel, 'edText');
      console.log(`[${label}] HTML DOPO`, html, '| TXT', txt);
      expect(txt).toBe('world ciao');
      expect(/<b>|<strong>|font-weight/i.test(html), 'il grassetto sopravvive').toBe(true);
      await ev(page, sel, 'edClear');

      // --- 7. due click destri rapidi di fila + doppio clic sulla correzione ---
      await typeInto(page, sel, 'wrlod ciao');
      const r = await ev(page, sel, 'edWordRect', 'wrlod');
      await page.mouse.click(r.x, r.y, { button: 'right' });
      await page.mouse.click(r.x, r.y, { button: 'right' });
      await page.waitForTimeout(1800);
      st = await menuState(page);
      console.log(`[${label}] DOPPIO DESTRO`, JSON.stringify(st.labels.slice(0, 3)));
      expect(st.open).toBe(true);
      expect(st.firstIsCorrection).toBe(true);
      const ci = page.locator('.sn-menu .sn-menu-correction').first();
      await ci.click();
      await page.waitForTimeout(300);
      await ci.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1200);
      const dbl = await ev(page, sel, 'edText');
      console.log(`[${label}] DOPO DOPPIO CLIC="${dbl}"`);
      expect(dbl, 'un doppio clic non duplica la correzione').toBe('world ciao');
      await ev(page, sel, 'edClear');

      // --- 8. contenuto ostile nel campo: niente esecuzione ---
      await ev(page, sel, 'edFocus');
      await page.keyboard.insertText('<script>globalThis.__xss=1<\/script><img src=x onerror="globalThis.__xss=1"> wrlod fine');
      await page.waitForTimeout(1800);
      await rightClick(page, sel, 'wrlod');
      st = await menuState(page);
      console.log(`[${label}] OSTILE`, JSON.stringify(st.labels.slice(0, 3)));
      if (st.firstIsCorrection) {
        await page.locator('.sn-menu .sn-menu-correction').first().click();
        await page.waitForTimeout(1200);
        console.log(`[${label}] OSTILE DOPO="${(await ev(page, sel, 'edText')).slice(0, 120)}"`);
      } else { await closeMenu(page); }
      const xss = await page.evaluate(() => globalThis.__xss);
      expect(xss, 'nessuna esecuzione di codice dal contenuto').toBe(0);
    } finally {
      await new Promise((r2) => srv.close(r2));
    }
  });
}
