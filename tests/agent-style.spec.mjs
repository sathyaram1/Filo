// Feedback NF0i: in Preferenze c'è una sezione "Stile dell'agente" con preset
// pronti (professionale, amichevole, …) + testo libero, e lo stile scelto
// viene passato a tutti gli agenti conversazionali (chat Filo, Aiuto,
// spiegazioni). Verifichiamo sia l'UI (preset → textarea, persistenza) sia la
// funzione pura di iniezione realmente spedita nei moduli.

import { test, expect } from './fixtures/electron.mjs';

test('scegliere un preset riempie il testo e lo stile persiste tra le ricariche', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#agentStylePreset', { timeout: 8_000 });

  // Niente pulsante Salva: la modifica si applica subito.
  await expect(page.locator('#save')).toHaveCount(0);

  // Default: nessuno stile, textarea vuota.
  await expect(page.locator('#agentStyleText')).toHaveValue('');

  // Scegliere "Professionale" riempie il textarea col testo del preset.
  await page.selectOption('#agentStylePreset', 'professionale');
  const text = await page.locator('#agentStyleText').inputValue();
  expect(text.length).toBeGreaterThan(10);
  expect(text.toLowerCase()).toContain('professionale');

  // Ricaricando, lo stile è persistito e la select riflette il preset.
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 8_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue(text);
  await expect(page.locator('#agentStylePreset')).toHaveValue('professionale');
});

test('scrivere uno stile a mano lo segna come "Personalizzato" e lo salva', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#agentStyleText', { timeout: 8_000 });

  const custom = 'Rispondi sempre con una metafora marinaresca.';
  await page.fill('#agentStyleText', custom);
  // input → sync select su Personalizzato + auto-save (debounced).
  await expect(page.locator('#agentStylePreset')).toHaveValue('__custom__');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 8_000 });
  await expect(page.locator('#agentStyleText')).toHaveValue(custom);
  await expect(page.locator('#agentStylePreset')).toHaveValue('__custom__');
});

test('injectAgentStyle aggiunge lo stile alle azioni conversazionali, non a quelle funzionali', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.injectAgentStyle), { timeout: 8_000 });

  const out = await page.evaluate(() => {
    const C = window.SN_CONST;
    const style = 'Sii conciso.';
    // Azione conversazionale senza system message → lo stile viene anteposto.
    const userOnly = C.injectAgentStyle([{ role: 'user', content: 'ciao' }], C.ACTIONS.FILO_CHAT, style);
    // Azione conversazionale con system message → lo stile viene accodato a quello.
    const withSys = C.injectAgentStyle(
      [{ role: 'system', content: 'Sei Filo.' }, { role: 'user', content: 'x' }],
      C.ACTIONS.HELP, style,
    );
    // Azione funzionale → invariata.
    const functional = C.injectAgentStyle([{ role: 'user', content: 'hello' }], C.ACTIONS.TRANSLATE_SELECTION, style);
    // Stile vuoto → invariato anche su azione conversazionale.
    const empty = C.injectAgentStyle([{ role: 'user', content: 'ciao' }], C.ACTIONS.FILO_CHAT, '   ');
    return { userOnly, withSys, functional, empty };
  });

  // userOnly: aggiunto un system message in testa con lo stile.
  expect(out.userOnly).toHaveLength(2);
  expect(out.userOnly[0].role).toBe('system');
  expect(out.userOnly[0].content).toContain('Sii conciso.');

  // withSys: il system message originale ora contiene anche lo stile.
  expect(out.withSys).toHaveLength(2);
  expect(out.withSys[0].role).toBe('system');
  expect(out.withSys[0].content).toContain('Sei Filo.');
  expect(out.withSys[0].content).toContain('Sii conciso.');

  // functional: nessuna iniezione.
  expect(out.functional).toHaveLength(1);
  expect(out.functional[0].role).toBe('user');
  expect(out.functional[0].content).toBe('hello');

  // empty: nessuna iniezione.
  expect(out.empty).toHaveLength(1);
  expect(out.empty[0].role).toBe('user');
});
