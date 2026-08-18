// SPEC DI VERIFICA INDIPENDENTE (temporaneo, non va committato).
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  { _id: 'fb-a', name: 'Titolo A', text: 'Testo del feedback A', seq: 401, subSeq: 0,
    status: 'new', clientId: 'tizio@example.com', createdAt: '2026-06-01T10:00:00Z', images: [],
    userNote: 'FRASE-ESISTENTE-A' },
  { _id: 'fb-b', name: 'Titolo B', text: 'Testo del feedback B', seq: 402, subSeq: 0,
    status: 'new', clientId: 'caio@example.com', createdAt: '2026-06-02T10:00:00Z', images: [] },
  { _id: 'fb-done', name: 'Gia risolto', text: 'Chiuso da tempo', seq: 403, subSeq: 0,
    status: 'done', clientId: 'tizio@example.com', createdAt: '2026-05-01T10:00:00Z', images: [],
    notes: 'FENC1:blobIllegibileSenzaChiavePrivata==', userNote: 'vecchia frase da correggere' },
];

// Stub del canale verso il main: cattura i payload e finge successo.
async function stubChannel(page) {
  await page.evaluate(() => {
    window.__sent = [];
    const real = window.filo && window.filo.message;
    window.__real = real;
    window.filo.message = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true };
      return { ok: true };
    };
  });
}

async function boot(openTab, { admin = true, tab = 'inbox' } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await stubChannel(page);
  await page.evaluate(([a, t, fbs]) => {
    window.__mgTest.setAdmin(a);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab(t);
  }, [admin, tab, FBS]);
  return page;
}

const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.type === 'feedback_update'));

test('1. la casella c-e, e etichettata per il MITTENTE, e si raggiunge cliccando il feedback', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('.mg-item[data-id="fb-a"]');
  const box = page.locator('#mgUserNote');
  await expect(box).toBeVisible();
  const label = (await page.locator('#mgUserNote label').innerText()).toLowerCase();
  expect(label).toContain('segnalato');
  // Deve essere chiaro che lo legge LUI, non l'owner.
  expect(/legge|mittente|chi ha segnalato/.test(label)).toBe(true);
  // Precompilata con la frase gia' presente.
  await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-ESISTENTE-A');
  await page.locator('#mgDetail').screenshot({ path: 'tests/.shots/zz-frase-pannello.png' });
});

test('2. la frase parte DA SOLA (niente conversazione, niente stato)', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('.mg-item[data-id="fb-a"]');
  await page.fill('#mgUserNoteText', 'Ora puoi rimuovere le immagini allegate.');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);
  const msgs = await sent(page);
  expect(msgs).toHaveLength(1);
  expect(msgs[0].id).toBe('fb-a');
  expect(msgs[0].userNote).toBe('Ora puoi rimuovere le immagini allegate.');
  expect(Object.keys(msgs[0]).sort()).toEqual(['id', 'type', 'userNote']);
});

test('3. feedback GIA CHIUSO (Risolti) + conversazione illeggibile: scrivibile lo stesso', async ({ openTab }) => {
  const page = await boot(openTab, { tab: 'resolved' });
  await expect(page.locator('.mg-item[data-id="fb-done"]')).toBeVisible();
  await page.click('.mg-item[data-id="fb-done"]');
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await expect(page.locator('#mgUserNoteText')).toHaveValue('vecchia frase da correggere');
  await page.fill('#mgUserNoteText', 'frase corretta dopo la chiusura');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);
  const msgs = await sent(page);
  expect(msgs[0]).toMatchObject({ id: 'fb-done', userNote: 'frase corretta dopo la chiusura' });
});

test('4. due feedback di fila: nessun travaso di testo, e salva sull-id giusto', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('.mg-item[data-id="fb-a"]');
  await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-ESISTENTE-A');
  await page.click('.mg-item[data-id="fb-b"]');
  await expect(page.locator('#mgUserNoteText')).toHaveValue('');   // B non eredita la frase di A
  await page.fill('#mgUserNoteText', 'frase-di-B');
  await page.click('.mg-item[data-id="fb-a"]');
  await expect(page.locator('#mgUserNoteText')).toHaveValue('FRASE-ESISTENTE-A'); // torna quella di A
  await page.click('.mg-item[data-id="fb-b"]');
  await expect(page.locator('#mgUserNoteText')).toHaveValue('');   // la bozza non salvata non resta appiccicata
  await page.fill('#mgUserNoteText', 'davvero-di-B');
  await page.click('#mgUserNoteBtn');
  const msgs = await sent(page);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ id: 'fb-b', userNote: 'davvero-di-B' });
});

