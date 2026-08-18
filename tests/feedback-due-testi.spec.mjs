// I DUE TESTI nella dashboard: la frase in chiaro per chi ha segnalato, e il
// report cifrato che si legge soltanto se si ha la chiave.
//
// PERCHÉ QUESTI CONTROLLI
//   Il report della lavorazione da ora viaggia cifrato, e chi ha mandato il
//   feedback non ha nessuna chiave: senza una frase scritta apposta per lui,
//   gli resta soltanto una riga generica. La frase quindi deve poterla scrivere
//   anche chi chiude un feedback dalla dashboard, non solo le routine — la
//   dashboard era l'unica strada da cui quella metà si perdeva per costruzione.
//
//   E dall'altra parte: una conversazione che NON si è potuta leggere non deve
//   poter essere riscritta. Il testo cifrato lo si mostrerebbe come un blob e il
//   primo salvataggio lo sostituirebbe con quel che è rimasto sullo schermo.
//
// Pre-condizione che senza il lavoro fallirebbe: la casella della frase non
// esisteva (primo controllo rosso), e sulle note illeggibili la casella di
// modifica compariva lo stesso (secondo controllo rosso).
//
// COME SI INIETTANO I DATI: con l'aggancio window.__fbTest (stesso pattern di
// manage). La pagina all'apertura carica DAVVERO da Firestore, e su una lista
// vera quel caricamento dura secondi: qualsiasi mock "sostituisci la lista e
// aspetta un tempo fisso" gareggia con lui e perde a caso. setData invalida il
// caricamento in volo, quindi i dati finti non possono essere sovrascritti.
// window.filo.message resta intercettato per catturare i salvataggi in uscita.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const DA_RISOLVERE = {
  _id: 'mock-due-testi',
  clientId: 'tester-abc',
  status: 'todo',
  text: 'Non riesco a rimuovere un modello dalle impostazioni',
  createdAt: '2026-08-18T00:00:00.000Z',
  notes: 'Report della lavorazione: ho scartato la strada A.',
};

async function setupAdmin(page, feedback) {
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate((fb) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData([fb]);
    // I feedback di prova sono "da risolvere": la scheda aperta all'avvio è un'altra.
    window.__fbTest.setTab('todo');
  }, feedback);
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
}

test('la frase per chi ha segnalato si scrive dalla dashboard e arriva a destinazione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, DA_RISOLVERE);

  const campo = page.locator('.fb-usernote[data-id="mock-due-testi"]');
  await expect(campo).toBeVisible();

  await campo.fill('Ora puoi rimuovere un modello dalle impostazioni.');
  await campo.blur();

  await expect.poll(() => page.evaluate(
    () => (window.__updates || []).filter((u) => typeof u.userNote === 'string').length,
  )).toBeGreaterThan(0);

  const upd = await page.evaluate(() => window.__updates.find((u) => typeof u.userNote === 'string'));
  expect(upd.userNote).toBe('Ora puoi rimuovere un modello dalle impostazioni.');
  // È l'ALTRA metà: non deve viaggiare al posto del report.
  expect(upd.notes).toBeUndefined();
});

test('il salvataggio automatico non tocca quello che si sta scrivendo', async ({ openTab }) => {
  // Il salvataggio parte da solo dopo una pausa. Se ripulisse il testo e
  // ridisegnasse la scheda, lo farebbe SOTTO LE DITA: lo spazio appena battuto
  // sparisce e la parola dopo si incolla alla precedente ("ciao " + pausa +
  // "mondo" = "ciaomondo"). E sporcherebbe proprio il testo che legge chi ha
  // mandato il feedback.
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, DA_RISOLVERE);

  const campo = page.locator('.fb-usernote[data-id="mock-due-testi"]');
  await campo.click();
  await campo.type('ciao ');
  // Più della pausa dopo cui il salvataggio parte da solo.
  await page.waitForTimeout(2200);
  await campo.type('mondo');

  await expect(campo).toHaveValue('ciao mondo');
});

test('chiudendo il feedback la frase viaggia con la chiusura', async ({ openTab }) => {
  // Il momento in cui quella riga serve è proprio quando si chiude: se il
  // pulsante non se la porta dietro, chi ha segnalato riceve la chiusura e
  // nient'altro.
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, DA_RISOLVERE);

  await page.locator('.fb-usernote[data-id="mock-due-testi"]').fill('Ora puoi rimuovere un modello.');
  await page.locator('.fb-act[data-id="mock-due-testi"][data-to="done"]').click();

  await expect.poll(() => page.evaluate(
    () => (window.__updates || []).filter((u) => u.status === 'done').length,
  )).toBeGreaterThan(0);
  const chiusura = await page.evaluate(() => window.__updates.find((u) => u.status === 'done'));
  expect(chiusura.userNote).toBe('Ora puoi rimuovere un modello.');
});

test('report illeggibile: non si può riscriverlo, e al suo posto si legge la frase', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(page, {
    ...DA_RISOLVERE,
    notes: 'FENC1:blob-che-questa-macchina-non-sa-leggere',
    userNote: 'Ora puoi rimuovere un modello dalle impostazioni.',
  });

  // Nessuna casella su cui scrivere: sovrascriverebbe un report mai letto.
  await expect(page.locator('.fb-notes[data-id="mock-due-testi"]')).toHaveCount(0);
  // E il blob non finisce sotto gli occhi di nessuno.
  const testo = await page.locator('.fb-card').innerText();
  expect(testo).not.toContain('FENC1:');
  expect(testo).toContain('Ora puoi rimuovere un modello dalle impostazioni.');
});
