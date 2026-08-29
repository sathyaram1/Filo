// La casella note di un feedback non deve "deselezionarsi" mentre l'utente
// scrive.
//
// BUG (feedback alpha): scrivendo nelle note di un feedback esistente dalla
// dashboard, dopo ~1.5s di pausa il salvataggio in debounce rigenerava tutta
// la lista (patch → applyFilter → render riscrive innerHTML), distruggendo la
// textarea a fuoco: l'utente perdeva il cursore e doveva ri-cliccare.
//
// Pre-condizione che senza il fix fallirebbe: dopo il flush in debounce il
// document.activeElement non è più la textarea (è il body). Col fix il fuoco
// e il cursore vengono ripristinati sulla nuova textarea.
//
// La pagina feedback è in sola lettura senza un admin loggato, e i feedback
// arrivano da Firestore (rete). Per un test deterministico e offline:
//   - simuliamo il login admin inviando il broadcast 'auth_changed' dal main
//     (la pagina lo ascolta via window.filo.onBroadcast → isAdmin = true);
//   - sostituiamo SN_FEEDBACK.list con un mock (un feedback in "todo");
//   - intercettiamo window.filo.message così feedback_update torna ok senza
//     toccare il main (che rifiuterebbe: non c'è un vero admin).

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('feedback: la casella note resta a fuoco dopo il salvataggio in debounce', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  // 1) Mock dei feedback + intercetta feedback_update (così patch va a buon
  //    fine senza alert/rollback, che a sua volta re-renderizza).
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = async () => ([{
      _id: 'mock-focus-1',
      status: 'todo',
      text: 'Feedback di prova per il test del fuoco note.',
      url: 'filo://newtab/',
      notes: '',
      createdAt: new Date().toISOString(),
    }]);
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      // L'admin è simulato via broadcast auth_changed, ma la pagina ricontrolla
      // lo stato con auth_status (init + #refresh). Senza token reale tornerebbe
      // isAdmin:false, che durante l'attesa ribalterebbe isAdmin e ri-renderizza
      // la lista in sola lettura (la textarea note sparisce) — falsando il test
      // del fuoco. Manteniamo isAdmin:true così verifichiamo davvero il
      // ripristino del fuoco dopo il salvataggio in debounce.
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      return orig(msg);
    };
  });

  // 1b) Attendi che il refreshAuth()+load D'AVVIO si concluda PRIMA di simulare
  //     l'admin. All'apertura la pagina chiama auth_status (REALE: la richiesta
  //     parte al load, prima che il mock qui sopra sia installato) e poi load().
  //     Se quella catena si risolve più tardi — mentre l'utente sta scrivendo —
  //     ribalta isAdmin a false e ricarica la lista (la textarea note sparisce):
  //     era questa la causa del flake. Aspettiamo che il "Caricamento…" iniziale
  //     sparisca, segnale che init è finito; da qui in poi comanda il #refresh.
  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 10_000 });

  // 2) Simula il login admin: il main fa il broadcast, la pagina alza isAdmin.
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed',
          signedIn: true,
          isAdmin: true,
          profile: { email: 'sathyarampontillo@gmail.com' },
        });
      }
    }
  });

  // 3) Ricarica con il mock e vai sul tab "Da risolvere" (todo): lì le note
  //    sono editabili per gli admin.
  await page.locator('#refresh').click();
  await page.locator('[data-tab="queue"]').click();

  const notes = page.locator('.fb-notes');
  await expect(notes).toHaveCount(1);

  // 4) Scrivi e attendi il flush in debounce (1500ms).
  await notes.click();
  await page.keyboard.type('una nota lunga abbastanza da avere un cursore');
  await page.waitForTimeout(1800);

  // 5) Senza il fix qui activeElement sarebbe il body (re-render ha distrutto
  //    la textarea). Col fix il fuoco è ancora sulla textarea note.
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      isNotes: !!el && el.classList && el.classList.contains('fb-notes'),
      value: el && 'value' in el ? el.value : null,
      caret: el && typeof el.selectionStart === 'number' ? el.selectionStart : null,
    };
  });

  expect(focused.isNotes).toBe(true);
  expect(focused.value).toBe('una nota lunga abbastanza da avere un cursore');
  // Il cursore è in fondo al testo appena digitato (nessun salto a inizio).
  expect(focused.caret).toBe('una nota lunga abbastanza da avere un cursore'.length);

  // 6) Continuare a scrivere appende dal cursore (la casella è davvero usabile).
  await page.keyboard.type('!');
  await expect(notes).toHaveValue('una nota lunga abbastanza da avere un cursore!');
});

// Il banner "Sei in sola lettura" NON deve comparire per un admin loggato.
//
// BUG (feedback alpha): `.fb-admin-banner { display: flex }` vinceva sulla
// regola UA `[hidden]{display:none}`, quindi `adminBanner.hidden = true` (cosa
// che il codice fa quando isAdmin) non nascondeva nulla: l'admin vedeva il
// banner pur potendo gestire i feedback. Pre-condizione che senza il fix CSS
// (.fb-admin-banner[hidden]{display:none}) fallirebbe: il banner resta visibile
// anche dopo il login admin.
test('feedback: da admin il banner sola lettura sparisce', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  // Da sloggati il banner è giustamente visibile.
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  // Simula il login admin via broadcast: la pagina alza isAdmin e nasconde il
  // banner (adminBanner.hidden = true).
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed',
          signedIn: true,
          isAdmin: true,
          profile: { email: 'sathyarampontillo@gmail.com' },
        });
      }
    }
  });

  await expect(page.locator('#adminBanner')).toBeHidden();
});
