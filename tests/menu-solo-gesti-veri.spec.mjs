// #589.8 — lo script di un sito fabbricava un tasto destro, premeva da sé la freccia di Incolla e leggeva la
// cronologia degli appunti dal menu di Filo nel suo documento. Il menu risponde solo ai gesti dell'utente e la
// cronologia sta in uno shadow root chiuso. Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md.

import { test, expect } from './fixtures/electron.mjs';
import { statoCronologia, testiCronologia } from './helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-otto';

// Lo script del sito: tutto ciò che fa lo fa da sé, dentro il clic dell'utente su un suo pulsante.
const ATTACCO = `
  window.__visti = [];
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) window.__visti.push((n.outerHTML || n.textContent || ''));
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const aspetta = (ms) => new Promise((ok) => setTimeout(ok, ms));
  window.tasto = () => {
    const c = document.getElementById('campo');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true,
      clientX: r.left + 5, clientY: r.top + 5, button: 2, buttons: 2 }));
  };
  window.freccia = () => {
    const f = document.querySelector('.sn-menu-paste-arrow');
    if (!f) return false;
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      f.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true }));
    }
    f.click();
    return true;
  };
  // Il pulsante portato fuori dal menu, nella pagina, e premuto lì: fuori dal contenitore deve restare chiuso.
  window.sposta = (sel) => {
    const b = document.querySelector(sel);
    if (!b) return false;
    document.body.appendChild(b);
    b.click();
    return true;
  };
  window.incolla = () => { const b = document.querySelector('.sn-menu-paste-main'); if (b) b.click(); return !!b; };
  window.cosaVede = () => {
    let t = document.documentElement.outerHTML + (window.__visti || []).join(' ');
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) t += el.shadowRoot.innerHTML;
    return t;
  };
  window.attacca = async () => {
    window.tasto();
    await aspetta(800);
    window.__menu = !!document.querySelector('.sn-menu');
    window.freccia();
    await aspetta(800);
    window.incolla();
    await aspetta(800);
    window.__fatto = true;
  };
`;

const PAGINA = `<!doctype html><html><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <button id="gioca" style="margin-left:20px">Gioca</button>
  <script>${ATTACCO}
  document.getElementById('gioca').addEventListener('click', () => window.attacca());</script>
</body></html>`;

async function conCronologia(shell) {
  for (const text of ['un testo qualsiasi', SEGRETO]) {
    await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), text);
  }
}

test('il clic su un pulsante del sito non gli basta per aprire il menu e leggere la cronologia degli appunti', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await page.locator('#gioca').click();
  await page.waitForFunction(() => window.__fatto === true, null, { timeout: 10_000 });

  expect(await page.evaluate(() => window.__menu), 'il tasto destro fabbricato non apre il menu').toBe(false);
  expect(await page.evaluate(() => window.cosaVede())).not.toContain(SEGRETO);
  expect(await page.locator('#campo').inputValue(), 'Incolla premuto dal sito non incolla gli appunti').not.toContain(SEGRETO);
  expect(await statoCronologia(app, page)).toBeNull();

  // Il tasto destro dell'utente, sulla stessa pagina, apre il menu come sempre.
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
});

test('a menu aperto dall\'utente il sito non preme Incolla né la freccia; la cronologia la vede e la incolla solo l\'utente', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-arrow')).toBeVisible();
  expect(await page.evaluate(() => window.freccia())).toBe(true);
  expect(await page.evaluate(() => window.incolla())).toBe(true);
  await page.waitForTimeout(800);
  expect(await statoCronologia(app, page), 'la freccia premuta dal sito non apre la cronologia').toBeNull();
  expect(await page.locator('#campo').inputValue()).not.toContain(SEGRETO);

  // L'utente passa sulla freccia: la cronologia c'è, e il sito non la legge da nessuna parte.
  if (!(await page.locator('.sn-menu-paste-arrow').isVisible())) await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  expect(await page.evaluate(() => window.cosaVede())).not.toContain(SEGRETO);
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-sn-ui]')].some((el) => el.shadowRoot))).toBe(false);

  const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO);
  await page.mouse.move(voce.incolla.x, voce.incolla.y, { steps: 4 });
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});

test('il sito non preme Incolla, la freccia o Detta spostandoli fuori dal menu che l\'utente ha aperto', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  const apri = async (sel) => {
    await page.locator('#campo').click({ button: 'right' });
    await expect(page.locator(sel).first()).toBeVisible();
  };

  await apri('.sn-menu-paste-main');
  expect(await page.evaluate(() => window.sposta('.sn-menu-paste-main'))).toBe(true);
  await page.waitForTimeout(800);
  expect(await page.locator('#campo').inputValue(), 'il sito non si incolla gli appunti da solo').not.toContain(SEGRETO);

  await page.keyboard.press('Escape');
  await apri('.sn-menu-paste-arrow');
  expect(await page.evaluate(() => window.sposta('.sn-menu-paste-arrow'))).toBe(true);
  await page.waitForTimeout(800);
  expect(await statoCronologia(app, page), 'la freccia premuta dal sito non apre la cronologia').toBeNull();

  await page.keyboard.press('Escape');
  await apri('.sn-menu-split-main');
  expect(await page.evaluate(() => window.sposta('.sn-menu-split-main'))).toBe(true);
  await page.waitForTimeout(800);
  const visto = await page.evaluate(() => document.documentElement.innerText);
  expect(visto, 'il sito non accende il microfono da solo').not.toMatch(/Ti ascolto|Microfono/);

  // Il pulsante spostato resta della pagina, ma la mano dell'utente sul menu vero incolla come sempre.
  await page.keyboard.press('Escape');
  await page.locator('#campo').fill('');
  await apri('.sn-menu-paste-main');
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});

