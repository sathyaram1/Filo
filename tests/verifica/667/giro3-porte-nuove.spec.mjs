// Verifica #667 — «il timer non suona», giro 3.
//
// I giri prima hanno chiuso: la scadenza che non si sente fuori dalla Nuova
// scheda, quella incognito, il tutto schermo (prima e dopo lo zero) e la
// suoneria che si sovrapponeva a sé stessa. Qui si contano le porte rimaste
// verso gli stessi due danni: un rumore senza interruttore raggiungibile, e
// due copie della stessa suoneria insieme.

import { test, expect } from '../../fixtures/electron.mjs';

const suona = (p) => p.evaluate(() => (window.SN_SOUNDS ? window.SN_SOUNDS.isRinging() : null));

const metti = (shell, label, seconds) => shell.evaluate(
  ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
  { l: label, s: seconds },
);

async function attendi(fn, ms = 15_000) {
  const scadenza = Date.now() + ms;
  while (Date.now() < scadenza) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Porta 1: le schede aperte. Il pulsante che ferma vive nella stessa striscia
// delle schede: con la fila piena e la finestra stretta — la giornata normale
// di chi tiene aperte venti pagine — deve restare dentro la finestra e premibile,
// altrimenti il rumore torna a non avere interruttore.
test('con venti schede e la finestra stretta il pulsante resta premibile', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(720, 560);
  });
  for (let i = 0; i < 19; i++) {
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  }
  await expect(shell.locator('.tab')).toHaveCount(20, { timeout: 30_000 });

  await metti(shell, 'Pasta', 2);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });
  expect(await suona(shell)).toBe(true);

  await shell.screenshot({ path: 'tests/.shots/667-giro3-fila-piena.png' }).catch(() => {});
  const box = await shell.locator('#ring-indicator').boundingBox();
  const largo = await shell.evaluate(() => window.innerWidth);
  expect(box, 'il pulsante deve avere una sua area sullo schermo').toBeTruthy();
  expect(box.width, 'il pulsante non deve essere schiacciato a zero').toBeGreaterThan(20);
  expect(box.x, 'il pulsante non deve uscire a sinistra').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'il pulsante non deve finire oltre il bordo della finestra')
    .toBeLessThanOrEqual(largo);

  // click() di Playwright preme al centro e fallisce se lì sopra c'è altro:
  // è la prova che il gesto dell'utente arriva davvero al pulsante.
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shell.waitForTimeout(1200);
  expect(await suona(shell)).toBe(false);
});

// Porta 2: due finestre incognito. L'overlay in RAM è uno solo, quindi la
// stessa scadenza la vedono tutte e due: se suonassero entrambe sarebbero due
// copie dello stesso motivo, sfasate — il danno del giro 2 da un'altra porta.
test('due finestre incognito non fanno suonare la stessa scadenza due volte', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const incognite = async () => app.windows().filter((w) => {
    try { return w.url().includes('incognito=1'); } catch (_) { return false; }
  });

  await shell.evaluate(() => window.filoShell.openIncognito());
  await attendi(async () => (await incognite()).length >= 1);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const due = await attendi(async () => ((await incognite()).length >= 2 ? await incognite() : null));
  expect(due, 'due finestre incognito devono potersi aprire').toBeTruthy();
  for (const p of due) await p.waitForLoadState('domcontentloaded').catch(() => {});

  await metti(due[0], 'Riso', 2);
  const sentito = await attendi(async () => (await suona(due[0])) || (await suona(due[1])));
  expect(sentito, 'la scadenza incognito deve farsi sentire').toBe(true);

  await due[0].waitForTimeout(1500);
  const chiSuona = [await suona(due[0]), await suona(due[1])].filter(Boolean).length;

  // Il gesto per fermare è uno solo anche se le finestre sono due: dove si
  // preme non deve contare, o il rumore resterebbe in quella dietro.
  await due[0].locator('#ring-indicator').click();
  await expect(due[0].locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await expect(due[1].locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await due[1].waitForTimeout(1200);
  expect(await suona(due[1]), 'premuto in una finestra, il rumore finisce in tutte e due').toBe(false);

  expect(chiSuona, 'una scadenza sola deve dare una suoneria sola').toBe(1);
});

// Porta 3: la finestra normale mentre una incognito ha una scadenza. Il nome
// dato a un timer in incognito è roba di quella finestra: se comparisse nel
// pulsante della finestra normale, quella scadenza si porterebbe dietro
// l'etichetta fuori dalla sessione che doveva restare senza tracce.
test('la scadenza incognito non compare nella finestra normale', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await shell.evaluate(() => window.filoShell.openIncognito());
  const incog = await attendi(() => {
    const p = app.windows().find((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } });
    return p || null;
  });
  expect(incog, 'la finestra incognito deve aprirsi').toBeTruthy();
  await incog.waitForLoadState('domcontentloaded').catch(() => {});

  await metti(incog, 'Segreto', 2);
  await expect(incog.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });

  await shell.waitForTimeout(2000);
  await expect(shell.locator('#ring-indicator')).toBeHidden();
  expect(await suona(shell), 'la finestra normale non deve suonare una scadenza incognito').toBe(false);
});

// Porta 4: dopo aver fermato. Zittire è l'unico gesto che l'utente fa su una
// suoneria: se spegnesse anche le scadenze successive, la lamentela di partenza
// tornerebbe al secondo timer della giornata.
test('fermata la prima, la scadenza dopo suona lo stesso', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await metti(shell, 'Uova', 2);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });

  await metti(shell, 'Tè', 2);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });
  expect(await suona(shell)).toBe(true);
  await expect(shell.locator('#ring-ind-label')).toHaveText('Tè — scaduto');
});
