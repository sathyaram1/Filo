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
// Come le altre spec della dashboard feedback: lista mockata e `window.filo.message`
// intercettato, così restiamo offline e deterministici.

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

async function setupAdmin(app, page, feedback) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });
  await page.evaluate((fb) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      // La decifratura in-app: qui non c'è chiave, quindi si limita a
      // restituire la lista com'è (è il caso vero di una macchina senza chiave).
      if (msg && msg.type === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
  }, feedback);

  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 10_000 });

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed', signedIn: true, isAdmin: true, profile: { email: 'owner@example.com' },
        });
      }
    }
  });

  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelectorAll('.fb-card').length > 0, null, { timeout: 10_000 });
}

test('la frase per chi ha segnalato si scrive dalla dashboard e arriva a destinazione', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.locator('.fb-tab[data-tab="todo"]').click().catch(() => {});
  await setupAdmin(app, page, DA_RISOLVERE);
  await page.locator('.fb-tab[data-tab="todo"]').click();

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

test('report illeggibile: non si può riscriverlo, e al suo posto si legge la frase', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, {
    ...DA_RISOLVERE,
    notes: 'FENC1:blob-che-questa-macchina-non-sa-leggere',
    userNote: 'Ora puoi rimuovere un modello dalle impostazioni.',
  });
  await page.locator('.fb-tab[data-tab="todo"]').click();

  // Nessuna casella su cui scrivere: sovrascriverebbe un report mai letto.
  await expect(page.locator('.fb-notes[data-id="mock-due-testi"]')).toHaveCount(0);
  // E il blob non finisce sotto gli occhi di nessuno.
  const testo = await page.locator('.fb-card').innerText();
  expect(testo).not.toContain('FENC1:');
  expect(testo).toContain('Ora puoi rimuovere un modello dalle impostazioni.');
});
