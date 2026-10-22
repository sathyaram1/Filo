// Giro 7, esplorazione: casi insoliti della correzione automatica a fine parola.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
</body>`;

async function apri(app, openTab, testServer, correttore = {}) {
  await app.evaluate(async (_e, correttore) => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, ripetizioni: true, automatica: true, ...correttore },
    });
  }, correttore);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const valore = (page) => page.locator('#ta').inputValue();
const ce = (page) => page.locator('#ce').evaluate((el) => el.innerText.replace(/ /g, ' '));
async function svuota(page, sel = '#ta') {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}
async function prova(page, sel, testo, atteso, extra = null) {
  await svuota(page, sel);
  await page.keyboard.type(testo);
  if (extra) await page.keyboard.press(extra);
  await page.waitForTimeout(250);
  const v = sel === '#ta' ? await valore(page) : await ce(page);
  console.log(`PROVA ${sel} ${JSON.stringify(testo)}${extra ? '+' + extra : ''} => ${JSON.stringify(v)}`);
  expect.soft(v, `${sel} ${testo}`).toBe(atteso);
}

test('casi vari', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await apri(app, openTab, testServer);
  await prova(page, '#ta', "E' vero ", 'È vero ');
  await prova(page, '#ta', 'Perchè no ', 'Perché no ');
  await prova(page, '#ta', 'Qual\'è il punto ', 'Qual è il punto ');
  await prova(page, '#ta', 'Un pò. ', "Un po'. ");
  await prova(page, '#ta', 'Domani vedo marco perchè non so ', 'Domani vedo Marco perché non so ');
  await prova(page, '#ta', 'Ciao 😀 marco perchè ', 'Ciao 😀 Marco perché ');
  await prova(page, '#ce', 'Ciao 😀 marco perchè ', 'Ciao 😀 Marco perché ');
  await prova(page, '#ce', 'Ciao 👨‍👩‍👧 marco ok ', 'Ciao 👨‍👩‍👧 Marco ok ');
  await prova(page, '#ta', 'Ciao marco', 'Ciao Marco\n', 'Enter');
  await prova(page, '#ce', 'Ciao marco', 'Ciao Marco\n', 'Enter');
  await prova(page, '#ce', 'Non so perchè', 'Non so perché\n', 'Enter');
  await prova(page, '#ta', 'Ho chiesto a chatgpt? ', 'Ho chiesto a ChatGPT? ');
  await prova(page, '#ta', 'Ok MARCO ', 'Ok MARCO ');
  await prova(page, '#ta', 'Usa:\n```\nnpm install anthropic ', 'Usa:\n```\nnpm install anthropic ');
  await prova(page, '#ta', 'Il comando `pip install anthropic` ', 'Il comando `pip install anthropic` ');
  await prova(page, '#ta', 'Sono felice e chiara la cosa ', 'Sono felice e chiara la cosa ');
  await prova(page, '#ta', 'Ciao #marco ', 'Ciao #marco ');
  await prova(page, '#ta', 'Vado da lucia ', 'Vado da Lucia ');
  await prova(page, '#ta', 'Ci vediamo da marco ', 'Ci vediamo da Marco ');
  await prova(page, '#ta', 'ci vediamo da marco ', 'ci vediamo da Marco ');
});

test('testo lungo: la correzione arriva subito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.locator('#ta').evaluate((el) => { el.value = 'Ciao a tutti. '.repeat(1500); el.setSelectionRange(el.value.length, el.value.length); });
  await page.keyboard.type('x');
  const t0 = Date.now();
  await page.keyboard.type(' Domani vedo marco perchè ');
  const dt = Date.now() - t0;
  const v = await valore(page);
  console.log('LUNGO ms', dt, JSON.stringify(v.slice(-40)));
  expect.soft(v.endsWith('Domani vedo Marco perché ')).toBe(true);
});

test('interruttore e soglie cambiati con la pagina aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await apri(app, openTab, testServer);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ correttore: { automatica: false } }); });
  await page.waitForTimeout(800);
  await prova(page, '#ta', 'ok perchè ', 'ok perchè ');
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ correttore: { automatica: true, annulliPerImparare: 1 } }); });
  await page.waitForTimeout(800);
  await prova(page, '#ta', 'ok perchè ', 'ok perché ');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect.soft(await valore(page)).toBe('ok perchè ');
  await prova(page, '#ta', 'ancora perchè ', 'ancora perchè ');
  const imp = await app.evaluate(async () => (await globalThis.chrome.storage.local.get('sn_correttore_imparato')).sn_correttore_imparato);
  console.log('IMPARATO', JSON.stringify(imp));
  // Un errore vero resta segnato anche se non si corregge più da sé.
  await page.waitForTimeout(800);
  const segni = await page.locator('.sn-spell-overlay .sn-errore').allTextContents();
  console.log('SEGNI', JSON.stringify(segni));
  expect.soft(segni.join('|')).toContain('perchè');
});

test('nome con maiuscola scritta a mano in chat dove si comincia minuscolo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const CHAT = `<!doctype html><meta charset="utf-8"><body><div id="log"></div>
  <textarea id="ta" lang="it" style="width:700px;height:80px;font:20px monospace"></textarea>
  <script>document.getElementById('ta').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const p = document.createElement('p'); p.textContent = e.target.value; document.getElementById('log').appendChild(p); e.target.value = ''; } });</script></body>`;
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  const page = await testServer.openReady(openTab, CHAT, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.locator('#ta').click();
  for (const m of ['ok ci vediamo da Giulia', 'si va bene', 'ho sentito Paolo ieri']) {
    await page.keyboard.type(m);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('allora da marco ');
  await page.waitForTimeout(200);
  const v = await valore(page);
  console.log('CHAT MISTA', JSON.stringify(v));
  expect.soft(v).toBe('allora da Marco ');
});
