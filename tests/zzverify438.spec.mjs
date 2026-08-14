// VERIFICA #438 (black-box, temporaneo — non fa parte della suite).
//
// Sintomo utente: in un'area di scrittura "ricca" (contenteditable, tipo
// webmail/editor online) DENTRO un blocco isolato (shadow DOM), il click destro
// su una parola sbagliata non propone la correzione in cima al menu; fuori dal
// blocco, sulla stessa area, la propone.
// Variante "sigillata" (shadow root closed): stessa cosa + la correzione deve
// APPLICARSI davvero cliccandola.

import { test, expect } from './fixtures/electron.mjs';

function pageHtml() {
  return `<!doctype html><html><body style="padding:24px;font:18px sans-serif">
    <h1>Prova</h1>
    <p>Light DOM:</p>
    <div id="light-rich" contenteditable="true" spellcheck="true"
         style="border:1px solid #999;min-height:60px;padding:8px"></div>

    <p>Blocco isolato (open):</p>
    <open-block id="openb"></open-block>

    <p>Blocco sigillato (closed):</p>
    <sealed-block id="sealedb"></sealed-block>

    <script>
      function mk(root, id) {
        const ed = document.createElement('div');
        ed.id = id;
        ed.setAttribute('contenteditable', 'true');
        ed.setAttribute('spellcheck', 'true');
        ed.style.cssText = 'border:1px solid #999;min-height:60px;padding:8px';
        root.appendChild(ed);
        return ed;
      }
      function api(host, ed) {
        host.edFocus = () => { ed.focus(); };
        host.edText = () => ed.textContent;
        host.edSetText = (t) => { ed.textContent = t; };
        host.edHtml = () => ed.innerHTML;
        // rect della n-esima parola (per il click destro reale)
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
      class OpenBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'open' });
          const p = document.createElement('p');
          p.textContent = 'dentro il blocco';
          root.appendChild(p);
          api(this, mk(root, 'open-rich'));
        }
      }
      class SealedBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'closed' });
          const p = document.createElement('p');
          p.textContent = 'dentro il blocco sigillato';
          root.appendChild(p);
          api(this, mk(root, 'sealed-rich'));
        }
      }
      customElements.define('open-block', OpenBlock);
      customElements.define('sealed-block', SealedBlock);
    </script>
  </body></html>`;
}

// Focus + digita davvero (il correttore nativo marca solo ciò che viene scritto).
async function typeInto(page, hostSel, text) {
  if (hostSel === 'light') {
    await page.evaluate(() => document.getElementById('light-rich').focus());
  } else {
    await page.evaluate((s) => document.querySelector(s).edFocus(), hostSel);
  }
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(800); // lascia lavorare il correttore nativo
}

async function readText(page, hostSel) {
  if (hostSel === 'light') {
    return page.evaluate(() => document.getElementById('light-rich').textContent);
  }
  return page.evaluate((s) => document.querySelector(s).edText(), hostSel);
}

async function wordRect(page, hostSel, idx) {
  if (hostSel === 'light') {
    return page.evaluate((i) => {
      const ed = document.getElementById('light-rich');
      const walk = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let n; const nodes = [];
      while ((n = walk.nextNode())) nodes.push(n);
      let seen = 0;
      for (const node of nodes) {
        const re = /\S+/g; let m;
        while ((m = re.exec(node.data))) {
          if (seen === i) {
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
    }, idx);
  }
  return page.evaluate(({ s, i }) => document.querySelector(s).edWordRect(i), { s: hostSel, i: idx });
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

test.describe.configure({ mode: 'serial' });

for (const [label, hostSel] of [['light DOM', 'light'], ['blocco isolato (open)', '#openb'], ['blocco sigillato (closed)', '#sealedb']]) {
  test(`correzione nel campo ricco — ${label}`, async ({ openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, pageHtml());

    await typeInto(page, hostSel, 'wrlod ciao');
    expect(await readText(page, hostSel)).toBe('wrlod ciao');

    const r = await wordRect(page, hostSel, 0);
    expect(r, 'rect della parola').toBeTruthy();
    expect(r.word).toBe('wrlod');

    await page.mouse.click(r.x, r.y, { button: 'right' });
    await page.waitForFunction(() => {
      const m = document.querySelector('.sn-menu');
      return !!m && m.style.display !== 'none';
    }, null, { timeout: 8000 });
    await page.waitForTimeout(1200); // la correzione può arrivare async

    const st = await menuState(page);
    await page.screenshot({ path: `tests/.shots/v438-${hostSel.replace('#', '')}-menu.png` }).catch(() => {});
    console.log(`[${label}] menu:`, JSON.stringify(st));
    expect(st.open).toBe(true);
    expect(st.firstIsCorrection, `prima voce = correzione (${JSON.stringify(st.labels)})`).toBe(true);

    const suggested = st.firstLabel;
    // Clicca la correzione e verifica che la parola cambi DAVVERO.
    await page.locator('.sn-menu .sn-menu-correction').first().click();
    await page.waitForTimeout(800);
    const after = await readText(page, hostSel);
    console.log(`[${label}] suggerita="${suggested}" dopo="${after}"`);
    expect(after, 'la parola deve essere corretta').toBe(`${suggested} ciao`);
  });
}