test('5. casi storti: vuota (cancella), spazi, 600 caratteri, speciali, ripetuto, Invio', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('.mg-item[data-id="fb-a"]');

  // cancellazione
  await page.fill('#mgUserNoteText', '');
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/rimoss/i);
  let msgs = await sent(page);
  expect(msgs[msgs.length - 1]).toMatchObject({ id: 'fb-a', userNote: '' });

  // salvataggio ripetuto identico: non deve ri-sparare
  const before = (await sent(page)).length;
  await page.click('#mgUserNoteBtn');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/nessuna modifica/i);
  expect((await sent(page)).length).toBe(before);

  // solo spazi -> resta vuota, e non genera una scrittura sbagliata
  await page.fill('#mgUserNoteText', '     ');
  await page.click('#mgUserNoteBtn');
  msgs = await sent(page);
  if (msgs.length > before) expect(msgs[msgs.length - 1].userNote).toBe('');

  // caratteri speciali, con Invio invece del bottone
  const strano = 'Pero "si" - e fatto <b>&amp;</b> \'ok\' ✅';
  await page.fill('#mgUserNoteText', strano);
  await page.press('#mgUserNoteText', 'Enter');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText(/salvata/i);
  msgs = await sent(page);
  expect(msgs[msgs.length - 1].userNote).toBe(strano);

  // 600 caratteri -> non deve partire piu' del tetto
  await page.evaluate(() => {
    const el = document.getElementById('mgUserNoteText');
    el.value = 'z'.repeat(600);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#mgUserNoteBtn');
  msgs = await sent(page);
  expect(msgs[msgs.length - 1].userNote.length).toBeLessThanOrEqual(500);
});

test('6. non-admin: la casella non c-e, e il canale rifiuta comunque la scrittura', async ({ openTab }) => {
  const page = await boot(openTab, { admin: false });
  await page.click('.mg-item[data-id="fb-a"]');
  await expect(page.locator('#mgUserNote')).toBeHidden();
  // Gate vero del main (canale reale, non lo stub): niente sessione admin nei test.
  const r = await page.evaluate(async () => {
    const real = window.__real.bind(window.filo);
    return real({ type: 'feedback_update', id: 'DOC-INESISTENTE-VERIFICA', userNote: 'non deve passare' });
  });
  expect(r.ok).toBe(false);
  expect(String(r.error)).toMatch(/amministrat|accedi|sessione/i);
});

test('7. il resto della pagina regge: preferito, archivia, sblocco, chiarimenti, schede, ricerca', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('.mg-item[data-id="fb-a"]');

  // preferito
  await page.click('#mgStarBtn');
  await expect.poll(async () => (await sent(page)).some((m) => 'starred' in m)).toBe(true);
  // archivia
  await page.click('#mgArchiveBtn');
  await expect.poll(async () => (await sent(page)).some((m) => 'archiveOverride' in m || m.status === 'archived')).toBe(true);

  // cambio scheda + ricerca
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.click('#mgSearchToggle');
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mgSearchBar')).toBeHidden();

  // feedback bloccato: il box di sblocco compare ancora
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'fb-block', name: 'Bloccato', text: 'x', seq: 404, subSeq: 0,
      status: 'attack', clientId: 'z@example.com', createdAt: '2026-06-05T10:00:00Z', images: [] }]);
  });
  await page.click('.mg-item[data-id="fb-block"]');
  await expect(page.locator('#mgActions')).toBeVisible();
  await expect(page.locator('#mgUserNote')).toBeVisible();

  // chiarimenti
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'fb-clar', name: 'Domande', text: 'x', seq: 405, subSeq: 0,
      status: 'clarify', clientId: 'z@example.com', createdAt: '2026-06-06T10:00:00Z', images: [] }]);
  });
  await page.click('.mg-item[data-id="fb-clar"]');
  await expect(page.locator('#mgClarify')).toBeVisible();
});
