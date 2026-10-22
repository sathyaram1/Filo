// Esplorazione del giro 3 di verifica (#1447): stampa cosa succede, non asserisce.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <textarea id="nosp" spellcheck="false" lang="it" style="display:block;width:760px;height:60px"></textarea>
  <div id="log"></div>
  <textarea id="chat" lang="it" style="display:block;width:760px;height:60px"></textarea>
  <script>
    document.getElementById('chat').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const d = document.createElement('p'); d.className = 'msg'; d.textContent = e.target.value; document.getElementById('log').appendChild(d); e.target.value = ''; }
    });
  </script>
</body>`;

async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const val = (page, sel = '#ta') => page.locator(sel).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText.replace(/ /g, ' ')));
async function svuota(page, sel = '#ta') {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}
async function prova(page, testo, sel = '#ta') {
  await svuota(page, sel);
  await page.keyboard.type(testo);
  await page.waitForTimeout(150);
  const v = await val(page, sel);
  console.log(`ESITO ${sel} ${JSON.stringify(testo)} -> ${JSON.stringify(v)}`);
  return v;
}

test('fissi e nomi', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  for (const t of ["E' vero ", 'Perchè no ', 'PERCHÈ ', 'ok qual’è ', 'ok e’ vero ', "ok perche' no ", "ok piu' tardi ", "ok cosi' bene ",
    "vado in l'italia ", "il sud dell'europa ", "ho l'iphone ", 'vai su github.com/marco ', 'ciao @marco ', 'Ciao #roma ',
    'ho visto marco: bello ', 'Visto (marco) ', 'Ok marco. ', 'Domani marco-polo ', 'Uso chatgpt e openai ', 'Ok iphone ',
    'Oggi alice e enzo ', "x = 'e' ", 'Oggi gianpiero ']) {
    await prova(page, t);
  }
  for (const t of ['Ok perchè ', "vado in l'italia "]) await prova(page, t, '#ce');
  await prova(page, 'Ok perchè ', '#nosp');
});

test('Invio in chat', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#chat').click();
  await page.keyboard.type('Ok non so perchè');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ok vediamo marco');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  console.log('ESITO chat inviati', JSON.stringify(await page.locator('.msg').allInnerTexts()));
  await svuota(page);
  await page.keyboard.type('Ok perchè');
  await page.keyboard.press('Enter');
  console.log('ESITO ta a capo', JSON.stringify(await val(page)));
});

test('nomi imparati e propio', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  for (let i = 0; i < 3; i++) await prova(page, 'Oggi ho visto Gianpiero ');
  await prova(page, 'Oggi ho visto gianpiero ');
  for (let i = 0; i < 4; i++) await prova(page, 'Oggi è propio ');
  await page.waitForTimeout(1500);
  console.log('ESITO segni propio', await page.locator('.sn-spell-overlay .sn-errore', { hasText: 'propio' }).count());
  console.log('ESITO dict', JSON.stringify(await app.evaluate(async () => (await globalThis.chrome.storage.local.get('sn_personal_dict')).sn_personal_dict)));
});

test('casa: annulla', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  const casa = await openTab('filo://dashboard/dashboard.html');
  await expect.poll(() => casa.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 8000 }).toBe('input');
  await casa.waitForTimeout(1500);
  await casa.keyboard.type('Ok perchè ');
  console.log('ESITO casa', JSON.stringify(await casa.locator('#input').inputValue()));
  await casa.waitForTimeout(100);
  const lampo = await casa.locator('.sn-spell-lampo').count();
  console.log('ESITO casa lampo', lampo);
  await casa.screenshot({ path: 'tests/.shots/1447-g3-casa-lampo.png' }).catch(() => {});
  await casa.keyboard.press('Control+z');
  console.log('ESITO casa annulla', JSON.stringify(await casa.locator('#input').inputValue()));
  await casa.keyboard.type('marco ');
  console.log('ESITO casa marco', JSON.stringify(await casa.locator('#input').inputValue()));
  const box = await casa.locator('#input').boundingBox();
  await casa.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' });
  await casa.waitForTimeout(800);
  await casa.screenshot({ path: 'tests/.shots/1447-g3-casa-menu.png' }).catch(() => {});
});
