// Verifica #592, giro 1 — la pagina Preferenze: lo stile resta visibile,
// cancellabile, e il tetto rifiuta invece di tagliare di nascosto.
//
// Il feedback chiede che lo stile «resti sempre visibile e cancellabile dalle
// preferenze» e che il tetto sia «dichiarato e con rifiuto spiegato, mai un
// taglio muto». Qui si guarda dal punto di vista dell'utente: cosa vede, cosa
// riesce a fare, e cosa resta salvato davvero dopo una ricarica.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://preferences/preferences.html';

async function apriPreferenze(openTab) {
  const page = await openTab(PAGINA);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 15_000 });
  return page;
}

test('il tetto è dichiarato prima di sbatterci contro, e il conteggio si muove', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);

  // A pagina appena aperta il tetto si vede già: non lo si scopre con un errore.
  await expect(page.locator('#agentStyleCount')).toContainText(String(max));

  await page.fill('#agentStyleText', 'Rispondi corto.');
  await expect(page.locator('#agentStyleCount')).toHaveText(`15/${max}`);
  await expect(page.locator('#agentStyleError')).toBeHidden();
});

test('10.000 caratteri incollati: rifiuto spiegato, testo NON tagliato, resta salvato quello di prima', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);

  const buono = 'Rispondi sempre in italiano, con frasi brevi.';
  await page.fill('#agentStyleText', buono);
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 6_000 });

  // Ora l'utente incolla un testo enorme.
  await page.fill('#agentStyleText', 'z'.repeat(10_000));

  // 1) glielo dice, col numero, e non di nascosto.
  const errore = page.locator('#agentStyleError');
  await expect(errore).toBeVisible({ timeout: 6_000 });
  await expect(errore).toContainText('10000');
  await expect(errore).toContainText(String(max));

  // 2) il testo che ha scritto resta lì per intero: deve poterlo accorciare lui,
  //    scegliendo cosa tenere. Nessun taglio automatico.
  expect(await page.locator('#agentStyleText').inputValue()).toHaveLength(10_000);

  // 3) e in memoria resta lo stile di prima, non un troncone da 600 caratteri.
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue(buono);
});

test('lo stile scritto si rilegge e si cancella: se si può mettere si può togliere', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);

  await page.fill('#agentStyleText', 'Dammi sempre un esempio pratico.');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 6_000 });
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue('Dammi sempre un esempio pratico.');

  // Via dalla select, la strada senza tastiera.
  await page.selectOption('#agentStylePreset', '');
  await expect(page.locator('#agentStyleText')).toHaveValue('');
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue('');
});

test('anche svuotando il testo a mano lo stile sparisce davvero', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);
  await page.fill('#agentStyleText', 'Tono formale.');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 6_000 });
  await page.fill('#agentStyleText', '');
  // Il salvataggio è ritardato di qualche decimo: la spia «Salvato» è già
  // accesa dal salvataggio di prima, quindi non basta guardare lei.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue('');
});

test('il messaggio di rifiuto si legge su tema chiaro e su tema scuro', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);
  await page.fill('#agentStyleText', 'q'.repeat(max + 50));
  await expect(page.locator('#agentStyleError')).toBeVisible({ timeout: 6_000 });

  for (const tema of ['light', 'dark']) {
    await page.selectOption('#theme', tema);
    await page.waitForTimeout(400);
    const scatto = await page.locator('#agentStyleError').screenshot();
    expect(scatto.length).toBeGreaterThan(0);
    await page.screenshot({ path: `tests/.shots/592-stile-tetto-${tema}.png`, fullPage: false });
    // Il testo dell'errore non deve finire fuori dal riquadro della pagina.
    const box = await page.locator('#agentStyleError').boundingBox();
    const larghezza = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x + box.width).toBeLessThanOrEqual(larghezza + 1);
  }
});

test('scritture rapide in sequenza non lasciano salvato un testo oltre il tetto', async ({ openTab }) => {
  const page = await apriPreferenze(openTab);
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);
  const buono = 'Sii conciso.';
  await page.fill('#agentStyleText', buono);
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 6_000 });

  // Dentro/fuori dal tetto più volte di fila, in fretta.
  for (let i = 0; i < 4; i++) {
    await page.fill('#agentStyleText', 'a'.repeat(max + 200));
    await page.fill('#agentStyleText', buono);
  }
  await page.fill('#agentStyleText', 'b'.repeat(max + 200));
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  const salvato = await page.locator('#agentStyleText').inputValue();
  expect(salvato.length).toBeLessThanOrEqual(max);
  expect(salvato).toBe(buono);
});
