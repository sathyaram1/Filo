// Pagina Red Team (filo://redteam/) — spec UX filo-redteam-ux-spec §3,§4,§6,§7,§8.4.
//
// Assert di COMPORTAMENTO (non "non crasha"):
//   - le 3 tab esistono e cambiare tab cambia il contenuto visibile;
//   - iniettando uno stato verificato canonico, la griglia rende celle
//     sbloccate/bloccate corrette e il riepilogo riflette i record;
//   - la leaderboard rende una riga per entry; un handle con <script> è
//     ESCAPED (nessun <script> creato, testo mostrato letterale) → anti-XSS;
//   - il gate "non verificato" mostra il form di riscatto codice.
//
// Le funzioni pure stanno su window.RedteamUI: iniettiamo lo stato via
// page.evaluate, così il test non dipende dal backend (non ancora deployato).

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://redteam/redteam.html';

test('le 3 tab esistono e cambiano il contenuto visibile', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const tabs = page.locator('.rt-tab');
  await expect(tabs).toHaveCount(3);
  await expect(page.locator('.rt-tab[data-tab="stats"]')).toBeVisible();
  await expect(page.locator('.rt-tab[data-tab="leaderboard"]')).toBeVisible();
  await expect(page.locator('.rt-tab[data-tab="rules"]')).toBeVisible();

  // Di default Statistiche è attiva; Regole è nascosta.
  await expect(page.locator('#panel-stats')).toBeVisible();
  await expect(page.locator('#panel-rules')).toBeHidden();

  // Click su "Regole" → il pannello regole diventa visibile, Statistiche no.
  await page.locator('.rt-tab[data-tab="rules"]').click();
  await expect(page.locator('#panel-rules')).toBeVisible();
  await expect(page.locator('#panel-stats')).toBeHidden();
  // La tab Regole rende davvero la scala dei colori (4 livelli).
  await expect(page.locator('#panel-rules .rt-scale-row')).not.toHaveCount(0);

  // Click su "Leaderboard".
  await page.locator('.rt-tab[data-tab="leaderboard"]').click();
  await expect(page.locator('#panel-leaderboard')).toBeVisible();
  await expect(page.locator('#panel-rules')).toBeHidden();
});

test('stato verificato: griglia rende celle sbloccate/bloccate e riepilogo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(() => {
    window.RedteamUI.applyState({
      signedIn: true,
      verified: true,
      isOwner: false,
      handle: 'tester1',
      bestPerJudge: { A: 3, B: 2, C: 1, D: 0 },
      leaderboardScore: 6,
      gridUnlocked: {
        A: [true, true, true],   // tutte e 3
        B: [true, true, false],  // spam + verifica
        C: [true, false, false], // solo spam
        D: [false, false, false],// nessuna
      },
      milestones: { sottoIlRadar: true, infiltrato: false, fantasma: false },
    });
  });

  // Il contenuto verificato è visibile, i gate no.
  await expect(page.locator('#statsContent')).toBeVisible();
  await expect(page.locator('#gateVerify')).toBeHidden();
  await expect(page.locator('#gateSignin')).toBeHidden();

  // 4 giudici × 3 livelli = 12 celle.
  await expect(page.locator('#grid .rt-cell')).toHaveCount(12);

  // Conteggio sbloccate/bloccate: 3+2+1+0 = 6 on, 6 off.
  await expect(page.locator('#grid .rt-cell[data-state="on"]')).toHaveCount(6);
  await expect(page.locator('#grid .rt-cell[data-state="off"]')).toHaveCount(6);

  // Celle specifiche: A-livello2 (via libera) ON, C-livello1 (verifica) OFF.
  await expect(page.locator('#grid .rt-cell[data-judge="A"][data-level="2"]'))
    .toHaveAttribute('data-state', 'on');
  await expect(page.locator('#grid .rt-cell[data-judge="C"][data-level="1"]'))
    .toHaveAttribute('data-state', 'off');
  await expect(page.locator('#grid .rt-cell[data-judge="D"][data-level="0"]'))
    .toHaveAttribute('data-state', 'off');

  // Badge: solo "sotto il radar" sbloccato.
  await expect(page.locator('.rt-badge[data-key="sottoIlRadar"]')).toHaveAttribute('data-state', 'on');
  await expect(page.locator('.rt-badge[data-key="infiltrato"]')).toHaveAttribute('data-state', 'off');
  await expect(page.locator('.rt-badge[data-key="fantasma"]')).toHaveAttribute('data-state', 'off');

  // Riepilogo: punteggio 6/12 e handle mostrato.
  await expect(page.locator('#summaryScore')).toHaveText('6/12');
  await expect(page.locator('#summaryHandle')).toHaveText('tester1');
});

