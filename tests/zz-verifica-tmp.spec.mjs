// VERIFICA TEMPORANEA (da cancellare): fusioni approvate-ma-fallite nei
// Ricevuti + scadenza detta in giorni. Spec scritti da zero dal verificatore.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const SHA = '0123abcd'.repeat(5);
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.shots');

function pendente(over = {}) {
  return Object.assign({
    id: 'aa11aa11aa11aa11aa11aa11',
    branch: 'claude/lavoro-in-attesa',
    sha: SHA,
    who: 'sathya@esempio.it',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 5 * 60 * 1000,
    expiresAtMs: Date.now() + 7 * GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

function fallita(over = {}) {
  return Object.assign({
    id: 'ff00ff00ff00ff00ff00ff00',
    branch: 'worker/ramo-in-conflitto',
    sha: SHA,
    who: 'owner@esempio.it',
    used: true,
    outcome: 'conflict',
    decidedAtMs: Date.now() - 2 * 60 * 60 * 1000,
    createdAtMs: Date.now() - 3 * 60 * 60 * 1000,
    expiresAtMs: Date.now() + 5 * GIORNO,
  }, over);
}

async function stub(page, { admin = true, pending = [], failed = [], recent = [] } = {}) {
  await page.evaluate((cfg) => {
    window.__vfCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        const failedNow = cfg.failed.filter((f) => !window.__vfCalls.some((c) => c.op === 'discard' && c.id === f.id));
        return { ok: true, pending: cfg.pending, failed: failedNow, recent: cfg.recent, ttlMs: 7 * GIORNO };
      }
      if (t === 'merge_approval_approve') { window.__vfCalls.push({ op: 'approve', id: msg.id }); return { ok: true, result: 'merged', sha: 'cafecafe' }; }
      if (t === 'merge_approval_discard') { window.__vfCalls.push({ op: 'discard', id: msg.id }); return { ok: true, result: 'discarded' }; }
      return orig(msg);
    };
  }, { admin, pending, failed, recent });
}

async function apri(page, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page, opts);
  await page.evaluate((admin) => window.__mgTest.setAdmin(admin), opts?.admin !== false);
  const n = await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  console.log('[verifica] loadMergeApprovals →', n);
}

// 1. Solo una fusione fallita, NESSUNA in attesa: resta bene in vista.
test('fallita da sola: in vista nei Ricevuti, spiegata, senza Approva, con il gesto per sistemarla', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { pending: [], failed: [fallita()] });

  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  const host = page.locator('#mgMergeApprovals');
  const sez = host.locator('.sn-mac-failed');
  await expect(sez).toBeVisible({ timeout: 8_000 });

  // Spiegazione: cosa è successo e cosa succederà.
  await expect(sez).toContainText('worker/ramo-in-conflitto');
  await expect(sez).toContainText(/NON è avvenuta/i);
  await expect(sez).toContainText(/conflitto|non si incastrano|andato avanti/i);
  await expect(sez).toContainText(/si toglie da sola/i);

  // Non c'è più niente da approvare.
  await expect(sez.locator('.sn-mac-btn-go')).toHaveCount(0);
  await expect(sez.getByRole('button', { name: /sistemata/i })).toBeVisible();

  // In cima: sotto le schede, sopra la lista dei feedback.
  const suo = await sez.boundingBox();
  const schede = await page.locator('#mgTabs').boundingBox();
  const lista = await page.locator('#mgReviewGrid').boundingBox();
  expect(suo.y).toBeGreaterThanOrEqual(schede.y + schede.height - 1);
  expect(suo.y + suo.height).toBeLessThanOrEqual(lista.y + 1);

  // Nessun testo rotto sui dati normali.
  const testo = await host.innerText();
  expect(testo).not.toMatch(/undefined|NaN|null/);
});

// 2. Fallita + in attesa insieme: distinguibili, ordine sensato.
test('fallita e in attesa insieme: due sezioni distinte, la fallita sopra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { pending: [pendente()], failed: [fallita()] });

  const host = page.locator('#mgMergeApprovals');
  const fal = host.locator('.sn-mac-failed');
  const att = host.locator('.sn-mac:not(.sn-mac-failed)');
  await expect(fal).toBeVisible({ timeout: 8_000 });
  await expect(att).toBeVisible();

  // Titoli diversi: si capisce quale è quale.
  await expect(fal.locator('.sn-mac-title-text')).toContainText(/non è avvenuta/i);
  await expect(att.locator('.sn-mac-title-text')).toContainText(/aspetta il tuo via libera/i);

  // La fallita sopra (un sì già dato che non ha prodotto niente).
  const bf = await fal.boundingBox();
  const ba = await att.boundingBox();
  expect(bf.y).toBeLessThan(ba.y);

  // Solo la richiesta in attesa ha "Approva"; la fallita no.
  await expect(att.locator('.sn-mac-btn-go')).toHaveCount(1);
  await expect(fal.locator('.sn-mac-btn-go')).toHaveCount(0);

  // Screenshot per il giudizio estetico: tema chiaro e scuro.
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => { document.documentElement.setAttribute('data-sn-theme', 'light'); });
  await page.screenshot({ path: path.join(SHOTS, 'verifica-mac-light.png'), fullPage: false });
  await page.evaluate(() => { document.documentElement.setAttribute('data-sn-theme', 'dark'); });
  await page.screenshot({ path: path.join(SHOTS, 'verifica-mac-dark.png'), fullPage: false });
});

