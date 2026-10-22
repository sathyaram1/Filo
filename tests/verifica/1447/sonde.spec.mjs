// Sonde esplorative del giro 5 (da togliere o rinominare prima della registrazione).
import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const S = '/tmp/claude-0/-home-user-Filo/7e446aa1-ef7c-5795-975a-a800d1d63d8c/scratchpad';
const leggi = (n) => fs.readFileSync(`${S}/${n}`, 'utf8');

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

const editore = (corpo, js, avvio, css = '') => `<!doctype html><meta charset="utf-8"><style>${css}</style><body style="padding:20px;font:22px sans-serif" lang="it">
${corpo}<script>${js}</script><script>${avvio}</script></body>`;

const CASI = [
  ['quill', () => editore('<div id="m" style="width:700px;border:1px solid #999;min-height:80px"></div>', leggi('out-quill.js'), "avviaQL(document.getElementById('m'))", leggi('quill.core.css')), '#m .ql-editor', () => window.qlText().replace(/\n$/, '')],
  ['slate', () => editore('<div id="m"></div>', leggi('out-slate.js'), "avviaSL(document.getElementById('m'))"), '#sl', () => window.slText()],
  ['draft', () => editore('<div id="m"></div>', leggi('out-draft.js'), "avviaDF(document.getElementById('m'))"), '[contenteditable]', () => window.dfText()],
];

for (const [nome, html, sel, leggiTesto] of CASI) {
  test(`${nome}: correzione, parola dopo e annulla`, async ({ app, openTab, testServer }) => {
    await prepara(app);
    const page = await testServer.openReady(openTab, html(), { pubblico: true });
    await pronta(app, page);
    const testo = () => page.evaluate(leggiTesto).then((t) => t.replace(/ /g, ' '));
    await page.locator(sel).click();
    await page.keyboard.type('Ciao marco come va, non so perchè ', { delay: 30 });
    await page.waitForTimeout(400);
    const dopo = await testo();
    console.log(nome, 'DOPO SCRITTURA:', JSON.stringify(dopo), 'DOM:', JSON.stringify(await page.locator(sel).innerText()));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const annullato = await testo();
    console.log(nome, 'DOPO ANNULLA:', JSON.stringify(annullato));
    await page.keyboard.type('ok');
    await page.waitForTimeout(300);
    console.log(nome, 'DOPO OK:', JSON.stringify(await testo()));
    expect(dopo).toBe('Ciao Marco come va, non so perché ');
    expect(annullato).toBe('Ciao Marco come va, non so perchè ');
  });
}

const TA = `<!doctype html><meta charset="utf-8"><body style="padding:20px">
<textarea id="ta" lang="it" style="width:760px;height:200px;font:22px monospace"></textarea></body>`;

test('frasi nel campo di testo', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, TA, { pubblico: true });
  await pronta(app, page);
  const frasi = ["Non c'e' problema ", "Dov'e' andato ", "Com'e' andata ", "Cos'e' successo ", "Qual e' il punto ", "Qual'e' il punto ",
    "Vado a roma. Poi ", "Ciao Marco, sei a milano? ", "Ho visto anthropic e claude ", "Vengo lunedi' ", "Ok perche' no ", "Andiamo da gennaro ",
    "Che ne pensi di windows? ", "Scrivo a giulia: ", "Il film di netflix ", "Mi piace youtube ", "Uso whatsapp ", "Vivo in sicilia ",
    "Perchè no? ", "Lo so perchè, ", "Ho detto qual'è ", "Bari è bella "];
  for (const f of frasi) {
    await page.locator('#ta').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(f, { delay: 15 });
    await page.waitForTimeout(150);
    console.log('FRASE', JSON.stringify(f), '->', JSON.stringify(await page.locator('#ta').inputValue()));
  }
});
