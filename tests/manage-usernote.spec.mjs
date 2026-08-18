// La frase per chi ha segnalato, nella dashboard di gestione.
//
// PERCHÉ QUESTI CONTROLLI
//   Quando un feedback si chiude, chi l'aveva mandato legge UNA riga: quella.
//   Tutto il resto della conversazione è cifrato e la chiave ce l'ha solo
//   l'owner. Se la riga non si può scrivere da qui — che è la schermata da cui
//   l'owner lavora davvero — non viene scritta quasi mai, e al mittente resta
//   una frase generica.
//
//   Deve funzionare anche sui feedback GIÀ CHIUSI (per correggerla dopo) e
//   anche quando il report non è leggibile su quel computer: la frase è in
//   chiaro e non ha bisogno di nessuna chiave.
//
// Pre-condizione che senza il lavoro fallirebbe: la casella non esisteva in
// questa pagina, quindi il primo controllo è rosso.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const RISOLTO = {
  _id: 'test-frase-001',
  text: 'Non riesco a rimuovere un modello dalle impostazioni',
  name: 'Rimuovere un modello',
  seq: 900,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z',
  images: [],
  status: 'done',
  statusPublic: 'closed',
  notes: 'Report della lavorazione: ho scartato la strada A.',
};

async function apri(page, fb, tab = 'inbox') {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await page.evaluate(({ f, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(f._id);
  }, { f: fb, t: tab });
}

test('la frase si scrive dalla dashboard di gestione e parte da sola, senza toccare la conversazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, RISOLTO, 'resolved');

  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toBeVisible();

  await campo.fill('Ora puoi rimuovere un modello dalle impostazioni.');
  await page.locator('#mgUserNoteBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.userNote).toBe('Ora puoi rimuovere un modello dalle impostazioni.');
  // È l'ALTRA metà dei due testi: non deve viaggiare al posto del report.
  expect(patch.notes).toBeUndefined();
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
});

test('riaprendo il feedback la frase è ancora lì, e si può correggere', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { ...RISOLTO, userNote: 'Prima versione della frase.' }, 'resolved');

  await expect(page.locator('#mgUserNoteText')).toHaveValue('Prima versione della frase.');

  await page.locator('#mgUserNoteText').fill('Versione corretta.');
  await page.locator('#mgUserNoteBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Versione corretta.');
});

test('report cifrato: la frase resta scrivibile (non serve nessuna chiave)', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    ...RISOLTO,
    notes: 'FENC1:blob-che-questa-macchina-non-sa-leggere',
    userNote: 'Ora puoi rimuovere un modello.',
  }, 'resolved');

  await expect(page.locator('#mgUserNoteText')).toHaveValue('Ora puoi rimuovere un modello.');
  await page.locator('#mgUserNoteText').fill('Frase aggiornata a mano.');
  await page.locator('#mgUserNoteBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Frase aggiornata a mano.');
  // E il testo cifrato non finisce sotto gli occhi di nessuno.
  const visibile = await page.locator('#mgDetail').innerText();
  expect(visibile).not.toContain('FENC1:');
});

test('cambiando feedback durante il salvataggio, la frase non travasa sull\'altro', async ({ openTab }) => {
  // Il salvataggio ci mette un momento. Se in quel momento l'owner apre un
  // altro feedback, quando la risposta arriva NON deve riscrivere il pannello:
  // ci metterebbe dentro la frase e la conversazione del feedback precedente
  // lasciando selezionato il secondo — e il salvataggio dopo manderebbe il
  // messaggio di uno al mittente dell'altro. Bastano quattro decimi di rete.
  const A = { ...RISOLTO, _id: 'fb-a', seq: 910, name: 'Feedback A', text: 'testo del feedback A' };
  const B = { ...RISOLTO, _id: 'fb-b', seq: 911, name: 'Feedback B', text: 'testo del feedback B' };

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Canale lento: la risposta arriva dopo che abbiamo cambiato feedback.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true };
      }
      return orig(msg);
    };
  });

  await page.evaluate(({ a, b }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([a, b]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail('fb-a');
  }, { a: A, b: B });

  await page.locator('#mgUserNoteText').fill('Frase destinata ad A.');
  await page.locator('#mgUserNoteBtn').click();
  // Senza aspettare la risposta: apri l'altro feedback.
  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  await page.waitForTimeout(900);

  // Il pannello deve parlare di B, non di A.
  await expect(page.locator('#mgUserNoteText')).not.toHaveValue('Frase destinata ad A.');
  const visibile = await page.locator('#mgDetail').innerText();
  expect(visibile).toContain('testo del feedback B');
  expect(visibile).not.toContain('testo del feedback A');

  // E il salvataggio successivo non deve spedire la frase di A sul documento di B.
  await page.locator('#mgUserNoteText').fill('Frase destinata a B.');
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(2);
  const secondo = await page.evaluate(() => window.__updates[1]);
  expect(secondo.id).toBe('fb-b');
  expect(secondo.userNote).toBe('Frase destinata a B.');
});

