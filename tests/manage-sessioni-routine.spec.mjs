// Gestione → Automazioni, le tre scelte su come partono le sessioni delle
// routine. Qui stanno le guardie che devono reggere per sempre; le prove del
// giro di verifica che le ha fatte nascere vivono altrove e non le sostituiscono.
//
// Quello che difendono: la pagina non mostra MAI un valore che non ha letto,
// dice quale account resta quando il prioritario è escluso, e una risposta più
// vecchia non riscrive sullo schermo una scelta più nuova.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, risposte) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate((r) => {
    window.__risposte = r;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') return window.__risposte.get;
      if (msg && msg.type === 'automation_sessions_set') return window.__risposte.set;
      return orig(msg);
    };
  }, risposte);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

test('impostazioni non lette: nessun valore inventato, e la pagina lo dice', async ({ openTab }) => {
  const page = await apri(openTab, { get: { ok: false, error: 'rete giù' }, set: { ok: true } });

  // Il campo resta vuoto invece di mostrare il valore di partenza come se
  // venisse dal server: è quello che fanno anche i bilanci, poco più sotto.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('');
  for (const id of ['#mgMaxSessionsMsg', '#mgPriorityAccountMsg', '#mgAccountsMsg']) {
    await expect(page.locator(id)).toContainText('Non ho potuto leggere dal server');
  }
  // Nessuna pillola accesa: «si alternano» sarebbe una risposta, e non l'abbiamo.
  expect(await page.locator('input[name="mgPriorityAccount"]:checked').count()).toBe(0);
  // E nessun avviso che dipende da uno stato che non conosciamo.
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
});

test('scritto ma non riletto: lo dice, e non spegne la scelta appena salvata', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 6, priorityAccount: '', accountAOff: false, accountBOff: false },
    // La scrittura è andata; la rilettura che la segue no, quindi tornano solo
    // i campi scritti.
    set: { ok: true, letto: false, maxSessions: 12 },
  });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('6');

  await page.locator('#mgMaxSessions').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12');
  await page.locator('#mgMaxSessionsSave').click();

  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('Salvato');
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('non l\'ho potuto rileggere');
  // Il numero appena salvato resta al suo posto: tornare a 1 direbbe che la
  // scrittura non è avvenuta, e invece è avvenuta.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('12');
});

test('escluso il prioritario, la pagina dice quale account resta', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 1, priorityAccount: 'A', accountAOff: true, accountBOff: false },
    set: { ok: true },
  });
  await expect(page.locator('#mgPriorityWarn')).toBeVisible();
  await expect(page.locator('#mgPriorityWarn')).toHaveText("L'account A è escluso: le sessioni partono da B.");
  // L'avviso dell'altro caso non si accende per sbaglio.
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});

test('esclusi tutti e due: parla solo l\'avviso che non parte niente', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 1, priorityAccount: 'A', accountAOff: true, accountBOff: true },
    set: { ok: true },
  });
  await expect(page.locator('#mgAccountsWarn')).toBeVisible();
  // «Le sessioni partono da B» sarebbe falso: da B non parte più niente.
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
});

test('priorità che vale ancora: nessun avviso di troppo', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 3, priorityAccount: 'B', accountAOff: true, accountBOff: false },
    set: { ok: true },
  });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});

// ── Lo schermo e il server non si contraddicono (#675) ──────────────────────
// Server finto che scrive quando riceve e fotografa il documento in quel
// momento: è la sola RISPOSTA a viaggiare lenta, come su una rete vera.
async function apriServer(openTab, doc, ritardi = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(([init, rit]) => {
    window.__doc = Object.assign({}, init);
    window.__ritardi = { get: rit.get || [], set: rit.set || [] };
    window.__getGiu = !!rit.getGiu;
    window.__rilettura = true;
    window.__arrivate = 0;
    const RS = window.SN_ROUTINE_SESSIONI;
    const attesa = async (coda) => {
      await new Promise((r) => setTimeout(r, coda.shift() || 0));
      window.__arrivate += 1;
    };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        const r = window.__getGiu ? { ok: false, error: 'rete giù' } : Object.assign({ ok: true }, RS.leggiDoc(window.__doc));
        await attesa(window.__ritardi.get);
        return r;
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const esito = RS.valida(msg);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__doc, esito.valori);
        const r = window.__rilettura
          ? Object.assign({ ok: true }, RS.leggiDoc(window.__doc))
          : Object.assign({ ok: true, letto: false }, esito.valori);
        await attesa(window.__ritardi.set);
        return r;
      }
      return orig(msg);
    };
  }, [doc, ritardi]);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

