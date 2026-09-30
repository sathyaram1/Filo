// #382 giro 2, rilievo 1: il giudice decide solo su ciò che il suo prompt gli fa vedere. Il giudice finto qui è
// SEVERO come un modello onesto: tiene una carta solo se il prompt gli dà i dati per verificarla, altrimenti niente.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_mock.mjs';

// Nel main: la parte del prompt prima della lista, e le righe delle carte.
async function helpers(app) {
  await app.evaluate(() => {
    globalThis.__head = (prompt) => prompt.split('CARTE CANDIDATE:')[0];
    globalThis.__lines = (prompt) => (prompt.split('CARTE CANDIDATE:')[1] || '').split('\n').filter((l) => /^\d+\. /.test(l));
  });
}

async function open(openTab) {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  return page;
}

test('una richiesta che parla del commander: il giudice sa chi è', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await helpers(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__pages = [[
      card('opt-1', 'Opt', 1, 'Instant', 'Scry 1. Draw a card.', ['U']),
      card('ogre-1', 'Hulking Ogre', 3, 'Creature — Ogre', "Hulking Ogre can't block creatures with power 2 or less."),
    ]];
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte per il tuo commander.', query: '(t:instant or t:sorcery or t:creature)', filter: 'carte che sinergizzano con il commander del mazzo' });
    // Sa giudicare la sinergia solo se il prompt dice chi è il commander.
    globalThis.__judge = (prompt) => {
      if (!/Niv-Mizzet/.test(globalThis.__head(prompt))) return JSON.stringify({ keep: [] });
      return JSON.stringify({ keep: globalThis.__lines(prompt).filter((l) => /Instant|Sorcery/.test(l)).map((l) => Number(l.split('.')[0])) });
    };
  });
  const page = await open(openTab);
  const bubble = await send(page, 'carte in sinergia col mio commander');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Opt');
});

test('una richiesta col prezzo: il giudice vede quanto costa ogni carta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await helpers(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    const cheap = card('shock-1', 'Shock', 1, 'Instant', 'Shock deals 2 damage to any target.');
    const pricey = { ...card('fury-1', 'Fury', 5, 'Creature — Elemental Incarnation', 'Double strike. When Fury enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.'), prices: { eur: '32.00' } };
    cheap.prices = { eur: '0.20' };
    globalThis.__pages = [[cheap, pricey]];
    globalThis.__chat = () => JSON.stringify({ query: '(o:damage or o:deals) eur<1', filter: 'infligge danni a una creatura e costa meno di 1 euro' });
    // Sa giudicare «meno di 1 euro» solo se ogni riga porta il prezzo.
    globalThis.__judge = (prompt) => {
      const ls = globalThis.__lines(prompt);
      if (!ls.every((l) => /€|eur/i.test(l))) return JSON.stringify({ keep: [] });
      return JSON.stringify({ keep: ls.filter((l) => /0[.,]20/.test(l)).map((l) => Number(l.split('.')[0])) });
    };
  });
  const page = await open(openTab);
  const bubble = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble.locator('.dk-row-name')).toHaveText(['Shock']);
});

test('un seguito senza "filter" dal modello: il giudice non perde la richiesta di prima', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await helpers(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__pages = [[
      card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste'),
      card('fervor-1', 'Fervor', 2, 'Enchantment', 'Creatures you control have haste.'),
    ]];
    let n = 0;
    globalThis.__chat = () => (++n === 1
      ? JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' })
      : JSON.stringify({ query: '(o:"have haste" or o:haste) cmc<=2' }));
    // Tiene chi DÀ haste se il prompt porta la richiesta di haste (le regole fisse la nominano già, la frase no);
    // altrimenti giudica solo il costo, e passano tutte.
    globalThis.__judge = (prompt) => {
      const ls = globalThis.__lines(prompt);
      const keep = /danno haste|haste ad altre/i.test(globalThis.__head(prompt)) ? ls.filter((l) => /have haste/.test(l)) : ls;
      return JSON.stringify({ keep: keep.map((l) => Number(l.split('.')[0])) });
    };
  });
  const page = await open(openTab);
  const first = await send(page, 'carte che danno haste');
  await expect(first.locator('.dk-row-name')).toHaveText(['Fervor']);
  const next = await send(page, 'e solo quelle che costano poco');
  await expect(next.locator('.dk-row-name')).toHaveText(['Fervor']);
});