test('il sito non preme Incolla nemmeno nell\'istante in cui il menu entra nella sua pagina', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  // Un osservatore del sito creato prima di quelli di Filo viene avvisato per primo.
  await page.evaluate(() => {
    new MutationObserver(() => {
      const b = document.querySelector('.sn-menu .sn-menu-paste-main');
      if (b) { document.body.appendChild(b); b.click(); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#campo').click({ button: 'right' });
  await page.waitForTimeout(800);
  expect(await page.locator('#campo').inputValue()).not.toContain(SEGRETO);
});

test('un riquadro di un altro sito dentro la pagina non apre il menu con un tasto destro fabbricato', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  const riquadro = testServer.html(`<!doctype html><html><body>
    <input id="campo" style="width:200px">
    <script>${ATTACCO}
    window.__menuMai = false;
    const t0 = Date.now();
    const giro = setInterval(async () => {
      window.tasto();
      await new Promise((ok) => setTimeout(ok, 150));
      if (document.querySelector('.sn-menu')) window.__menuMai = true;
      window.freccia();
      if (Date.now() - t0 > 5000) { clearInterval(giro); window.__fatto = true; }
    }, 300);</script>
  </body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:20px">
    <button id="qui">Leggi l'articolo</button>
    <iframe src="${riquadro}" style="width:400px;height:200px"></iframe>
  </body></html>`);

  await page.locator('#qui').click();
  const delRiquadro = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
  await expect.poll(() => !!delRiquadro()).toBe(true);
  const frame = delRiquadro();
  await frame.waitForFunction(() => window.__fatto === true, null, { timeout: 10_000 });
  expect(await frame.evaluate(() => window.__menuMai)).toBe(false);
  expect(await frame.evaluate(() => window.cosaVede())).not.toContain(SEGRETO);
});

test('la cronologia aperta dall\'utente non si fa leggere dal sito con la ricerca testuale del browser', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  // Prima che l'utente apra la cronologia il segreto non è nel documento: window.find non lo trova.
  expect(await page.evaluate(() => window.find('pw-Segreta', true, false, true))).toBe(false);

  // L'utente apre lui la cronologia per incollare.
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);

  // Il sito prova a ricostruire il testo interrogando window.find lettera per lettera: non ci riesce
  // (il testo è contenuto generato, non un nodo cercabile).
  const ricostruito = await page.evaluate(() => {
    const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
    let noto = 'pw-';
    if (!window.find(noto, true, false, true)) return 'niente';
    for (let g = 0; g < 60; g++) {
      let ok = false;
      for (const c of abc) {
        getSelection().removeAllRanges();
        if (window.find(noto + c, true, false, true)) { noto += c; ok = true; break; }
      }
      if (!ok) break;
    }
    return noto;
  });
  expect(ricostruito, 'il sito non deve ricostruire il testo della cronologia').not.toBe(SEGRETO);

  // Resta ciò che serve all'utente: la voce la vede e la incolla lui.
  const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO);
  await page.mouse.move(voce.incolla.x, voce.incolla.y, { steps: 3 });
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});

// Un font del sito diviso in un pezzo per carattere: i pezzi che il browser carica dicono quali caratteri ha
// disegnato. Il sito lo dichiara col nome di ogni famiglia che il pannello potrebbe chiedere, generiche comprese.
const FAMIGLIE_SPIA = ['Spia', 'Segoe UI', 'Roboto', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'];
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const PAGINA_FONT = `<!doctype html><html><head><style>
${FAMIGLIE_SPIA.flatMap((fam) => [...ALFABETO].map((c) => {
    const cp = c.codePointAt(0).toString(16);
    return `@font-face{font-family:'${fam}';src:url('/spia-${cp}.woff');unicode-range:U+${cp};}`;
  })).join('\n')}
html { --sn-font: 'Spia', monospace !important; }
.sn-menu, .sn-menu * { font-family: monospace !important; }
</style></head><body style="padding:40px;font-family:monospace">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
  window.caratteriVisti = () => [...document.fonts].filter((f) => f.status !== 'unloaded')
    .map((f) => String.fromCodePoint(parseInt(f.unicodeRange.replace(/^U\\+/i, ''), 16))).join('');
  </script>
</body></html>`;

test('la cronologia aperta dall\'utente non dice al sito quali caratteri contiene, nemmeno col suo font', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  const page = await testServer.openReady(openTab, PAGINA_FONT);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  expect(await page.evaluate(() => window.caratteriVisti())).toBe('');

  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  await page.waitForTimeout(800);

  const visti = await page.evaluate(() => window.caratteriVisti());
  // 5, 8, 9 e la S maiuscola stanno solo nella password.
  for (const c of ['5', '8', '9', 'S']) {
    expect(visti, `il sito non deve sapere che la cronologia contiene «${c}»`).not.toContain(c);
  }
});
