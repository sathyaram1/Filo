// #949 — ogni impostazione si legge e si cambia chiedendola a Filo: «spegni il blocco della pubblicità»
// spegne l'interruttore della pagina Sicurezza (anche già aperta), «com'è impostato?» risponde il valore vero,
// e il cambio si annulla dal segno sulla bolla. Ogni prova asserisce il successo visto dall'utente: senza il
// fix la chiave non esiste e l'interruttore resta acceso.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd, CONFIRM_HOST } from './helpers/confirm.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

// Il modello finto: un giro per elemento. `rispondiDa: '<nome voce>'` risponde con la riga di quella voce
// presa dall'esito di LEGGI_IMPOSTAZIONI, come farebbe un modello che legge il valore vero.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__imp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__imp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__imp_tool.push(String(ultimo.content || ''));
      let text = giro.text || '';
      if (giro.rispondiDa) {
        const riga = String((ultimo && ultimo.content) || '').split('\n').find((r) => r.startsWith(`- ${giro.rispondiDa}:`));
        text = riga ? `Adesso ${riga.slice(2).replace(/ \[.*$/, '')}.` : 'Non lo so.';
      }
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__imp_restore?.(); } catch (_) {} });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (chiave, valore, id = 'i1') => ({
  toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }],
});

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('A — «spegni il blocco della pubblicità»: conferma, interruttore spento nella Sicurezza aperta, «com\'è impostato?» dice il vero, annulla lo riaccende', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-adblock')).toBeChecked({ timeout: 8_000 });

  await modelloFinto(app, [imposta('blocco_pubblicita', false), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'spegni il blocco della pubblicità');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });
  // Il popup dice cosa cambia e cosa rischia; finché non c'è l'OK non cambia niente.
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 5_000 }).toContain('Blocco di pubblicità e tracker → disattivato');
  expect((await confirmState(chat)).text).toMatch(/tracker/);
  expect((await impostazioni(app)).security.adblock.enabled).toBe(true);
  await chat.screenshot({ path: 'tests/.shots/impostazioni-chat-conferma-adblock.png' });
  // Abbassa una difesa (#530): vuole la parola «conferma» a ogni livello.
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).security.adblock.enabled, { timeout: 5_000 }).toBe(false);
  // Dopo l'OK il pulsante dice la cosa fatta, non «Filo vuole impostare».
  const pulsante = chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' }).locator('.dash-action-btn');
  await expect(pulsante).toHaveText('✓ Impostazione applicata: Blocco di pubblicità e tracker → disattivato', { timeout: 5_000 });

  // Cosa è cambiato e come tornare indietro: il segno sulla bolla.
  const bolla = chat.locator('.dash-bubble-user', { hasText: 'spegni il blocco della pubblicità' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('blocco di pubblicità e tracker: attivo → spento');
  await expect(pop.locator('.dash-cambi-annulla')).toHaveText('annulla');
  await chat.screenshot({ path: 'tests/.shots/impostazioni-chat-segno-adblock.png' });

  // La pagina Sicurezza già aperta segue il cambio, senza ricaricarla.
  await sec.bringToFront();
  await expect(sec.locator('#sec-adblock')).not.toBeChecked({ timeout: 3_000 });
  await sec.screenshot({ path: 'tests/.shots/impostazioni-chat-sicurezza-spenta.png' });
  // E toccare un'altra voce lì non riaccende il blocco.
  await sec.locator('#sec-adskip').uncheck();
  await expect.poll(async () => (await impostazioni(app)).security.adSkip.enabled, { timeout: 3_000 }).toBe(false);
  expect((await impostazioni(app)).security.adblock.enabled, 'la pagina ha riscritto il valore di prima').toBe(false);

  // «com'è impostato?» legge il valore vero.
  await modelloFinto(app, [
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'blocco della pubblicità' }) }] },
    { rispondiDa: 'blocco di pubblicità e tracker' },
  ]);
  await scrivi(chat, 'com\'è impostato il blocco della pubblicità?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Adesso blocco di pubblicità e tracker: spento.' })).toBeVisible({ timeout: 10_000 });
  const esito = (await app.evaluate(() => globalThis.__imp_tool)).pop();
  expect(esito).toContain('- blocco di pubblicità e tracker: spento [chiave blocco_pubblicita, chiede conferma]');
  expect(esito).not.toContain('k-test');

  // Annulla dal segno: il blocco torna acceso, anche nella pagina aperta.
  await chat.bringToFront();
  await segno.hover();
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).security.adblock.enabled, { timeout: 5_000 }).toBe(true);
  await sec.bringToFront();
  await expect(sec.locator('#sec-adblock')).toBeChecked({ timeout: 3_000 });
  await ripristina(app);
});