// Le asserzioni si fanno a risposte TUTTE arrivate: è l'ultima, quella lenta, a fare il danno.
const arrivate = (page, n) => expect.poll(() => page.evaluate(() => window.__arrivate)).toBe(n);

const pillola = (page, valore) => page.locator('.mg-auto-choice-item')
  .filter({ has: page.locator(`input[name="mgPriorityAccount"][value="${valore}"]`) });

// La casella vera è nascosta sotto l'interruttore disegnato: si clicca quello, come l'owner.
const interruttore = (page, account) => page.locator('label.mg-switch')
  .filter({ has: page.locator(`#mgAccount${account}`) });

const SERVER = { maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false };

test('torna la rete e un salvataggio riempie il riquadro: nessuna riga dice più «non letto»', async ({ openTab }) => {
  const page = await apriServer(openTab, { maxSessions: 9, accountAOff: true }, { getGiu: true });
  await expect(page.locator('#mgAccountsMsg')).toContainText('Non ho potuto leggere');

  await page.evaluate(() => { window.__getGiu = false; });
  await pillola(page, 'A').click();

  await arrivate(page, 2);
  await expect(page.locator('#mgPriorityAccountMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('9');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('');
  await expect(page.locator('#mgAccountsMsg')).toHaveText('');
  // Il documento ora è noto per intero: l'avviso sul prioritario escluso torna a parlare.
  await expect(page.locator('#mgPriorityWarn')).toHaveText("L'account A è escluso: le sessioni partono da B.");
});

test('numero e poi interruttore, la prima risposta arriva per ultima: restano tutti e due', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { set: [700, 0] });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await interruttore(page, 'A').click();
  // Campi diversi non si aspettano: l'account è confermato mentre il numero è per strada.
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvo…');

  await arrivate(page, 3);
  expect(await page.evaluate(() => window.__doc)).toMatchObject({ maxSessions: 7, accountAOff: true });
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
});

test('interruttore e poi numero, al rovescio: non sparisce la scelta fatta per ultima', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { set: [700, 0] });

  await interruttore(page, 'B').click();
  await page.locator('#mgMaxSessions').fill('3');
  await page.locator('#mgMaxSessions').press('Enter');

  await arrivate(page, 3);
  expect(await page.evaluate(() => window.__doc)).toMatchObject({ maxSessions: 3, accountBOff: true });
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
  await expect(page.locator('#mgAccountB')).not.toBeChecked();
});

test('lo stesso numero salvato due volte di fila: vince l\'ultimo, sul server e sullo schermo', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { set: [700, 0] });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await page.locator('#mgMaxSessions').fill('8');
  await page.locator('#mgMaxSessionsSave').click();

  await arrivate(page, 3);
  expect(await page.evaluate(() => window.__doc.maxSessions)).toBe(8);
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('8');
});

test('una scelta fatta mentre la lettura è per strada non viene riscritta dalla lettura', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER);
  // La lettura fotografa il documento PRIMA della scelta e arriva dopo.
  await page.evaluate(() => {
    window.__ritardi.get.push(700);
    window.__mgTest.loadSessions();
  });
  await interruttore(page, 'A').click();

  await arrivate(page, 3);
  expect(await page.evaluate(() => window.__doc.accountAOff)).toBe(true);
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
});

