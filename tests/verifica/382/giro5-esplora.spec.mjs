// Esplorazione del giro 5 (si cancella): aspetto della bolla in attesa e delle righe non controllate, nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_finti.mjs';

for (const tema of ['dark', 'light']) {
  test(`aspetto ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(120_000);
    await mockScryfall(app);
    await mockProvider(app);
    await app.evaluate(() => {
      const card = (k, cmc) => ({
        id: `c-${k}`, name: k % 40 === 1 ? `Giusta ${k}` : `Carta ${k}`, mana_cost: `{${cmc}}{R}`, cmc: cmc + 1,
        type_line: 'Artifact', oracle_text: k % 40 === 1 ? 'Creatures you control have haste.' : 'Haste',
        colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/${k}.jpg` },
        prices: { eur: '0.10' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${k}`,
      });
      let k = 0;
      globalThis.__pages = [175, 175, 60].map((size, p) => Array.from({ length: size }, () => card(++k, p)));
      globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste alle altre creature.', query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
      globalThis.__judge = (prompt) => (/Carta 5[1-9] |Carta 6\d /.test(prompt) && /Carta 60 /.test(prompt) ? 'boh'
        : JSON.stringify({ keep: prompt.split('\n').filter((l) => /^\d+\. Giusta /.test(l)).map((l) => Number(l.split('.')[0])) }));
      globalThis.__judgeGate = new Promise((r) => { globalThis.__openGate = r; });
    });
    const page = await openTab('filo://decks/decks.html');
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForLoadState('domcontentloaded');
    await deckWithCommander(page);
    await page.fill('#chatInput', 'carte che danno haste');
    await page.press('#chatInput', 'Enter');
    const bubble = page.locator('.dk-msg-bot').last();
    await expect(bubble.locator('.dk-progress')).toContainText('Controllo', { timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/v382g5-attesa-${tema}.png` });
    await app.evaluate(() => globalThis.__openGate());
    await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/v382g5-fine-${tema}.png` });
    console.log(tema, await bubble.innerText());
  });
}