test('leaderboard rende le righe ed ESCAPE un handle con <script> (anti-XSS)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const evil = '<script>window.__xss=1<\/script>';
  await page.evaluate((evilHandle) => {
    window.RedteamUI.renderLeaderboard({
      entries: [
        { handle: 'alice', leaderboardScore: 11, bestPerJudge: { A: 3, B: 3, C: 3, D: 2 }, totalAttempts: 4, milestones: { sottoIlRadar: true, infiltrato: true, fantasma: false } },
        { handle: evilHandle, leaderboardScore: 5, bestPerJudge: { A: 2, B: 1, C: 1, D: 1 }, totalAttempts: 9, milestones: {} },
      ],
    });
  }, evil);

  // Due righe.
  await expect(page.locator('#leaderboardBody .rt-lb-row')).toHaveCount(2);
  await expect(page.locator('#leaderboardBody .rt-lb-row:first-child .rt-lb-handle')).toHaveText('alice');
  await expect(page.locator('#leaderboardBody .rt-lb-row:first-child .rt-lb-score')).toHaveText('11/12');

  // ANTI-XSS: nessun <script> creato nel body della leaderboard, e l'handle è
  // mostrato come testo letterale (textContent), non interpretato.
  await expect(page.locator('#leaderboardBody script')).toHaveCount(0);
  await expect(page.locator('#leaderboardBody .rt-lb-row:nth-child(2) .rt-lb-handle')).toHaveText(evil);
  const xssFired = await page.evaluate(() => window.__xss === 1);
  expect(xssFired).toBe(false);
});

test('non verificato: il gate mostra il form di riscatto codice', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(() => {
    window.RedteamUI.applyState({ signedIn: true, verified: false, isOwner: false });
  });

  await expect(page.locator('#gateVerify')).toBeVisible();
  await expect(page.locator('#statsContent')).toBeHidden();
  // Form di riscatto: campi handle + codice + bottone Verifica.
  await expect(page.locator('#redeemForm')).toBeVisible();
  await expect(page.locator('#redeemHandle')).toBeVisible();
  await expect(page.locator('#redeemCode')).toBeVisible();
  await expect(page.locator('#redeemBtn')).toBeVisible();

  // Non loggato → gate di accesso.
  await page.evaluate(() => {
    window.RedteamUI.applyState({ signedIn: false, verified: false });
  });
  await expect(page.locator('#gateSignin')).toBeVisible();
  await expect(page.locator('#gateVerify')).toBeHidden();
});

test('live reveal: slot in attesa diventano rivelati e mostra esito validità', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // L'area di rivelazione vive dentro il contenuto verificato (spec §8.4: solo
  // i verificati la vedono). Mettiamo prima uno stato verificato così è visibile.
  await page.evaluate(() => {
    window.RedteamUI.applyState({ signedIn: true, verified: true, isOwner: false, gridUnlocked: {}, milestones: {} });
  });

  // Parziale: solo B e D hanno risposto; A e C in attesa.
  await page.evaluate(() => {
    window.RedteamUI.renderReveal({
      title: 'Tentativo di jailbreak via roleplay',
      status: 'pending',
      verdicts: {
        B: { class: 'pass', points: 3 },
        D: { class: 'spam', points: 1 },
      },
    });
  });
  await expect(page.locator('#revealSection')).toBeVisible();
  await expect(page.locator('.rt-slot[data-judge="B"]')).toHaveAttribute('data-state', 'revealed');
  await expect(page.locator('.rt-slot[data-judge="A"]')).toHaveAttribute('data-state', 'waiting');
  await expect(page.locator('#revealSummary')).toBeHidden();

  // Completo + non valido: i punti sono mostrati ma marcati come non conteggiati.
  await page.evaluate(() => {
    window.RedteamUI.renderReveal({
      title: 'Tentativo di jailbreak via roleplay',
      status: 'complete',
      score: 7,
      isValidAttack: false,
      verdicts: {
        A: { class: 'review', points: 2 },
        B: { class: 'pass', points: 3 },
        C: { class: 'spam', points: 1 },
        D: { class: 'spam', points: 1 },
      },
    });
  });
  await expect(page.locator('.rt-slot[data-state="waiting"]')).toHaveCount(0);
  await expect(page.locator('#revealSummary')).toBeVisible();
  await expect(page.locator('.rt-reveal-validity--invalid')).toBeVisible();
});
