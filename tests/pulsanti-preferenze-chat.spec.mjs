// #1619 — i pulsanti della pagina Preferenze si chiedono a Filo in chat: suona la suoneria, legge con una voce, rifà
// l'intervista, rimette tutte le impostazioni di serie. Rosse senza il lavoro: lo strumento non esisteva, e il modello
// poteva solo spiegare dove cliccare.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd, CONFIRM_HOST } from './helpers/confirm.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito') && !u.includes('accoglienza'));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Il modello finto: un giro per elemento; quello che torna dagli strumenti resta da guardare.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__pp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__pp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__pp_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__pp_restore?.(); } catch (_) {} });
const premi = (pulsante, text = '', extra = {}, id = 'p1') => ({
  text, toolCalls: [{ id, name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante, ...extra }) }],
});
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
// Il diario si apre in due passi: il nodo della risposta, poi il passo che contiene la riga.
async function rigaDelDiario(chat, testo) {
  const diario = chat.locator('.dash-activity').last();
  await expect(diario).toBeVisible({ timeout: 10_000 });
  const riga = diario.locator('.dash-activity-row', { hasText: testo });
  const apri = async (testa) => { if ((await testa.getAttribute('aria-expanded')) !== 'true') await testa.click(); };
  if (!(await riga.isVisible().catch(() => false))) {
    await apri(diario.locator('.dash-activity-head'));
    await apri(diario.locator('.dash-activity-seg', { hasText: testo }).locator('.dash-activity-seg-head'));
  }
  return riga;
}

test('«fammi sentire la suoneria carillon» la suona col volume salvato senza sceglierla; a volume zero lo dice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ timerRingtone: 'gentle', timerRingtoneVolume: 60 }));
  await shell.evaluate(() => {
    window.__suonati = [];
    window.SN_SOUNDS.play = (tono, volume) => { window.__suonati.push([tono, volume]); return true; };
  });

  await modelloFinto(app, [premi('prova_suoneria', 'Eccola.', { tono: 'carillon' })]);
  await scrivi(chat, 'fammi sentire la suoneria carillon');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Eccola.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => shell.evaluate(() => window.__suonati), { timeout: 5_000 }).toEqual([['chime', 60]]);
  await expect(await rigaDelDiario(chat, 'Suoneria di timer e sveglie · Carillon')).toBeVisible();
  expect((await impostazioni(app)).timerRingtone, 'una prova non sceglie la suoneria').toBe('gentle');
  await chat.screenshot({ path: 'tests/.shots/pulsanti-preferenze-suoneria.png' });

  // A volume zero non si sente niente: la riga e il modello lo sanno.
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ timerRingtoneVolume: 0 }));
  await modelloFinto(app, [premi('prova_suoneria', '', {}, 'p2'), { text: 'Il volume della suoneria è a zero.' }]);
  await scrivi(chat, 'fammi sentire la suoneria');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Il volume della suoneria è a zero.' })).toBeVisible({ timeout: 10_000 });
  expect((await app.evaluate(() => globalThis.__pp_tool)).join('\n')).toContain('il volume è a zero');
  await expect(await rigaDelDiario(chat, 'Suoneria di timer e sveglie · Delicata · volume a zero')).toBeVisible();
  await ripristina(app);
});

test('«fammi sentire la voce Nicola» la legge nella pagina della chat con quella voce, senza sceglierla', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(() => { globalThis.__filoTestTtsCanned = true; globalThis.__filoTestTtsChieste = []; });
  const frase = await app.evaluate(() => globalThis.SN_TTS_VOICES.FRASI_DI_PROVA.it);

  await modelloFinto(app, [premi('prova_voce', 'Ecco Nicola.', { voce: 'Nicola' })]);
  await scrivi(chat, 'fammi sentire la voce Nicola');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ecco Nicola.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__filoTestTtsChieste), { timeout: 8_000 })
    .toEqual([{ text: frase, voice: 'im_nicola' }]);
  await expect(await rigaDelDiario(chat, 'Voce della lettura · Nicola')).toBeVisible();
  expect((await impostazioni(app)).tts.modelVoice || '', 'una prova non sceglie la voce').toBe('');

  // Un nome che non è una voce si rifiuta col perché, e non si legge niente.
  await modelloFinto(app, [premi('prova_voce', '', { voce: 'x'.repeat(300) }, 'p2'), { text: 'Quel nome è troppo lungo.' }]);
  await scrivi(chat, 'prova questa voce');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Quel nome è troppo lungo.' })).toBeVisible({ timeout: 10_000 });
  expect((await app.evaluate(() => globalThis.__pp_tool)).join('\n')).toContain('300 caratteri');
  expect(await app.evaluate(() => globalThis.__filoTestTtsChieste.length)).toBe(1);
  await ripristina(app);
});

