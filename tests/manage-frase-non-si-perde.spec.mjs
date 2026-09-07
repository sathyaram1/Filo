// La frase per chi ha segnalato non si perde per strada (#497, secondo giro).
//
// PERCHÉ QUESTI CONTROLLI
//   Quella riga è l'unica cosa che il mittente legge quando la sua
//   segnalazione si chiude. Nella dashboard di gestione l'unico modo di
//   spedirla era il tasto "Salva la frase": ogni altro gesto naturale — premere
//   "Risolto", ricliccare la stessa segnalazione nella lista, cambiare sezione
//   — ridipingeva il pannello e riportava la casella al valore salvato,
//   buttando via quello che l'owner aveva appena scritto senza dire niente. La
//   pagina gemella, con la stessa casella, la salva da sola: due superfici che
//   sulla stessa cosa facevano il contrario.
//
// Senza il fix questi controlli sono rossi: alla prima porta parte solo il
// cambio di stato (nessun userNote), alle altre la casella torna indietro.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  text: 'Non riesco a rimuovere un modello dalle impostazioni',
  name: 'Rimuovere un modello',
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z',
  images: [],
  notes: 'Report della lavorazione.',
};
const IN_CODA   = { ...BASE, _id: 'fb-coda', seq: 910, status: 'todo', statusPublic: 'open', reviewDecision: 'accepted' };
const IN_CODA_2 = { ...BASE, _id: 'fb-coda-2', seq: 911, status: 'todo', statusPublic: 'open', reviewDecision: 'accepted' };

async function prepara(page, lista, tab, apri) {
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
  await page.evaluate(({ l, t, a }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(l);
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(a);
  }, { l: lista, t: tab, a: apri });
  await expect(page.locator('#mgDetail')).toBeVisible();
}

async function scriviFrase(page, testo) {
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toBeVisible();
  await page.locator('#mgUserNoteText').fill(testo);
}

const FRASE = 'Ora puoi rimuovere un modello dalle impostazioni.';

test('chiudo la segnalazione col tasto: la frase appena scritta parte con lei', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await scriviFrase(page, FRASE);

  await page.locator('#mgResolveBtn').click();

  // Il mittente riceve la sua riga E la segnalazione risulta chiusa.
  await expect.poll(() => page.evaluate((f) => window.__updates.some((u) => u.userNote === f), FRASE))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.__updates.some((u) => u.status === 'done'))).toBe(true);
});

test('la frase parte anche archiviando, e prima del cambio di stato', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await scriviFrase(page, FRASE);

  await page.locator('#mgArchiveBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(2);
  const ordine = await page.evaluate(() => window.__updates.map((u) => (u.userNote !== undefined ? 'frase' : 'stato')));
  expect(ordine[0]).toBe('frase');
  expect(ordine).toContain('stato');
});

test('riclicco la stessa segnalazione nella lista: quello che ho scritto è già al sicuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await scriviFrase(page, FRASE);

  await page.locator('#mgList .mg-item').first().click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe(FRASE);
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toHaveValue(FRASE);
});

test('cambio sezione con la frase scritta: parte prima di lasciare la segnalazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await scriviFrase(page, FRASE);

  await page.evaluate(() => window.__mgTest.setTab('inbox'));

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.userNote).toBe(FRASE);
  expect(patch.id).toBe('fb-coda');
});

test('passo a un altra segnalazione: la frase resta su quella giusta', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA, IN_CODA_2], 'queue', 'fb-coda');
  await scriviFrase(page, FRASE);

  await page.evaluate(() => window.__mgTest.openDetail('fb-coda-2'));

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-coda');
  expect(patch.userNote).toBe(FRASE);
  // Sull'altra la casella è vuota: niente travaso.
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toHaveValue('');
});

test('se la frase non si salva, lo stato non cambia e l errore si vede', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        return { ok: false, error: 'rete giù' };
      }
      return { ok: true };
    };
  });
  await scriviFrase(page, FRASE);

  await page.locator('#mgResolveBtn').click();

  // Nessuno stato scritto: solo il tentativo sulla frase.
  await expect(page.locator('#mgActionMsg')).toHaveClass(/mg-err/);
  const stati = await page.evaluate(() => window.__updates.filter((u) => u.status).length);
  expect(stati).toBe(0);
  // E la sezione si riapre con dentro quello che l'owner aveva scritto.
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await expect(page.locator('#mgUserNoteText')).toHaveValue(FRASE);
});

test('la sezione aperta non si richiude da sola quando arriva un aggiornamento', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  // Cursore fuori dalla casella: il ridisegno non è trattenuto da niente.
  await page.locator('#mgThread').click({ position: { x: 5, y: 5 } });

  await page.evaluate(() => window.__mgTest.rerenderIfIdle('fb-coda'));

  await expect(page.locator('#mgUserNote')).toBeVisible();
  await expect(page.locator('#mgUserNoteToggle')).toHaveAttribute('aria-expanded', 'true');
});

test('la frase già scritta si legge nella conversazione, senza aprire niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [{ ...IN_CODA, userNote: 'Ora funziona, aggiorna Filo.' }], 'queue', 'fb-coda');
  await expect(page.locator('#mgUserNote')).toBeHidden();
  const bolla = page.locator('#mgThread .mg-bubble', { hasText: 'Ora funziona, aggiorna Filo.' });
  await expect(bolla).toHaveCount(1);
  await expect(bolla).toContainText('per chi ha segnalato');
});

test('un messaggio d esito lungo non manda i tasti a capo', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [IN_CODA], 'queue', 'fb-coda');
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        return { ok: false, error: 'Il server di sicurezza ha rifiutato la scrittura: la chiave della routine non è più valida, rigenerala e riprova (codice 401).' };
      }
      return { ok: true };
    };
  });
  const righe = async () => page.evaluate(() => {
    const bs = [...document.querySelectorAll('#mgOwnerBar .mg-owner-row button')].filter((b) => b.offsetParent !== null);
    return [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top / 8)))].length;
  });
  const prima = await righe();
  await page.locator('#mgArchiveBtn').click();
  await expect(page.locator('#mgActionMsg')).toHaveClass(/mg-err/);
  expect(await righe()).toBe(prima);
});