// 3. "Segna come sistemata": il gesto arriva al main e la scheda sparisce.
test('segnarla sistemata manda lo scarto al main e la scheda sparisce', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const f = fallita();
  await apri(page, { pending: [], failed: [f] });

  await page.locator('#mgMergeApprovals .sn-mac-failed').getByRole('button', { name: /sistemata/i }).click();
  await expect(page.locator('#mgMergeApprovals .sn-mac-failed')).toHaveCount(0, { timeout: 8_000 });
  const calls = await page.evaluate(() => window.__vfCalls);
  expect(calls).toEqual([{ op: 'discard', id: f.id }]);
  // Con niente altro in sospeso, il blocco si spegne del tutto.
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
});

// 4. Quando il server non la manda più (lavoro rifatto e fuso), sparisce da sola.
test('se il server smette di mandarla, la scheda si toglie da sola sulla pagina aperta', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { pending: [], failed: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();

  // Il main avvisa: c'è una fallita.
  await app.evaluate((_e, msg) => globalThis.SN_BROADCAST_FILO(msg), {
    type: 'merge_approvals_changed', pending: [], failed: [fallita()], recent: [], ttlMs: 7 * GIORNO,
  });
  await expect(page.locator('#mgMergeApprovals .sn-mac-failed')).toBeVisible({ timeout: 8_000 });

  // Il main riavvisa: non c'è più (il lavoro rifatto è stato fuso).
  await app.evaluate((_e, msg) => globalThis.SN_BROADCAST_FILO(msg), {
    type: 'merge_approvals_changed', pending: [], failed: [], recent: [], ttlMs: 7 * GIORNO,
  });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden({ timeout: 8_000 });
});

// 5. Un utente non owner non vede niente.
test('un non-owner non vede né fallite né in attesa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { admin: false, pending: [pendente()], failed: [fallita()] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('.sn-mac')).toHaveCount(0);
});

// 6. La scadenza si dice in GIORNI, con una richiesta che vale 7 giorni.
test('la scadenza di una richiesta da 7 giorni si legge in giorni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { pending: [pendente({ expiresAtMs: Date.now() + 7 * GIORNO })] });
  const exp = page.locator('#mgMergeApprovals .sn-mac-expiry');
  await expect(exp).toBeVisible({ timeout: 8_000 });
  await expect(exp).toContainText(/scade fra 7 giorni/);
  await expect(exp).not.toContainText(/ore|minuti/);
});

test('sopra il giorno si parla di giorni, sotto di ore', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [
      pendente({ id: '11'.repeat(12), expiresAtMs: Date.now() + 30 * 60 * 60 * 1000 }),
      pendente({ id: '22'.repeat(12), branch: 'claude/quasi-scaduta', expiresAtMs: Date.now() + 5 * 60 * 60 * 1000 }),
    ],
  });
  const exps = page.locator('#mgMergeApprovals .sn-mac-expiry');
  await expect(exps).toHaveCount(2, { timeout: 8_000 });
  await expect(exps.nth(0)).toContainText('scade fra 1 giorno');
  await expect(exps.nth(1)).toContainText('scade fra 5 ore');
});

// 7. Casi limite: campi mancanti e testi lunghi non rompono la scheda.
test('una fallita con campi mancanti si mostra lo stesso, senza testi rotti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { pending: [], failed: [{ id: 'ee'.repeat(12), used: true, outcome: 'conflict' }] });
  const sez = page.locator('#mgMergeApprovals .sn-mac-failed');
  await expect(sez).toBeVisible({ timeout: 8_000 });
  const testo = await sez.innerText();
  expect(testo).not.toMatch(/undefined|NaN/);
  await expect(sez).toContainText('(ramo sconosciuto)');
  // Il gesto per sistemarla funziona anche così.
  await sez.getByRole('button', { name: /sistemata/i }).click();
  await expect(page.locator('#mgMergeApprovals .sn-mac-failed')).toHaveCount(0, { timeout: 8_000 });
});

test('un ramo con nome lunghissimo non sfonda la scheda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lungo = 'worker/' + 'nome-molto-lungo-'.repeat(15);
  await apri(page, { pending: [], failed: [fallita({ branch: lungo })] });
  const sez = page.locator('#mgMergeApprovals .sn-mac-failed');
  await expect(sez).toBeVisible({ timeout: 8_000 });
  // Niente scroll orizzontale della pagina.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'verifica-mac-long.png') });
});
