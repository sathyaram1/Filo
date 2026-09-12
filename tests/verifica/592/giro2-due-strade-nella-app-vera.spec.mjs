// Verifica #592, giro 2 — le due strade dello stile dentro l'app vera.
//
// Lo stile dell'agente si cambia da due parti: la pagina Preferenze e la chat
// con Filo (che dal #592 chiede conferma mostrando il testo). Due strade per
// la stessa cosa devono finire nello stesso posto, e non devono disfare il
// lavoro l'una dell'altra.
//
// Qui si guarda proprio quello, con la pagina Preferenze APERTA mentre Filo
// cambia lo stile: è la situazione normale di chi sta guardando le preferenze
// e nel frattempo chiede a Filo di parlargli in un altro modo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

// Lo stile proposto da Filo e confermato dall'utente: la strada della chat.
const daFilo = (page, valore) => page.evaluate(async (v) =>
  chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: v },
  }), valore);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 15_000 });
  return page;
}

test('lo stile confermato in chat si rilegge nelle Preferenze', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await daFilo(pagina, 'Rispondi con frasi brevi e dammi sempre un esempio.');

  // Chi apre le Preferenze dopo deve trovarcelo: è la promessa del feedback,
  // «resta sempre visibile e cancellabile dalle preferenze».
  await pagina.reload();
  await pagina.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await expect(pagina.locator('#agentStyleText'))
    .toHaveValue('Rispondi con frasi brevi e dammi sempre un esempio.');
  await expect(pagina.locator('#agentStylePreset')).toHaveValue('__custom__');
});

test('lo stile tolto dalle Preferenze è tolto anche per la chat', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await daFilo(pagina, 'Tono formale.');
  await pagina.reload();
  await pagina.waitForSelector('#agentStyleText', { timeout: 15_000 });

  await pagina.selectOption('#agentStylePreset', '');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).agentStyle || '').toBe('');
});

test('otto giri dentro e fuori dal tetto non lasciano salvato un troncone', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  const max = await pagina.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);

  for (let i = 0; i < 8; i += 1) {
    await pagina.fill('#agentStyleText', `Giro ${i}: rispondi corto.`);
    await pagina.waitForTimeout(120);
    await pagina.fill('#agentStyleText', 'q'.repeat(max + 500));
    await pagina.waitForTimeout(120);
  }
  await pagina.waitForTimeout(1500);

  const salvato = (await impostazioni(pagina)).agentStyle || '';
  // Quello che resta è uno degli stili buoni, mai un pezzo del testo lungo.
  expect(salvato.length).toBeLessThanOrEqual(max);
  expect(salvato.startsWith('q')).toBe(false);
});

test('Filo cambia lo stile mentre le Preferenze sono aperte: la pagina non lo disfa', async ({ openTab }) => {
  // La pagina Preferenze salva TUTTO il modulo a ogni modifica di un campo
  // qualsiasi. Se nel frattempo Filo ha cambiato lo stile (con la conferma
  // dell'utente), un tocco a un altro campo non deve riscrivere sopra lo stile
  // vecchio che la pagina si era letta all'apertura.
  const pagina = await apriPreferenze(openTab);
  await pagina.fill('#agentStyleText', 'Stile scritto a mano.');
  await expect(pagina.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 6_000 });

  const nuovo = 'Dammi del lei e sii molto sintetico.';
  await daFilo(pagina, nuovo);
  expect((await impostazioni(pagina)).agentStyle).toBe(nuovo);

  // Ora l'utente tocca un altro campo della stessa pagina, senza sfiorare lo
  // stile: cambia il tema.
  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1500);

  expect((await impostazioni(pagina)).agentStyle).toBe(nuovo);
});

test('la sezione dello stile si legge su tema chiaro e su tema scuro', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  const max = await pagina.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);
  await pagina.fill('#agentStyleText', 'w'.repeat(max + 42));
  await expect(pagina.locator('#agentStyleError')).toBeVisible({ timeout: 6_000 });

  for (const tema of ['light', 'dark']) {
    await pagina.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      if (window.Bootstrap && window.Bootstrap.applyTheme) window.Bootstrap.applyTheme(t);
    }, tema);
    await pagina.waitForTimeout(250);
    const sezione = pagina.locator('#agentStyleText').locator('xpath=ancestor::section[1]');
    await sezione.screenshot({ path: `tests/.shots/592-giro2-stile-${tema}.png` });

    // Il conteggio e il messaggio di rifiuto stanno dentro la sezione, non
    // fuori dallo schermo né sotto un altro elemento.
    const box = await pagina.locator('#agentStyleError').boundingBox();
    expect(box, `tema ${tema}`).not.toBeNull();
    expect(box.width, `tema ${tema}`).toBeGreaterThan(0);
    await expect(pagina.locator('#agentStyleCount')).toContainText(String(max + 42));
  }
});
