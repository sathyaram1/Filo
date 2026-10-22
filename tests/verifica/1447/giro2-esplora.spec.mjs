// Verifica #1447 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <iframe id="fr" style="width:760px;height:120px" srcdoc="<body contenteditable='true' lang='it' style='font:22px monospace'></body>"></iframe>
  <input id="in" lang="it" style="width:760px;font:22px monospace">
</body>`;

async function prepara(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
    const finto = async () => ({ text: 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}
async function apri(app, openTab, testServer) {
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const valore = (page, sel = '#ta') => page.locator(sel).inputValue();

test('fissi e varianti', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("Un pò di tempo, qual'è il punto? E' vero perchè\nPERCHÈ no. Perche ");
  console.log('FISSI:', JSON.stringify(await valore(page)));
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('Scrivo #marco e @marco e claude, anthropic! ');
  console.log('HASH:', JSON.stringify(await valore(page)));
  await page.locator('#in').click();
  await page.keyboard.type('Domani vedo marco perchè ');
  console.log('INPUT:', JSON.stringify(await valore(page, '#in')));
  const fr = page.frameLocator('#fr');
  await fr.locator('body').click();
  await page.keyboard.type('Domani vedo marco perchè ');
  console.log('IFRAME:', JSON.stringify(await fr.locator('body').innerText()));
});

test('contenteditable annulla', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('Ok perchè ');
  console.log('CE1:', JSON.stringify(await page.locator('#ce').innerText()));
  await page.keyboard.press('Control+z');
  console.log('CE2:', JSON.stringify(await page.locator('#ce').innerText()));
  await page.keyboard.type('va bene ');
  console.log('CE3:', JSON.stringify(await page.locator('#ce').innerText()));
  // Correzione e poi Backspace: torna la parola com'era?
  await page.keyboard.type('perchè ');
  await page.keyboard.press('Backspace');
  console.log('CE4:', JSON.stringify(await page.locator('#ce').innerText()));
});

test('chat di casa: tasto destro, annulla, invio e messaggio dopo', async ({ app, openTab }) => {
  await prepara(app);
  const casa = await openTab('filo://dashboard/dashboard.html');
  await expect.poll(() => casa.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 8000 }).toBe('input');
  await casa.waitForTimeout(1500);
  const input = casa.locator('#input');
  await casa.keyboard.type('Domani vedo marco al mare ');
  console.log('CASA1:', JSON.stringify(await input.inputValue()));
  // tasto destro su «Marco»
  const box = await input.boundingBox();
  const p = await casa.evaluate(() => {
    const ta = document.getElementById('input');
    const cs = getComputedStyle(ta);
    const div = document.createElement('div');
    for (const k of ['font', 'padding', 'border', 'width', 'letterSpacing', 'lineHeight', 'boxSizing', 'whiteSpace', 'wordWrap']) div.style[k] = cs[k];
    div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.whiteSpace = 'pre-wrap';
    const t = ta.value;
    div.textContent = t.slice(0, 12);
    const s = document.createElement('span'); s.textContent = t.slice(12, 17); div.appendChild(s);
    document.body.appendChild(div);
    const r = ta.getBoundingClientRect(); const d = div.getBoundingClientRect(); const q = s.getBoundingClientRect();
    div.remove();
    return { x: r.left + (q.left - d.left) + q.width / 2 - ta.scrollLeft, y: r.top + (q.top - d.top) + q.height / 2 - ta.scrollTop };
  });
  console.log('BOX', JSON.stringify(box), JSON.stringify(p));
  await casa.mouse.click(p.x, p.y, { button: 'right' });
  await casa.waitForTimeout(1200);
  const menu = menuDi(casa);
  const voci = await menu.voci.allInnerTexts().catch(() => []);
  console.log('CASA-MENU:', JSON.stringify(voci));
  await casa.screenshot({ path: 'tests/.shots/1447-g2-casa-menu.png' }).catch(() => {});
  await casa.keyboard.press('Escape');
  await input.click();
  await casa.keyboard.press('End');
  await casa.keyboard.type('perchè ');
  console.log('CASA2:', JSON.stringify(await input.inputValue()));
  await casa.keyboard.press('Control+z');
  console.log('CASA3:', JSON.stringify(await input.inputValue()));
  await casa.keyboard.press('Enter');
  await casa.waitForTimeout(1500);
  console.log('CASA4 dopo invio:', JSON.stringify(await input.inputValue()));
  await input.click();
  await casa.keyboard.type('Ok perchè no e marco ');
  console.log('CASA5:', JSON.stringify(await input.inputValue()));
});

test('interruttore spento da Opzioni vale subito nella pagina aperta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const altro = await openTab('filo://options/altro.html');
  await altro.locator('#spellcheckAutomatica').uncheck();
  await page.bringToFront();
  await page.locator('#ta').click();
  await page.keyboard.type('Ok perchè e marco ');
  console.log('SPENTO:', JSON.stringify(await valore(page)));
});

test('testo lungo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => { document.getElementById('ta').value = 'Ciao. '.repeat(20000); });
  await page.locator('#ta').click();
  await page.keyboard.press('Control+End');
  const t0 = Date.now();
  await page.keyboard.type('perchè ');
  console.log('LUNGO:', JSON.stringify((await valore(page)).slice(-12)), Date.now() - t0, 'ms');
});