test('«rifai l\'intervista di benvenuto» la ricomincia in una home nuova, e la chat di adesso resta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const prima = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getOnboarding()).past?.length || 0);

  await modelloFinto(app, [premi('rifai_intervista', 'Ricominciamo da capo.')]);
  await scrivi(chat, 'rifai l\'intervista di benvenuto');
  const intervista = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && u.includes('accoglienza=1'), 15_000);
  await expect(intervista.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 15_000 });
  const stato = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.getOnboarding());
  expect(stato.done).toBe(false);
  expect((stato.past || []).length).toBeGreaterThanOrEqual(prima);
  await intervista.screenshot({ path: 'tests/.shots/pulsanti-preferenze-intervista.png' });
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ricominciamo da capo.' })).toBeVisible();
  await expect(await rigaDelDiario(chat, 'Intervista di benvenuto ricominciata')).toBeVisible();
  await ripristina(app);
});

test('«rimetti tutte le impostazioni di serie»: OK con l\'elenco, poi tutte di serie con le chiavi salve, e il segno le rimette', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark', notifications: { durationSec: 30 } }));
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect.poll(() => prefs.evaluate(() => document.querySelector('#notifDuration')?.value), { timeout: 8_000 }).toBe('30');

  await modelloFinto(app, [premi('ripristina_tutto', 'Ti chiedo conferma.'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });
  // Il popup elenca cosa cambia; finché non c'è l'OK non cambia niente.
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 5_000 }).toContain('tema: scuro');
  expect((await confirmState(chat)).text).toContain('durata delle notifiche: 30 s');
  expect((await impostazioni(app)).theme).toBe('dark');
  await chat.screenshot({ path: 'tests/.shots/pulsanti-preferenze-ripristino-conferma.png' });
  // Tocca anche i modelli scelti: vuole la parola «conferma».
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible();
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  const dopo = await impostazioni(app);
  expect(dopo.notifications.durationSec).toBe(5);
  expect(dopo.apiKeys.openrouter, 'le chiavi restano').toBe('k-test');
  // La pagina Preferenze aperta segue il ripristino.
  await prefs.bringToFront();
  await expect.poll(() => prefs.evaluate(() => document.querySelector('#notifDuration')?.value), { timeout: 5_000 }).toBe('5');

  // Il segno sulla bolla dice cosa è cambiato e lo rimette.
  await chat.bringToFront();
  const bolla = chat.locator('.dash-bubble-user', { hasText: 'rimetti tutte le impostazioni di serie' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('tema: scuro');
  await chat.screenshot({ path: 'tests/.shots/pulsanti-preferenze-ripristino-segno.png' });
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('dark');
  expect((await impostazioni(app)).notifications.durationSec).toBe(30);
  await ripristina(app);
});

test('il ripristino dalla pagina Preferenze si rimette com\'era dalla riga del cambio nella home, come dice il riquadro', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#resetAllSettings').click();
  await expect.poll(async () => (await confirmState(prefs))?.text || '', { timeout: 5_000 }).toContain('Si rimette com’era');
  await scrollConfirmToEnd(prefs);
  await clickConfirm(prefs, 'ok');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  await home.bringToFront();
  // Il ripristino è un cambio solo: la sua riga nomina i primi e conta gli altri.
  const riga = home.locator('.dash-cambio', { hasText: 'dalle Preferenze' }).last();
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await riga.locator('.dash-cambio-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('dark');
});