test('correggere la frase mentre il salvataggio è in volo non cancella la correzione', async ({ openTab }) => {
  // Scrivi, salva, ti accorgi del refuso, correggi: con la rete lenta la
  // risposta arriva DOPO la correzione. Se rimettesse dentro il valore salvato,
  // quello che l'owner ha appena scritto sparirebbe sotto le dita.
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        await new Promise((r) => setTimeout(r, 600));
        return { ok: true };
      }
      return orig(msg);
    };
  });
  await page.evaluate((f) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail(f._id);
  }, RISOLTO);

  await page.locator('#mgUserNoteText').fill('Ora puoi rimuovere un modelo.');
  await page.locator('#mgUserNoteBtn').click();
  await page.locator('#mgUserNoteText').fill('Ora puoi rimuovere un modello.');
  await page.waitForTimeout(1000);

  await expect(page.locator('#mgUserNoteText')).toHaveValue('Ora puoi rimuovere un modello.');
});

test('uscire e rientrare durante il salvataggio non fa tornare indietro la frase', async ({ openTab }) => {
  // Il caso che rompeva la protezione: rientrando nel feedback il pannello
  // ridipinge la casella col valore VECCHIO. Se la risposta che arriva dopo non
  // la riallinea, resta indietro — e il salvataggio successivo rispedisce il
  // testo vecchio, disfacendo in silenzio quello appena salvato.
  const A = { ...RISOLTO, _id: 'fb-a', seq: 920, name: 'Feedback A', userNote: 'frase vecchia' };
  const B = { ...RISOLTO, _id: 'fb-b', seq: 921, name: 'Feedback B' };

  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        await new Promise((r) => setTimeout(r, 600));
        return { ok: true };
      }
      return orig(msg);
    };
  });
  await page.evaluate(({ a, b }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([a, b]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail('fb-a');
  }, { a: A, b: B });

  await page.locator('#mgUserNoteText').fill('frase nuova');
  await page.locator('#mgUserNoteBtn').click();
  // Esci e rientra mentre la risposta è ancora in volo.
  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  await page.evaluate(() => window.__mgTest.openDetail('fb-a'));
  await page.waitForTimeout(1000);

  await expect(page.locator('#mgUserNoteText')).toHaveValue('frase nuova');

  // E un salvataggio successivo non deve rispedire quella vecchia.
  await page.locator('#mgUserNoteText').fill('frase nuova corretta');
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(2);
  const inviate = await page.evaluate(() => window.__updates.map((u) => u.userNote));
  expect(inviate).toEqual(['frase nuova', 'frase nuova corretta']);
});

test('due salvataggi in volo: comanda l\'ultimo spedito, non l\'ultimo che risponde', async ({ openTab }) => {
  // Le risposte possono tornare in ordine diverso da come sono partite. Se a
  // comandare è quella che arriva per ultima, il pannello si riempie di parole
  // già sostituite: rientrando nel feedback l'owner rilegge il testo vecchio, e
  // la pagina gli risponde "Nessuna modifica" su una frase che a destinazione
  // non è mai arrivata. Vede una cosa, il mittente ne legge un'altra.
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Canale che risponde AL CONTRARIO: il primo invio è il più lento.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        const ritardo = window.__updates.length === 1 ? 1200 : 100;
        await new Promise((r) => setTimeout(r, ritardo));
        return { ok: true };
      }
      return orig(msg);
    };
  });
  await page.evaluate((f) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ ...f, _id: 'fb-conc', userNote: 'vecchia' }]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail('fb-conc');
  }, RISOLTO);

  await page.locator('#mgUserNoteText').fill('nuova');
  await page.locator('#mgUserNoteBtn').click();
  await page.locator('#mgUserNoteText').fill('corretta');
  await page.locator('#mgUserNoteText').press('Enter');
  await page.waitForTimeout(1800);

  // Riaprendo il feedback deve esserci l'ultima spedita, non l'ultima arrivata.
  await page.evaluate(() => window.__mgTest.openDetail('fb-conc'));
  await expect(page.locator('#mgUserNoteText')).toHaveValue('corretta');

  const inviate = await page.evaluate(() => window.__updates.map((u) => u.userNote));
  expect(inviate).toEqual(['nuova', 'corretta']);
});

test('senza admin la casella non compare', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate((f) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('resolved');
    window.__mgTest.openDetail(f._id);
  }, RISOLTO);

  await expect(page.locator('#mgUserNote')).toBeHidden();
});
