// Verifica #592, giro 5 — le due cose che la correzione del giro 4 ha lasciato
// dietro di sé.
//
// Il giro 4 ha chiuso la rilettura che buttava via il testo non salvato, ha
// messo un elenco di cose LECITE sul canale delle pagine web, e ha dato un
// tetto e una ripulitura all'id del modello. Qui si guarda il rovescio di
// quelle tre cure:
//
//   1. per non cancellare i propri avvisi appena mostrati, una pagina di
//      impostazioni adesso IGNORA per un secondo e mezzo tutto quello che
//      cambia altrove — anche quello che non ha scritto lei. In quella
//      finestra la pagina torna a mostrare valori che non sono più veri, e i
//      due salvataggi dell'aspetto (i colori/le misure e il colore delle
//      schede) rimandano il blocco INTERO senza confronto: la porta del giro 3
//      si riapre da lì.
//   2. l'id del modello viene ripulito dai marcatori dei recinti e POI gli
//      spazi vengono compattati: un marcatore scritto con due spazi in mezzo
//      si ricompone dopo la ripulitura. È lo stesso difetto del giro 1 (la
//      ripulitura che passa una volta sola), sull'altro campo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const eseguiInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 20_000 });
  await page.waitForSelector('#tok-radius', { timeout: 20_000 });
  return page;
}

// ── 1. la finestra di silenzio dopo un salvataggio della pagina ─────────────

test('un colore chiesto a Filo subito dopo un tocco sulla pagina non deve essere disfatto dal ritocco successivo', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // Punto di partenza noto.
  await pagina.fill('#tok-radius', '11px');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).themeTokens?.radius).toBe('11px');

  // 1. l'utente tocca una spunta qualunque della pagina: da qui la pagina
  //    smette di ascoltare per un secondo e mezzo.
  await pagina.uncheck('#showHomeMessage');

  // 2. nello stesso momento chiede a Filo un colore d'accento, e Filo lo
  //    applica. In memoria c'è.
  await eseguiInChat(pagina, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).themeTokens?.accent).toBe('#0055ff');

  // 3. poi ritocca una misura dell'aspetto. Non ha chiesto di disfare niente:
  //    il colore che ha chiesto a voce deve restare.
  await pagina.fill('#tok-radius', '12px');
  await pagina.waitForTimeout(2500);

  const dopo = (await impostazioni(pagina)).themeTokens || {};
  expect(dopo.radius).toBe('12px');
  expect(dopo.accent).toBe('#0055ff');
});

test('una protezione spenta a voce subito dopo un tocco sulla pagina non deve restare mostrata accesa', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // Modalità terminale accesa dalla pagina.
  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  // L'utente tocca un'altra spunta della pagina e nello stesso momento fa
  // spegnere il terminale a Filo, confermando.
  await pagina.uncheck('#showHomeMessage');
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // La pagina che ha quel permesso sotto gli occhi deve dirlo spento.
  await expect.poll(
    async () => pagina.$eval('#terminalEnabled', (el) => el.checked),
    { timeout: 4000 },
  ).toBe(false);
});

// ── 2. l'id del modello: la ripulitura e poi gli spazi compattati ───────────

// I due che seguono documentano un difetto VERO che questo giro non corregge:
// il server ha mandato quel rilievo a un feedback a parte. `test.fail()` dice
// «mi aspetto che non passi»: la corsa resta verde, la prova resta scritta, e
// il giorno in cui il difetto viene chiuso è questa riga a diventare rossa, per
// dire che il `test.fail()` va tolto.
test("l'id del modello non deve poter ricomporre un marcatore dei recinti", async ({ openTab }) => {
  test.fail();
  const pagina = await apriPreferenze(openTab);

  const esiti = await pagina.evaluate(() => {
    const C = window.SN_CONST;
    const marcatori = [
      C.AGENT_STYLE_OPEN, C.AGENT_STYLE_CLOSE, C.AGENT_STYLE_SLOT,
    ];
    const out = [];
    for (const m of marcatori) {
      // Lo stesso marcatore con due spazi al posto di uno: la ripulitura non
      // lo riconosce, e la compattazione degli spazi che viene DOPO lo
      // rimette insieme.
      const spezzato = m.replace(' ', '  ');
      const pulito = C.sanitizeModelName(spezzato);
      out.push({ marcatore: m, dentro: marcatori.some((x) => pulito.includes(x)) });
    }
    return out;
  });

  for (const e of esiti) expect(e.dentro, `marcatore ricomposto: ${e.marcatore}`).toBe(false);
});

test('un segnaposto ricomposto dal nome del modello non deve stampare un secondo recinto dello stile', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  const quanti = await pagina.evaluate(() => {
    const C = window.SN_CONST;
    const finto = C.sanitizeModelName(C.AGENT_STYLE_SLOT.replace(' ', '  '));
    const messaggi = [{
      role: 'system',
      content: `ISTRUZIONI ${C.AGENT_STYLE_SLOT}CONTESTO. Il modello che ti sta eseguendo è ${finto}.`,
    }];
    const fuori = C.injectAgentStyle(messaggi, C.ACTIONS.FILO_CHAT, 'Parla breve.');
    return (fuori[0].content.match(/STILE DI SCRITTURA SCELTO/g) || []).length;
  });

  expect(quanti).toBe(1);
});
