// I blocchi di una fusione ferma letti per intero (#1404): guardie toccate, capacità nuove e diff da guardare
// separati; ogni riga col suo file e numero, che apre il diff su GitHub; tre righe di contesto a richiesta; l'elenco
// completo. Vale per le schede in attesa (Automazioni) e per le fuse senza chiedere (Log): il disegno è uno solo.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const BASE = 'b0b0b0b0'.repeat(5);
const DIFF = `https://github.com/sathyaram1/Filo/compare/${BASE}...${SHA}`;
const GIORNO = 24 * 60 * 60 * 1000;

const voce = (file, riga, testo, extra = {}) => Object.assign({
  file, riga, testo, url: `${DIFF}#diff-${'0'.repeat(64)}R${riga}`,
  prima: ['   const a = 1;', '   const b = 2;', '-  vecchio();'], dopo: ['   return r;', ' }', ' '],
}, extra);

const CAPACITA = Array.from({ length: 40 }, (_, i) => voce(`src/main/servizio${i}.js`, 10 + i, `execFile('strumento-${i}', [percorso]);`));

function richiesta(over = {}) {
  return Object.assign({
    id: 'cd12cd34ef56ab12cd34ef56',
    branch: 'claude/blocchi-per-intero',
    sha: SHA,
    diffUrl: DIFF,
    who: 'owner@esempio',
    blocks: [
      { gate: 'child_process', gruppo: 'capacita', label: 'Avvia un programma esterno', voci: CAPACITA, more: 0 },
      { gate: 'guard_the_guards', gruppo: 'guardie', label: 'Tocca aree protette', voci: [{ file: 'firestore.rules', testo: '', url: `${DIFF}#diff-${'1'.repeat(64)}` }], more: 0 },
      {
        gate: 'diff_integrity', gruppo: 'contenuto', label: 'Il diff non si lascia leggere per intero',
        voci: [
          { file: 'tools/aiuto.bin', testo: 'file binario che non è un’immagine né un PDF', url: 'javascript:alert(1)' },
          voce('src/x.js', 3, '<img src=x onerror="window.__iniettato=1">', { url: 'https://sito-qualunque.com/x' }),
        ],
        more: 2,
      },
    ],
    createdAtMs: Date.now() - 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false,
    used: false,
    discarded: false,
  }, over);
}

async function apriGestione(page, { pending = [], preapproved = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: cfg.preapproved, preapprovedTotal: cfg.preapproved.length, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      return orig(msg);
    };
  }, { pending, preapproved });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await apriScheda(page, 'automation');
}

test('una fusione ferma dice guardie, capacità e diff separati, con file, riga e l’elenco intero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });

  await expect(card.locator('.sn-mac-gruppo-title')).toHaveText(['Guardie toccate', 'Capacità nuove', 'Diff da guardare a mano']);
  // L'elenco intero: quaranta righe, nessun «e altri», nessun taglio a 160 caratteri.
  const capacita = card.locator('.sn-mac-gruppo[data-gruppo="capacita"] .sn-mac-voce');
  await expect(capacita).toHaveCount(40);
  await expect(capacita.nth(39)).toContainText('src/main/servizio39.js:49');
  await expect(capacita.nth(39)).toContainText("execFile('strumento-39', [percorso]);");

  // File e riga aprono quella riga nel diff su GitHub, in una scheda.
  const dove = capacita.first().locator('a.sn-mac-voce-dove');
  await expect(dove).toHaveText('src/main/servizio0.js:10');
  await expect(dove).toHaveAttribute('href', `${DIFF}#diff-${'0'.repeat(64)}R10`);
  await expect(dove).toHaveAttribute('target', '_blank');
  // Il commit in testa apre il diff intero.
  await expect(card.locator('a.sn-mac-sha')).toHaveAttribute('href', DIFF);

  // Tre righe prima e dopo, a richiesta: la riga scattata in evidenza.
  const intorno = capacita.first().locator('.sn-mac-intorno');
  await expect(intorno).toBeHidden();
  await capacita.first().locator('.sn-mac-voce-testo').click();
  await expect(intorno).toBeVisible();
  await expect(intorno.locator('.sn-mac-intorno-riga')).toHaveCount(7);
  await expect(intorno.locator('.is-voce')).toHaveText("+execFile('strumento-0', [percorso]);");

  // Le guardie: il percorso, senza riga.
  await expect(card.locator('.sn-mac-gruppo[data-gruppo="guardie"] .sn-mac-voce')).toHaveText('firestore.rules');
  // Quante non entrano si dice.
  await expect(card.locator('.sn-mac-gruppo[data-gruppo="contenuto"]')).toContainText('… e altre 2');
  await card.screenshot({ path: 'tests/.shots/merge-approvals-voci-chiaro.png' }).catch(() => {});
});

test('un indirizzo che non è di GitHub non diventa un collegamento, e il codice si legge come testo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });
  const contenuto = page.locator('#mgMergeApprovalsOrphans .sn-mac-gruppo[data-gruppo="contenuto"]');
  await expect(contenuto).toBeVisible({ timeout: 8_000 });
  await expect(contenuto.locator('a')).toHaveCount(0);
  await expect(contenuto.locator('.sn-mac-voce-dove').first()).toHaveText('tools/aiuto.bin');
  await expect(contenuto).toContainText('<img src=x onerror="window.__iniettato=1">');
  await expect(contenuto.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__iniettato)).toBeUndefined();
});

test('le fuse senza chiedere, nel Log, si leggono con lo stesso disegno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fusa = richiesta({
    id: 'ee12cd34ef56ab12cd34ef56', used: true, outcome: 'merged', preapproved: true, skippedL5: true, motivo: 'fiducia',
    mergeSha: 'c'.repeat(40), diffUrl: `https://github.com/sathyaram1/Filo/commit/${'c'.repeat(40)}`, decidedAtMs: Date.now() - 1000,
  });
  await apriGestione(page, { preapproved: [fusa] });
  await apriScheda(page, 'log');
  const riga = page.locator('#mgMergeApprovalsPreapproved .sn-mac-preapproved-row');
  await expect(riga).toBeVisible({ timeout: 8_000 });
  await expect(riga.locator('.sn-mac-gruppo-title')).toHaveText(['Guardie toccate', 'Capacità nuove', 'Diff da guardare a mano']);
  await expect(riga.locator('.sn-mac-gruppo[data-gruppo="capacita"] .sn-mac-voce')).toHaveCount(40);
  await expect(riga.locator('a.sn-mac-sha')).toHaveAttribute('href', `https://github.com/sathyaram1/Filo/commit/${'c'.repeat(40)}`);
});

test('tema scuro: la scheda e l’intorno restano leggibili', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await apriGestione(page, { pending: [richiesta()] });
  const card = page.locator('#mgMergeApprovalsOrphans .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  await card.locator('.sn-mac-gruppo[data-gruppo="capacita"] .sn-mac-voce-testo').first().click();
  const [fondo, testo] = await card.locator('.sn-mac-intorno .is-voce').first().evaluate((n) => {
    const cs = getComputedStyle(n);
    return [getComputedStyle(n.closest('.sn-mac-card')).backgroundColor, cs.color];
  });
  expect(fondo).not.toBe(testo);
  await card.screenshot({ path: 'tests/.shots/merge-approvals-voci-scuro.png' }).catch(() => {});
});
