// Feedback WgFpzTW2: "fai in modo che filo possa modificare le impostazioni in
// preferenze su richiesta." Quando l'utente chiede a Filo (chat) di cambiare una
// preferenza, Filo emette l'azione IMPOSTA_PREFERENZA che scrive DAVVERO la
// preferenza, sullo stesso insieme esposto dalla pagina Preferenze.
//
// Qui esercitiamo, nel processo reale dell'app: (1) la mappa linguaggio
// naturale → preferenza (SN_PREF, ciò che l'esecutore dell'azione usa), e (2) il
// round-trip completo fino allo storage e alla UI Preferenze. Gli assert
// verificano il SUCCESSO (la preferenza diventa quella richiesta), non l'assenza
// di un errore: senza il fix la mappa non esiste e tutto resta invariato.

import { test, expect } from './fixtures/electron.mjs';

// Al boot Filo apre una newtab (WebContentsView) subito dopo che la shell ha
// caricato (createMainWindow → did-finish-load → tabs.openTab). Quella
// navigazione può distruggere il contesto di esecuzione mentre la PRIMA
// app.evaluate è ancora in volo → "Execution context was destroyed". Gli altri
// test del file non lo vedono perché usano `openTab` (che risolve il fixture
// `shell` e lascia assestare il boot prima del primo evaluate); questo invece
// valuta subito. Aspettiamo quindi che la newtab iniziale sia comparsa e abbia
// finito di caricare. Nei test lo userData è una temp dir fresca: niente
// restore di sessione, la newtab viene sempre aperta.
async function waitForBoot(app) {
  const deadline = Date.now() + 10_000;
  let tab = null;
  while (Date.now() < deadline) {
    tab = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; }
      catch (_) { return false; }
    });
    if (tab) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
}

// app.evaluate resiliente: se la navigazione di boot distrugge comunque il
// contesto al primo colpo, riassesta e ritenta una volta sola (la nav di boot
// è one-shot, al secondo giro è finita). Non altera il risultato della
// valutazione, solo la robustezza contro la race d'avvio.
async function evalSafe(app, fn, arg) {
  try {
    return await app.evaluate(fn, arg);
  } catch (e) {
    if (!/Execution context was destroyed/.test(String(e && e.message))) throw e;
    await waitForBoot(app);
    return app.evaluate(fn, arg);
  }
}

// Costruisce un partial dalla mappa reale caricata nel main (SN_PREF).
async function build(app, chiave, valore) {
  return evalSafe(app, ({}, [k, v]) => {
    const r = globalThis.SN_PREF.buildPreferencePartial(k, v);
    return r ? { partial: r.partial, label: r.label, level: r.level } : null;
  }, [chiave, valore]);
}

test('SN_PREF mappa il linguaggio naturale sulle preferenze giuste', async ({ app }) => {
  await waitForBoot(app); // evita la race con la navigazione di boot
  expect(await build(app, 'tema', 'scuro')).toMatchObject({ partial: { theme: 'dark' } });
  expect(await build(app, 'tema', 'chiaro')).toMatchObject({ partial: { theme: 'light' } });
  expect(await build(app, 'dimensione_testo', 'grande')).toMatchObject({ partial: { textScale: 1.1 } });
  expect(await build(app, 'dimensione del testo', '125%')).toMatchObject({ partial: { textScale: 1.25 } });
  expect(await build(app, 'modalita_terminale', 'attiva')).toMatchObject({ partial: { terminal: { enabled: true } } });
  expect(await build(app, 'commento_home', 'nascondi')).toMatchObject({ partial: { showHomeMessage: false } });
  expect(await build(app, 'ore_inattivita', '12 ore')).toMatchObject({ partial: { autoArchive: { idleHours: 12 } } });
  // #146.5 — ora TUTTE le impostazioni sono scrivibili, comprese le sensibili
  // (sicurezza, modelli, provider, chiavi, costi): quelle a livello 2 portano
  // `level: 2` così il dispatch chiede conferma prima di applicarle.
  expect(await build(app, 'provider', 'gemini')).toMatchObject({ partial: { provider: 'openrouter' }, level: 2 });
  expect(await build(app, 'gestione_cookie', 'privacy')).toMatchObject({ partial: { security: { cookies: { mode: 'privacy' } } }, level: 2 });
  expect(await build(app, 'navigazione_sicura', 'disattiva')).toMatchObject({ partial: { security: { safeBrowse: { enabled: false } } }, level: 2 });
  expect(await build(app, 'limite_spesa', '12 euro')).toMatchObject({ partial: { monthlyLimitEur: 12 }, level: 2 });
  expect(await build(app, 'chiave_gemini', 'AIzaSEGRETO1234')).toMatchObject({ partial: { apiKeys: { gemini: 'AIzaSEGRETO1234' } }, level: 2 });
  expect(await build(app, 'correttore', 'off')).toMatchObject({ partial: { featureFlags: { spellcheck: false } }, level: 1 });
  // 'apiKey' generico resta ambiguo (quale provider?) → non scrivibile: serve
  // dire chiave_openrouter / chiave_gemini / chiave_tavily.
  expect(await build(app, 'apiKey', 'segreto')).toBeNull();
});

test('Applicando il partial di "tema scuro" la preferenza si persiste e la UI Preferenze la mostra', async ({ app, openTab }) => {
  // Stesso percorso dell'azione IMPOSTA_PREFERENZA: SN_PREF costruisce il
  // partial, lo storage lo fonde e lo persiste.
  await app.evaluate(async () => {
    const { partial } = globalThis.SN_PREF.buildPreferencePartial('tema', 'scuro');
    await globalThis.SN_STORAGE.updateSettings(partial);
  });
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });
  await expect(page.locator('#theme')).toHaveValue('dark');
});

test('Più preferenze: i campi annidati vicini sono preservati (deepMerge)', async ({ app, openTab }) => {
  // Prima la shell, poi attivazione terminale: la seconda scrittura NON deve
  // azzerare la shell scelta.
  const settings = await app.evaluate(async () => {
    const S = globalThis.SN_STORAGE;
    const P = globalThis.SN_PREF;
    await S.updateSettings(P.buildPreferencePartial('shell_terminale', 'bash').partial);
    await S.updateSettings(P.buildPreferencePartial('modalita_terminale', 'attiva').partial);
    return S.getSettings();
  });
  expect(settings.terminal.enabled).toBe(true);
  expect(settings.terminal.shell).toBe('bash');

  // E la UI Preferenze riflette entrambe.
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#terminalEnabled', { timeout: 8_000 });
  await expect(page.locator('#terminalEnabled')).toBeChecked();
  await expect(page.locator('#terminalShell')).toHaveValue('bash');
});