test('B — «blocca facebook.com» e la segnalazione automatica dalla chat: la pagina Sicurezza aperta li mostra, una pagina aperta dopo anche', async ({ app, shell, openTab }) => {
  await livelloAutonomia(app, 'conservativo'); // il popup di un costo 2 si prova a Conservativo (#530)
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { blacklist: ['tiktok.com'] } } }));
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-siteblock-blacklist')).toHaveValue('tiktok.com', { timeout: 8_000 });
  // La casella resta col fuoco mentre l'utente va in chat: da dietro nessuno ci sta scrivendo.
  await sec.locator('#sec-siteblock-blacklist').focus();

  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi facebook.com'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'blocca facebook.com');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).security.siteBlock.blacklist, { timeout: 5_000 }).toEqual(['tiktok.com', 'facebook.com']);
  await sec.bringToFront();
  await expect(sec.locator('#sec-siteblock-blacklist')).toHaveValue('tiktok.com\nfacebook.com', { timeout: 3_000 });

  // Lo stesso sito una seconda volta: niente da confermare né da cambiare, e il modello lo sa.
  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi facebook.com', 'i2'), { text: 'C\'era già.' }]);
  await scrivi(chat, 'blocca facebook.com');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'C\'era già.' })).toBeVisible({ timeout: 10_000 });
  await expect(chat.locator('.sn-confirm-host')).toHaveCount(0);
  await expect.poll(async () => (await app.evaluate(() => globalThis.__imp_tool)).join('\n'), { timeout: 10_000 }).toMatch(/Niente da cambiare: .*facebook\.com c'è già/);
  expect((await impostazioni(app)).security.siteBlock.blacklist).toEqual(['tiktok.com', 'facebook.com']);

  await modelloFinto(app, [imposta('segnalazione_automatica', 'no', 'i3'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'spegni la segnalazione automatica');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).security.autoFeedback, { timeout: 5_000 }).toBe(false);
  await sec.bringToFront();
  await expect(sec.locator('#sec-auto-feedback')).not.toBeChecked({ timeout: 3_000 });

  const nuova = await openTab('filo://security/security.html');
  await expect(nuova.locator('#sec-auto-feedback')).not.toBeChecked({ timeout: 8_000 });
  await expect(nuova.locator('#sec-siteblock-blacklist')).toHaveValue('tiktok.com\nfacebook.com');
  await ripristina(app);
});

test('C — il limite di spesa cambiato in chat compare nella pagina Modelli aperta, e un clic lì non lo riporta indietro', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const opt = await openTab('filo://options/options.html');
  await expect(opt.locator('#monthlyLimit')).toHaveValue('5', { timeout: 8_000 });

  await modelloFinto(app, [imposta('limite_spesa', '12 euro'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'metti il limite di spesa a 12 euro');
  // Abbassa una difesa (#530): vuole la parola «conferma» a ogni livello.
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).monthlyLimitEur, { timeout: 5_000 }).toBe(12);
  await opt.bringToFront();
  await expect(opt.locator('#monthlyLimit')).toHaveValue('12', { timeout: 3_000 });
  await opt.locator('#openWeightsOnly').check();
  await expect.poll(async () => (await impostazioni(app)).openWeightsOnly, { timeout: 5_000 }).toBe(true);
  expect((await impostazioni(app)).monthlyLimitEur, 'la pagina Modelli ha riscritto il limite di prima').toBe(12);
  await ripristina(app);
});

test('D — una voce avanzata delle Preferenze dalla chat: un valore del colore delle schede si legge e si cambia', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#tabcol-saturazione_tab')).toBeVisible({ timeout: 8_000 });

  await modelloFinto(app, [imposta('saturazione_tab', '0,4'), { text: 'Fatto.' }]);
  await scrivi(chat, 'abbassa la saturazione delle tab a 0,4');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).tabColor.saturazione_tab, { timeout: 5_000 }).toBe(0.4);
  const esito = (await app.evaluate(() => globalThis.__imp_tool)).pop();
  expect(esito).toMatch(/^Eseguita: Impostazione applicata: Colore delle tab, saturazione tab → 0,4\. .*«annulla»/);
  await prefs.bringToFront();
  await expect(prefs.locator('#tabcol-saturazione_tab')).toHaveValue('0.4', { timeout: 3_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'l2', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'saturazione' }) }] },
    { rispondiDa: 'colore delle tab, saturazione tab' },
  ]);
  await scrivi(chat, 'a quanto è la saturazione delle tab?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Adesso colore delle tab, saturazione tab: 0,4.' })).toBeVisible({ timeout: 10_000 });

  // Il ↺ di un token, chiesto a parole: torna al valore di serie, e la riga della pagina lo mostra.
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ themeTokens: { accent: '#cc2200', radius: '9px' } }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'e1', name: 'IMPOSTA_ESTETICA', arguments: JSON.stringify({ token: 'accent', valore: 'predefinito' }) }] },
    { text: 'Rimesso.' },
  ]);
  await scrivi(chat, 'rimetti il colore d\'accento di serie');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Rimesso.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).themeTokens, { timeout: 5_000 }).toEqual({ radius: '9px' });
  await ripristina(app);
});

