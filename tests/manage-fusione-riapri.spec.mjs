// Gestione: una pratica ferma al cancello di fusione (design/l5) senza una richiesta viva non resta ferma per
// sempre: il quadrato offre di riaprirla, la richiesta riaperta compare lì da approvare, e se il ramo non si
// fonde più la scheda lo dice e la strada diventa «Rimanda in lavorazione» (#1040). Le strade: manage-fusione-senza-richiesta.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

const FB_FERMO = {
  _id: 'fb-1040-fermo',
  text: 'Il menu non si apre.', name: 'Menu che non si apre',
  seq: 952, subSeq: 1, status: 'design', statusReason: 'l5', statusPublic: 'open',
  branch: 'worker/fb-1040-fermo-20261004T120000Z',
  clientId: 'tester@example.com', createdAt: '2026-10-04T10:00:00Z', images: [],
};

function richiestaRiaperta() {
  return {
    id: 'c0ffeec0ffeec0ffeec0ffee', branch: FB_FERMO.branch, sha: 'b'.repeat(40), feedbackId: FB_FERMO._id, num: '952.1',
    who: 'owner · riaperta', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['scripts/routine-channel.mjs'], more: 0 }],
    createdAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 7 * GIORNO,
    expired: false, used: false, discarded: false,
  };
}

// Il canale verso il main: elenchi decisi dal test, risposte del server alla riapertura e chiamate registrate.
async function apri(openTab, { riapri = null, elenchiOk = true, salta = null, fb = FB_FERMO, livello = 'l5' } = {}) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__chiamate = [];
    window.__pending = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.elenchiOk) return { ok: false, error: 'non raggiungibile' };
        return { ok: true, pending: window.__pending, failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      }
      if (t === 'merge_approval_riapri') {
        window.__chiamate.push(msg);
        const r = cfg.riapri || { ok: true, esito: 'aperta', requestId: cfg.richiesta.id };
        if (r.esito === 'aperta') window.__pending = [cfg.richiesta];
        return r;
      }
      if (t === 'feedback_update') { window.__chiamate.push(msg); return { ok: true }; }
      if (t === 'livello4_salta') { window.__chiamate.push(msg); return cfg.salta; }
      return orig(msg);
    };
  }, { riapri, elenchiOk, salta, richiesta: richiestaRiaperta() });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [fb]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator(`#mgLivelliRow .mg-forma[data-livello="${livello}"]`).click();
  return page;
}

test('ferma al cancello senza richiesta: il quadrato la riapre, e la richiesta compare lì da approvare', async ({ openTab }) => {
  const page = await apri(openTab);
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).toContainText('Nessuna richiesta di fusione è aperta');
  const riapri = corpo.locator('#mgRiapriFusioneBtn');
  await expect(riapri).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/manage-fusione-senza-richiesta.png' });

  await riapri.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate)).toEqual([{ type: 'merge_approval_riapri', feedbackId: FB_FERMO._id }]);
  // La richiesta riaperta è nel pannello col suo tasto per approvarla, e la frase vecchia è sparita.
  await expect(corpo.locator('.sn-mac-btn-go')).toBeVisible();
  await expect(corpo.locator('#mgRiapriFusioneBtn')).toHaveCount(0);
  await expect(corpo).toContainText('entra in main solo col tuo via libera');
  await expect(corpo).not.toContainText('Nessuna richiesta di fusione è aperta');
  await page.screenshot({ path: 'tests/.shots/manage-fusione-riaperta.png' });
});

