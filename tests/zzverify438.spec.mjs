// VERIFICA #438 (black-box, temporaneo — non fa parte della suite).
//
// Sintomo utente: in un'area di scrittura "ricca" (contenteditable, tipo
// webmail/editor online) DENTRO un blocco isolato (shadow DOM), il click destro
// su una parola sbagliata non propone la correzione in cima al menu; fuori dal
// blocco, sulla stessa area, la propone.
// Variante "sigillata" (shadow root closed): idem + la correzione deve
// APPLICARSI davvero cliccandola (qui la passata precedente si era rotta).
//
// Nota ambiente: in questo container Electron non riesce a scaricare i
// dizionari Hunspell dal CDN; li serviamo da un mini server locale, così il
// correttore NATIVO (quello dietro lo zigzag rosso) funziona davvero.

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
    <h1>Prova</h1>
    <p>Light DOM:</p>
    <light-block id="lightb"></light-block>
    <p>Blocco isolato (open):</p>
    <open-block id="openb"></open-block>
    <p>Blocco sigillato (closed):</p>
    <sealed-block id="sealedb"></sealed-block>
    <script>
      function mk(root) {
        const ed = document.createElement('div');
        ed.setAttribute('contenteditable', 'true');
        ed.setAttribute('spellcheck', 'true');
        ed.style.cssText = 'border:1px solid #999;min-height:50px;padding:8px';
        root.appendChild(ed);
        return ed;
      }
      function api(host, ed) {
        host.edFocus = () => { ed.focus(); };
        host.edText = () => ed.textContent;
        host.edHtml = () => ed.innerHTML;
        host.edClear = () => {
          ed.focus();
          const r = document.createRange();
          r.selectNodeContents(ed);
          const s = window.getSelection();
          s.removeAllRanges(); s.addRange(r);
          document.execCommand('delete');
        };
        host.edWordRect = (idx) => {
          const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
          let n; const nodes = [];
          while ((n = walk.nextNode())) nodes.push(n);
          let seen = 0;
          for (const node of nodes) {
            const re = /\\S+/g; let m;
            while ((m = re.exec(node.data))) {
              if (seen === idx) {
                const r = document.createRange();
                r.setStart(node, m.index);
                r.setEnd(node, m.index + m[0].length);
                const b = r.getBoundingClientRect();
                return { x: b.left + b.width / 2, y: b.top + b.height / 2, word: m[0] };
              }
              seen++;
            }
          }
          return null;
        };
      }
      class LightBlock extends HTMLElement {
        constructor() { super(); api(this, mk(this)); }
      }
      class OpenBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'open' });
          api(this, mk(root));
        }
      }
      class SealedBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'closed' });
          api(this, mk(root));
        }
      }
      customElements.define('light-block', LightBlock);
      customElements.define('open-block', OpenBlock);
      customElements.define('sealed-block', SealedBlock);
    </script>
  </body></html>`;
}

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
  await page.waitForTimeout(3500); // dizionario pronto
  return { page, srv };
}

const ev = (page, sel, fn, arg) => page.evaluate(
  ({ s, f, a }) => document.querySelector(s)[f](a), { s: sel, f: fn, a: arg });

async function typeInto(page, sel, text) {
  await ev(page, sel, 'edFocus');
  await page.keyboard.type(text, { delay: 20 });
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
    };
  });
}

async function rightClickWord(page, sel, idx) {
  const r = await ev(page, sel, 'edWordRect', idx);
  expect(r, 'rect parola').toBeTruthy();
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await page.waitForFunction(() => {
    const m = document.querySelector('.sn-menu');
    return !!m && m.style.display !== 'none';
  }, null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  return r;
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test.describe.configure({ mode: 'serial' });

const CASES = [
  ['light DOM', '#lightb'],
  ['blocco isolato (open)', '#openb'],
  ['blocco sigillato (closed)', '#sealedb'],
];

for (const [label, sel] of CASES) {
  test(`correzione applicata nel campo ricco — ${label}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const { page, srv } = await setup(app, openTab, testServer);
    try {
      await typeInto(page, sel, 'wrlod ciao');
      expect(await ev(page, sel, 'edText')).toBe('wrlod ciao');

      const r = await rightClickWord(page, sel, 0);
      expect(r.word).toBe('wrlod');
      const st = await menuState(page);
      await page.screenshot({ path: `tests/.shots/v438-${sel.slice(1)}-menu.png` }).catch(() => {});
      console.log(`[${label}] MENU`, JSON.stringify(st.labels));
      expect(st.open).toBe(true);
      expect(st.firstIsCorrection, `prima voce = correzione (${JSON.stringify(st.labels)})`).toBe(true);
      expect(st.firstLabel).toBe('world');

      await page.locator('.sn-menu .sn-menu-correction').first().click();
      await page.waitForTimeout(1000);
      const after = await ev(page, sel, 'edText');
      console.log(`[${label}] DOPO="${after}"`);
      expect(after, 'la parola deve essere corretta davvero').toBe('world ciao');

      // il punto in cui si scriveva non deve andare perso: continuando a
      // digitare il testo finisce nel campo (non altrove).
      await page.keyboard.type(' x', { delay: 20 });
      const after2 = await ev(page, sel, 'edText');
      console.log(`[${label}] DIGITANDO ANCORA="${after2}"`);
      expect(after2.startsWith('world ciao'), 'il fuoco resta nel campo').toBe(true);
      expect(after2.includes('x'), 'il fuoco resta nel campo').toBe(true);
    } finally {
      await new Promise((r2) => srv.close(r2));
    }
  });
}
