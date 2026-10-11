// Verifica #667 — «il timer non suona», giro 1.
//
// La lamentela è di orecchio, non di schermo: la scadenza deve FARSI SENTIRE.
// Qui si prova che l'audio è davvero acceso (SN_SOUNDS.state() === 'running',
// non un flag alzato da noi) su tutte le porte che portano a una scadenza:
// la sveglia, la scadenza già in corso quando la finestra si (ri)apre, le
// etichette storte, il doppio clic sul gesto che ferma.

import { test, expect } from '../../fixtures/electron.mjs';

const execAction = (app, action) =>
  app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), action);

const suona = (shell) => shell.evaluate(() => ({
  ring: window.SN_SOUNDS.isRinging(),
  stato: window.SN_SOUNDS.state(),
}));

const leggiTimer = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.message({ type: window.SN_MSG.MSG.FILO_GET_TIMERS });
  return r.timers;
});

// Porta 1: la SVEGLIA. Stessa colonna, stesso stato `ringing`, ma è l'altra
// metà della funzione: se suonasse solo il timer, metà delle scadenze di Filo
// resterebbe muta.
test('una sveglia scaduta suona e il chip dice che è una sveglia', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const r = await execAction(app, {
    type: 'SVEGLIA',
    label: 'pillola',
    time: new Date(Date.now() + 2500).toISOString(),
  });
  expect(r.executed).toBe(true);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  await expect(shell.locator('#ring-ind-label')).toHaveText('Sveglia — pillola');
  expect(await suona(shell)).toEqual({ ring: true, stato: 'running' });

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  await shell.waitForTimeout(1200);
  expect((await suona(shell)).ring).toBe(false);
});

// Porta 2: la scadenza è già in corso quando la shell nasce (Filo riaperto, o
// la finestra ricaricata). Qui non arriva nessun broadcast «è scaduto»: se la
// suoneria partisse solo sull'annuncio, chi riapre Filo troverebbe il silenzio.
test('una scadenza già in corso suona appena la finestra si riapre', async ({ shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(
    (t) => window.filoShell.message({ type: t, label: 'Forno', seconds: 2 }),
    tipo,
  );
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });

  await shell.reload();
  await shell.waitForLoadState('domcontentloaded');

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  await expect(shell.locator('#ring-ind-label')).toHaveText('Forno — scaduto');
  expect(await suona(shell)).toEqual({ ring: true, stato: 'running' });
});

// Porta 3: le etichette arrivano da chi scrive in chat, quindi possono essere
// qualunque cosa. Il chip vive nella striscia dei tab: se si allarga a piacere
// si mangia le schede, e quello che ci finisce dentro non deve poter eseguire.
test('etichette storte: il chip resta al suo posto e non esegue niente', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const altezzaPrima = await shell.evaluate(
    () => document.querySelector('.tab-row').getBoundingClientRect().height,
  );

  const etichetta = `🔔<script>window.__bucato=1</script>${'a'.repeat(10_000)}`;
  await execAction(app, { type: 'TIMER', label: etichetta, seconds: 2 });

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  expect(await suona(shell)).toEqual({ ring: true, stato: 'running' });

  const misure = await shell.evaluate(() => {
    const chip = document.getElementById('ring-indicator');
    const riga = document.querySelector('.tab-row');
    return {
      largo: chip.getBoundingClientRect().width,
      altoRiga: riga.getBoundingClientRect().height,
      bucato: window.__bucato === 1,
      script: !!document.getElementById('ring-ind-label').querySelector('script'),
      dentroLaRiga: chip.getBoundingClientRect().right <= riga.getBoundingClientRect().right + 1,
    };
  });
  expect(misure.bucato).toBe(false);
  expect(misure.script).toBe(false);
  expect(misure.largo).toBeLessThanOrEqual(240);
  expect(misure.altoRiga).toBeCloseTo(altezzaPrima, 0);
  expect(misure.dentroLaRiga).toBe(true);

  await shell.screenshot({ path: 'tests/.shots/667-chip-chiaro.png' });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(300);
  await shell.screenshot({ path: 'tests/.shots/667-chip-scuro.png' });
  await shell.emulateMedia({ colorScheme: 'light' });
});

// Porta 4: il gesto esiste per far smettere un rumore, quindi lo si preme di
// fretta e più volte. Due clic non devono lasciare una scadenza viva dietro.
test('doppio clic sul chip: smette e non torna, e la lista resta pulita', async ({ shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(async (t) => {
    await window.filoShell.message({ type: t, label: 'Pasta', seconds: 2 });
    await window.filoShell.message({ type: t, label: 'Tè', seconds: 2 });
  }, tipo);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  await shell.locator('#ring-indicator').dblclick({ force: true });

  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  await shell.waitForTimeout(1500);
  await expect(shell.locator('#ring-indicator')).toBeHidden();
  expect((await suona(shell)).ring).toBe(false);
  expect(await leggiTimer(shell)).toEqual([]);
});

// Porta 5: una durata che non si capisce non deve creare una scadenza fasulla
// che squilla subito — il rumore senza motivo è peggio del silenzio.
test('durate storte non fanno partire nessuna suoneria', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  for (const seconds of [0, -30, 'domani', '', null]) {
    const r = await execAction(app, { type: 'TIMER', label: 'fantasma', seconds });
    expect(r.executed, `seconds=${JSON.stringify(seconds)}`).toBe(false);
  }
  await shell.waitForTimeout(1500);
  await expect(shell.locator('#ring-indicator')).toBeHidden();
  expect((await suona(shell)).ring).toBe(false);
  expect(await leggiTimer(shell)).toEqual([]);
});