test('un numero scritto e non salvato resta lì quando si salva un altro campo', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER);

  await page.locator('#mgMaxSessions').fill('11');
  await interruttore(page, 'B').click();

  await arrivate(page, 2);
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('11');
  expect(await page.evaluate(() => window.__doc.maxSessions)).toBe(4);
});

test('mai letto, scritto ma non riletto: la pillola appena scelta resta accesa', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { getGiu: true });
  await page.evaluate(() => { window.__rilettura = false; });

  await pillola(page, 'B').click();

  await arrivate(page, 2);
  await expect(page.locator('#mgPriorityAccountMsg')).toContainText('non l\'ho potuto rileggere');
  await expect(page.locator('input[name="mgPriorityAccount"][value="B"]')).toBeChecked();
  // Il resto non è stato letto: resta vuoto e lo dice.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('');
  await expect(page.locator('#mgAccountsMsg')).toContainText('Non ho potuto leggere');
});

test('una richiesta appesa sul numero non trattiene l\'esclusione di un account', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { set: [20000, 0] });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await interruttore(page, 'A').click();

  await expect.poll(() => page.evaluate(() => window.__doc.accountAOff), { timeout: 3000 }).toBe(true);
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.', { timeout: 3000 });
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  // Il numero è ancora per strada: lo schermo tiene la scelta, senza dirla salvata.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvo…');
});

test('un numero riscritto dopo Salva non si trova accanto «Salvato.»', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER, { set: [700] });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await page.locator('#mgMaxSessions').fill('9');

  await arrivate(page, 2);
  expect(await page.evaluate(() => window.__doc.maxSessions)).toBe(7);
  await expect(page.locator('#mgMaxSessions')).toHaveValue('9');
  await expect(page.locator('#mgMaxSessionsMsg')).not.toHaveText('Salvato.');

  // Salvato davvero il 9, la conferma torna.
  await page.locator('#mgMaxSessionsSave').click();
  await arrivate(page, 3);
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('9');
});

test('scritto e non riletto, poi un salvataggio pieno su un\'altra riga: sparisce anche «il resto non l\'ho potuto rileggere»', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER);
  await arrivate(page, 1);

  await page.evaluate(() => { window.__rilettura = false; });
  await interruttore(page, 'A').click();
  await arrivate(page, 2);
  await expect(page.locator('#mgAccountsMsg')).toContainText('non l\'ho potuto rileggere');

  await page.evaluate(() => { window.__rilettura = true; });
  await page.locator('#mgMaxSessions').fill('5');
  await page.locator('#mgMaxSessionsSave').click();
  await arrivate(page, 3);
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  // La scrittura dell'account è avvenuta e ora anche il resto è letto: resta la sola conferma.
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
});

test('scritto e non riletto, poi una lettura piena: l\'avviso sulla riga del numero se ne va', async ({ openTab }) => {
  const page = await apriServer(openTab, SERVER);
  await arrivate(page, 1);

  await page.evaluate(() => { window.__rilettura = false; });
  await page.locator('#mgMaxSessions').fill('6');
  await page.locator('#mgMaxSessionsSave').click();
  await arrivate(page, 2);
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('non l\'ho potuto rileggere');

  await page.evaluate(() => { window.__rilettura = true; });
  await page.evaluate(() => window.__mgTest.loadSessions());
  await arrivate(page, 3);
  await expect(page.locator('#mgMaxSessions')).toHaveValue('6');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
});

test('una risposta non riletta che arriva dopo un documento pieno più nuovo non dice che il resto manca', async ({ openTab }) => {
  // Il numero viaggia lento e senza rilettura; l'interruttore parte dopo e torna pieno prima.
  const page = await apriServer(openTab, SERVER, { set: [700, 0] });
  await arrivate(page, 1);

  await page.evaluate(() => { window.__rilettura = false; });
  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await page.evaluate(() => { window.__rilettura = true; });
  await interruttore(page, 'B').click();

  await arrivate(page, 3);
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
  await expect(page.locator('#mgAccountB')).not.toBeChecked();
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
});