test('il ramo non si fonde più con main: la scheda lo dice e la strada è rimandarla in lavorazione', async ({ openTab }) => {
  const page = await apri(openTab, { riapri: { ok: true, esito: 'conflitto' } });
  const corpo = page.locator('#mgSideBody');
  await corpo.locator('#mgRiapriFusioneBtn').click();
  await expect(corpo.locator('#mgRiapriFusioneBtn ~ .mg-liv-esito')).toContainText('non si fonde più con main');
  const inCoda = corpo.locator('#mgL5RimandaBtn');
  await expect(inCoda).toBeVisible();
  // Rifare la stessa domanda non serve più: il tasto principale diventa la coda.
  await expect(inCoda).not.toHaveClass(/sn-btn-secondary/);
  await expect(corpo.locator('#mgRiapriFusioneBtn')).toHaveClass(/sn-btn-secondary/);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'tests/.shots/manage-fusione-conflitto.png' });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.screenshot({ path: 'tests/.shots/manage-fusione-conflitto-scuro.png' });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('light'));
  // La rilettura delle fusioni ridisegna il pannello: la frase e il tasto restano.
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(corpo.locator('#mgRiapriFusioneBtn ~ .mg-liv-esito')).toContainText('non si fonde più con main');

  await inCoda.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'feedback_update').map((c) => [c.id, c.status])))
    .toEqual([[FB_FERMO._id, 'todo']]);
});

// Il sì vale solo per la versione che i controlli hanno letto: commit arrivati dopo rifanno il giro, non entrano in main.
for (const [esito, frase] of [['mosso', 'commit nuovi, arrivati dopo i controlli'], ['senza_controllo', 'Non trovo la versione che i controlli hanno letto']]) {
  test(`ramo da rileggere (${esito}): nessuna richiesta da approvare, la scheda lo dice e la rimette in coda`, async ({ openTab }) => {
    const page = await apri(openTab, { riapri: { ok: true, esito } });
    const corpo = page.locator('#mgSideBody');
    await corpo.locator('#mgRiapriFusioneBtn').click();
    await expect(corpo.locator('#mgRiapriFusioneBtn ~ .mg-liv-esito')).toContainText(frase);
    await expect(corpo.locator('#mgRiapriFusioneBtn ~ .mg-liv-esito')).toHaveAttribute('data-kind', 'err');
    await page.evaluate(() => window.__mgTest.loadMergeApprovals());
    await expect(corpo.locator('.sn-mac-btn-go')).toHaveCount(0);
    const inCoda = corpo.locator('#mgL5RimandaBtn');
    await expect(inCoda).toBeVisible();
    await inCoda.click();
    await expect.poll(() => page.evaluate(() => window.__chiamate.filter((c) => c.type === 'feedback_update').map((c) => [c.id, c.status])))
      .toEqual([[FB_FERMO._id, 'todo']]);
  });
}

test('un rifiuto o un guasto del server si legge nel pannello, e si può riprovare', async ({ openTab }) => {
  const page = await apri(openTab, { riapri: { ok: false, error: 'Il server non risponde: controlla la connessione e riprova.' } });
  const corpo = page.locator('#mgSideBody');
  const riapri = corpo.locator('#mgRiapriFusioneBtn');
  await riapri.click();
  await expect(corpo.locator('#mgRiapriFusioneBtn ~ .mg-liv-esito')).toContainText('Il server non risponde');
  await expect(riapri).toBeEnabled();
  await expect(riapri).not.toHaveClass(/sn-btn-secondary/);
});

test('senza gli elenchi delle richieste la riapertura non si offre: potrebbero solo non essere arrivati', async ({ openTab }) => {
  const page = await apri(openTab, { elenchiOk: false });
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).toContainText('non sono ancora arrivate a questa pagina');
  await expect(corpo.locator('#mgRiapriFusioneBtn')).toHaveCount(0);
});

test('«Salta il controllo» col blocco ma senza richiesta registrata non dice «aspetta il via libera»: dice di rilanciare', async ({ openTab }) => {
  const bocciato = { ...FB_FERMO, statusReason: 'secaudit', livelli: { l4: { esito: 'fail', at: '2026-10-04T12:00:00Z', testo: 'Tocca le guardie.' } } };
  const page = await apri(openTab, {
    fb: bocciato, livello: 'l4',
    salta: { ok: true, esito: 'bloccato', requestId: '', error: 'il cancello ha fermato la fusione ma la richiesta per l’owner non si è registrata' },
  });
  const btn = page.locator('#mgSaltaL4Btn');
  await btn.click();
  await btn.click();
  const esito = page.locator('#mgSideBody .mg-liv-esito');
  await expect(esito).toContainText('Rilancia «Salta il controllo»');
  await expect(esito).toHaveAttribute('data-kind', 'err');
  await expect(esito).not.toContainText('sul quadrato');
});
