import { test, expect } from './fixtures/electron.mjs';

test('probe: cosa sa il sistema del click destro dentro un blocco sigillato', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:20px;font:18px sans-serif">
    <sealed-block id="s"></sealed-block>
    <script>
      class SealedBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'closed' });
          const ed = document.createElement('div');
          ed.setAttribute('contenteditable', 'true');
          ed.style.cssText = 'border:1px solid #999;min-height:50px;padding:8px';
          root.appendChild(ed);
          this.edFocus = () => ed.focus();
          this.edRect = () => { const b = ed.getBoundingClientRect(); return { x: b.left + 30, y: b.top + 20 }; };
        }
      }
      customElements.define('sealed-block', SealedBlock);
    </script>
  </body>`);

  await app.evaluate(({ webContents }) => {
    globalThis.__ctx = [];
    for (const wc of webContents.getAllWebContents()) {
      wc.on('context-menu', (_e, p) => {
        globalThis.__ctx.push({
          isEditable: p.isEditable, inputFieldType: p.inputFieldType,
          editFlags: p.editFlags, mis: p.misspelledWord, sel: p.selectionText,
        });
      });
    }
  });

  await page.evaluate(() => document.querySelector('#s').edFocus());
  await page.keyboard.type('prova testo', { delay: 20 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => document.querySelector('#s').edRect());
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await page.waitForTimeout(1500);
  const ctx = await app.evaluate(() => globalThis.__ctx.slice());
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m || m.style.display === 'none') return null;
    return Array.from(m.children)
      .filter((c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none')
      .map((c) => (c.querySelector('.sn-menu-label')?.textContent || c.textContent).trim());
  });
  console.log('CTX', JSON.stringify(ctx));
  console.log('MENU', JSON.stringify(menu));
  expect(true).toBe(true);
});
