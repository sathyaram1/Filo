import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';

test('find matches CSS generated content (::before) e canvas?', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><head><style>
      #gen::before { content: var(--t); }
    </style></head><body>
    <span id="gen" style="--t:'${S}'"></span>
    <div id="host"></div>
    <canvas id="cv" width="300" height="30"></canvas>
    <script>
      // closed shadow con ::before via adoptedStyleSheet
      const sr = document.getElementById('host').attachShadow({ mode: 'closed' });
      const sheet = new CSSStyleSheet(); sheet.replaceSync('.g::before{content:var(--t)}');
      sr.adoptedStyleSheets = [sheet];
      const g = document.createElement('span'); g.className='g'; g.style.setProperty('--t', "'"+${JSON.stringify(S)}+"'");
      sr.appendChild(g);
      // canvas con testo disegnato
      const ctx = document.getElementById('cv').getContext('2d'); ctx.font='16px sans-serif'; ctx.fillText(${JSON.stringify(S)}, 2, 20);
      window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };
      // leggibilita' dal sito: puo' leggere il valore della var dentro lo shadow chiuso?
      window.leggiVar = () => { try { return getComputedStyle(document.getElementById('gen')).getPropertyValue('--t'); } catch(e){ return 'err'; } };
    </script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(400);
  const r = await p.evaluate((s) => ({ find: window.cerca(s), varLight: window.leggiVar() }), S);
  console.log('GEN', JSON.stringify(r));
  expect(true).toBe(true);
});
