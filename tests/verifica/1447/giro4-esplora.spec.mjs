// #1447 giro 4 — esplorazione: porte dei giri passati ripetute coi passi della critica, e casi vicini.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <textarea id="nocheck" spellcheck="false" lang="it" style="display:block;width:760px;height:60px;font:22px monospace"></textarea>
</body>`;

async function prepara(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
}
async function pronta(app, page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
}
const testoDi = (page, sel) => page.locator(sel).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText.replace(/ /g, ' ')));
async function svuota(page, sel) {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

test('apostrofi e accenti, casi vicini', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await pronta(app, page);
  const casi = [
    ["E' vero ", 'È vero '],
    ["Non so perche'?", 'Non so perché?'],
    ["Vado all'universita' ", "Vado all'università "],
    ["Ne' io ne' te ", 'Né io né te '],
    ["L'italia e' bella ", "L'Italia è bella "],
    ["Sara' bello, gia' fatto ", 'Sarà bello, già fatto '],
    ["Un po' di te' ", "Un po' di tè "],
    ["Non puo' farlo pero' ", 'Non può farlo però '],
    ["Domani a milano con l'amica di marco ", "Domani a Milano con l'amica di Marco "],
  ];
  const out = [];
  for (const [scritto, atteso] of casi) {
    await svuota(page, '#ta');
    await page.keyboard.type(scritto);
    out.push([scritto, await testoDi(page, '#ta'), atteso]);
  }
  for (const [s, v, a] of out) console.log(`TA «${s}» → «${v}»  atteso «${a}» ${v === a ? 'OK' : 'NO'}`);
  const outCe = [];
  for (const [scritto, atteso] of casi.slice(0, 5)) {
    await svuota(page, '#ce');
    await page.keyboard.type(scritto);
    outCe.push([scritto, await testoDi(page, '#ce'), atteso]);
  }
  for (const [s, v, a] of outCe) console.log(`CE «${s}» → «${v}»  atteso «${a}» ${v === a ? 'OK' : 'NO'}`);
});

test('nome annullato non segnato; spellcheck false; incolla; invio in textarea; destro dopo modifiche prima', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await pronta(app, page);
  await page.locator('#ta').click();
  await page.keyboard.type('Domani vedo marco ');
  console.log('dopo spazio:', await testoDi(page, '#ta'));
  await page.keyboard.press('Control+z');
  console.log('dopo annulla:', await testoDi(page, '#ta'));
  await page.keyboard.type('al mare. ');
  await page.waitForTimeout(2000);
  console.log('segni marco:', await page.locator('.sn-spell-overlay .sn-errore', { hasText: 'marco' }).count());

  await page.locator('#nocheck').click();
  await page.keyboard.type('ok perchè marco ');
  console.log('spellcheck=false:', await testoDi(page, '#nocheck'));

  await svuota(page, '#ta');
  await page.evaluate(() => navigator.clipboard && 0);
  await app.evaluate(({ clipboard }) => clipboard.writeText('ok perchè marco '));
  await page.keyboard.press('Control+v');
  await page.keyboard.type('poi ');
  console.log('incolla:', await testoDi(page, '#ta'));

  await svuota(page, '#ta');
  await page.keyboard.type('Non so perchè');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ciao marco');
  await page.keyboard.press('Shift+Enter');
  console.log('invio textarea:', JSON.stringify(await testoDi(page, '#ta')));

  await svuota(page, '#ce');
  await page.keyboard.type('Domani vedo marco al mare. ');
  console.log('ce:', await testoDi(page, '#ce'));
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Ieri e ');
  console.log('ce dopo inserimento:', await testoDi(page, '#ce'));
  const p = await page.evaluate(() => {
    const el = document.getElementById('ce');
    const t = el.firstChild && el.innerText;
    const i = t.indexOf('Marco');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let tot = 0; const r = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const len = n.nodeValue.length;
      if (i >= tot && i + 2 <= tot + len) { r.setStart(n, i - tot + 1); r.setEnd(n, i - tot + 3); break; }
      tot += len;
    }
    const q = r.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  const c = await menu.voce('Annulla correzione').count().catch(() => -1);
  console.log('voce annulla dopo modifica prima:', c);
  if (c > 0) {
    await menu.voce('Annulla correzione').click();
    await page.waitForTimeout(300);
    console.log('ce dopo annulla destro:', await testoDi(page, '#ce'));
  }
  await page.keyboard.press('Escape');
});

const CHAT = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="log"></div>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:60px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <script>
    const manda = (testo) => { const d = document.createElement('p'); d.textContent = testo; document.getElementById('log').appendChild(d); };
    document.getElementById('ce').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(e.target.innerText); e.target.innerHTML = ''; }
    });
  </script>
</body>`;

test('chat: i passi del giro 2', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, CHAT, { pubblico: true });
  await pronta(app, page);
  await page.locator('#ce').click();
  await page.keyboard.type('ci vediamo stasera?');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ok porto la pizza');
  await page.keyboard.press('Enter');
  await page.keyboard.type('allora da marco ');
  await page.waitForTimeout(300);
  console.log('chat ce:', await testoDi(page, '#ce'));
  await page.keyboard.press('Enter');
  await page.reload();
  await pronta(app, page);
  await page.locator('#ce').click();
  await page.keyboard.type('domani da marco ');
  await page.waitForTimeout(300);
  console.log('chat ce ricaricata:', await testoDi(page, '#ce'));
});