test('E — chi scrive nella lista dei siti bloccati non perde l\'a capo quando la pagina si riallinea al proprio salvataggio', async ({ app, openTab }) => {
  const sec = await openTab('filo://security/security.html');
  const casella = sec.locator('#sec-siteblock-blacklist');
  await expect(casella).toHaveValue('', { timeout: 8_000 });
  await casella.click();
  await sec.keyboard.type('tiktok.com');
  await sec.keyboard.press('Enter');
  await expect.poll(async () => (await impostazioni(app)).security.siteBlock.blacklist, { timeout: 5_000 }).toEqual(['tiktok.com']);
  await sec.waitForTimeout(400);
  await expect(casella).toHaveValue('tiktok.com\n');
  await sec.keyboard.type('x.com');
  await expect.poll(async () => (await impostazioni(app)).security.siteBlock.blacklist, { timeout: 5_000 }).toEqual(['tiktok.com', 'x.com']);
  await expect(casella).toHaveValue('tiktok.com\nx.com');
});

// La pagina Altro rimanda tutta la casella a ogni salvataggio: senza riallinearsi toglieva il dominio della chat.
test('F — un dominio escluso aggiunto dalla chat compare nella pagina Altro aperta, e scriverci dopo non lo toglie', async ({ app, shell, openTab }) => {
  await livelloAutonomia(app, 'conservativo'); // il popup di un costo 2 si prova a Conservativo (#530)
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ blocklist: ['banca.it'] }));
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('banca.it', { timeout: 8_000 });

  await modelloFinto(app, [imposta('domini_esclusi', 'aggiungi esempio.org'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'non intervenire su esempio.org');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).blocklist, { timeout: 5_000 }).toEqual(['banca.it', 'esempio.org']);
  await altro.bringToFront();
  await expect(casella).toHaveValue('banca.it\nesempio.org', { timeout: 3_000 });
  await casella.click();
  await altro.keyboard.press('Control+End');
  await altro.keyboard.type('\nposta.it');
  await expect.poll(async () => (await impostazioni(app)).blocklist, { timeout: 5_000 }).toEqual(['banca.it', 'esempio.org', 'posta.it']);
  await ripristina(app);
});

// Annullare un cambio a un elenco toglie solo i siti di quel cambio: rimettere l'elenco intero perdeva b.it.
test('G — annullare «blocca a.it» dal segno lascia bloccato b.it, aggiunto dopo', async ({ app, shell }) => {
  await livelloAutonomia(app, 'conservativo'); // il popup di un costo 2 si prova a Conservativo (#530)
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const blacklist = async () => (await impostazioni(app)).security.siteBlock.blacklist;

  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi a.it'), { text: 'Bloccato a.it.' }]);
  await scrivi(chat, 'blocca a.it');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(blacklist, { timeout: 5_000 }).toEqual(['a.it']);
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Bloccato a.it.' })).toBeVisible({ timeout: 10_000 });

  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi b.it', 'i2'), { text: 'Bloccato b.it.' }]);
  await scrivi(chat, 'blocca b.it');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(blacklist, { timeout: 5_000 }).toEqual(['a.it', 'b.it']);
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Bloccato b.it.' })).toBeVisible({ timeout: 10_000 });

  const bolla = chat.locator('.dash-bubble-user', { hasText: 'blocca a.it' });
  await bolla.locator('.dash-cambi-segno').hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('aggiunto a.it');
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(blacklist, { timeout: 5_000 }).toEqual(['b.it']);
  await ripristina(app);
});

test('H — un valore che non si applica non chiede un OK a vuoto, e il perché lo legge l\'utente coi nomi della pagina', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  // Un sì/no a una voce con tre stati: nessun riquadro, la riga dice perché, il modello riceve i valori ammessi.
  await modelloFinto(app, [imposta('fingerprint', false), { text: 'Ecco.' }]);
  await scrivi(chat, 'spegni l\'anti-fingerprinting');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 10_000 });
  expect(await confirmState(chat)).toBeNull();
  expect((await impostazioni(app)).security.fingerprint.mode).toBe('default');
  expect((await app.evaluate(() => globalThis.__imp_tool)).pop()).toMatch(/Valori ammessi per fingerprint: "off"/);

  // Un nome vago: il diario parla all'utente coi nomi delle voci, le chiavi vanno solo al modello.
  await modelloFinto(app, [imposta('pubblicità', false, 'i2'), { text: 'Quale?' }]);
  await scrivi(chat, 'spegni la pubblicità');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Quale?' })).toBeVisible({ timeout: 10_000 });
  await chat.locator('.dash-activity-head').last().click();
  const riga = chat.locator('.dash-activity').last();
  await expect(riga).toContainText('Impostazione non applicata · «pubblicità» può voler dire più impostazioni: «salta le pubblicità dei video», «blocco di pubblicità e tracker»');
  expect(await riga.innerText()).not.toMatch(/salta_pubblicita|chiave esatta/);
  const esito = (await app.evaluate(() => globalThis.__imp_tool)).pop();
  expect(esito).toContain('salta_pubblicita, blocco_pubblicita');
  expect(esito).not.toContain('stia nel limite');
  await ripristina(app);
});
