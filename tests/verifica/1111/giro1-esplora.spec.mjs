// Verifica #1111: correggendo una parola, i segni del correttore sulle altre restano mentre lo scan ricalcola.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<textarea id="ta" style="display:block;width:700px;height:140px;font:20px monospace"></textarea>
<div id="ce" contenteditable="true" style="width:700px;min-height:80px;font:20px monospace;border:1px solid #888;margin-top:20px"></div>
</body>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__scan = 0;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      if (t.includes('Analizza il testo qui sotto')) {
        globalThis.__scan += 1;
        await new Promise((r) => setTimeout(r, globalThis.__ritardo || 0));
        const parole = [...new Set(t.match(/xq[a-z]+\d+/g) || [])];
        return { text: JSON.stringify({ annotated: parole.map((w) => `**${w}**`).join(' '), issues: parole.map((w) => ({ type: 'grammar', explanation: 'x', correction: w.slice(2, -1) })) }), model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      }
      return { text: '{"misspelled":false,"correction":""}', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

async function apri(app, openTab, testServer) {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

// Registra ogni stato dell'overlay: quali parole sono segnate e se il testo sotto i segni è allineato al campo.
function sorveglia(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    globalThis.__stati = [];
    const leggi = () => {
      const o = document.querySelector('.sn-spell-overlay');
      if (!o) { globalThis.__stati.push({ segni: [], nessunOverlay: true }); return; }
      const v = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      const segni = [...o.querySelectorAll('.sn-semantic-error')].map((x) => x.textContent);
      globalThis.__stati.push({ segni, allineato: !segni.length || o.textContent === v });
    };
    globalThis.__mo = new MutationObserver(leggi);
    const o = document.querySelector('.sn-spell-overlay');
    globalThis.__mo.observe(o, { childList: true, subtree: true, characterData: true });
    globalThis.__iv = setInterval(leggi, 20);
  }, sel);
}
const stati = (page) => page.evaluate(() => { clearInterval(globalThis.__iv); globalThis.__mo.disconnect(); return globalThis.__stati; });
const segni = (page) => page.locator('.sn-spell-overlay .sn-semantic-error');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function controllaStati(lista, devonoRestare) {
  expect(lista.length).toBeGreaterThan(10);
  for (const s of lista) {
    expect(s.nessunOverlay, 'overlay sparito').toBeFalsy();
    for (const w of devonoRestare) expect(s.segni, `segno di ${w} sparito: ${JSON.stringify(s)}`).toContain(w);
    expect(s.allineato, `segni disallineati: ${JSON.stringify(s)}`).toBe(true);
  }
}

test('textarea: correggo a tastiera una parola, gli altri segni restano mentre lo scan lento ricalcola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi xqprima1 poi xqseconda2 e xqterza3 fine ');
  await expect(segni(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 8000 });
  await app.evaluate(() => { globalThis.__ritardo = 2500; });
  await sorveglia(page, '#ta');
  // Seleziona la parola e riscrivila, come chi corregge.
  await page.evaluate(() => { const ta = document.getElementById('ta'); const i = ta.value.indexOf('xqseconda2'); ta.setSelectionRange(i, i + 'xqseconda2'.length); });
  await page.keyboard.type('seconda', { delay: 60 });
  await expect(segni(page)).toHaveText(['xqprima1', 'xqterza3'], { timeout: 1000 });
  await pausa(5000);
  controllaStati(await stati(page), ['xqprima1', 'xqterza3']);
  await expect(segni(page)).toHaveText(['xqprima1', 'xqterza3']);

  // Backspace in coda a una parola segnata, poi parole nuove in testa: i segni rimasti scorrono allineati.
  await sorveglia(page, '#ta');
  await page.evaluate(() => { const ta = document.getElementById('ta'); const i = ta.value.indexOf('xqterza3') + 8; ta.setSelectionRange(i, i); });
  await page.keyboard.press('Backspace');
  await page.evaluate(() => { const ta = document.getElementById('ta'); ta.setSelectionRange(0, 0); });
  await page.keyboard.type('ecco ', { delay: 60 });
  await pausa(5500);
  controllaStati(await stati(page), ['xqprima1']);
  await expect(segni(page)).toHaveText(['xqprima1']);
});

test('textarea: tasto destro sul segno e clic sulla correzione nel menu, gli altri segni restano', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi xqprima1 poi xqseconda2 e xqterza3 fine ');
  await expect(segni(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 8000 });
  await app.evaluate(() => { globalThis.__ritardo = 2500; });
  await sorveglia(page, '#ta');
  const b = await segni(page).nth(1).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await pausa(600);
  await page.locator('.sn-menu').getByText('seconda', { exact: true }).first().click();
  await expect(page.locator('#ta')).toHaveValue('oggi xqprima1 poi seconda e xqterza3 fine ');
  await pausa(5000);
  controllaStati(await stati(page), ['xqprima1', 'xqterza3']);
  await expect(segni(page)).toHaveText(['xqprima1', 'xqterza3']);
  // Due correzioni di fila a scan in volo, poi annulla: i segni non toccati restano sempre.
  await sorveglia(page, '#ta');
  const c = await segni(page).nth(1).boundingBox();
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2, { button: 'right' });
  await page.locator('.sn-menu').getByText('terza', { exact: true }).first().click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ta')).toHaveValue('oggi xqprima1 poi seconda e xqterza3 fine ');
  await pausa(5000);
  controllaStati(await stati(page), ['xqprima1']);
  await expect(segni(page)).toHaveText(['xqprima1', 'xqterza3']);
});

test('contenteditable: correggo a tastiera una parola, gli altri segni restano', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('oggi xqprima1 poi xqseconda2 e xqterza3 fine ');
  await expect(segni(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 8000 });
  await app.evaluate(() => { globalThis.__ritardo = 2500; });
  await sorveglia(page, '#ce');
  await page.evaluate(() => {
    const n = document.getElementById('ce').firstChild; const i = n.textContent.indexOf('xqseconda2');
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 10);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await page.keyboard.type('seconda', { delay: 60 });
  await pausa(5000);
  controllaStati(await stati(page), ['xqprima1', 'xqterza3']);
  await expect(segni(page)).toHaveText(['xqprima1', 'xqterza3']);
});
