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

// Costruisce un partial dalla mappa reale caricata nel main (SN_PREF).
async function build(app, chiave, valore) {
  return app.evaluate(({}, [k, v]) => {
    const r = globalThis.SN_PREF.buildPreferencePartial(k, v);
    return r ? { partial: r.partial, label: r.label } : null;
  }, [chiave, valore]);
}

test('SN_PREF mappa il linguaggio naturale sulle preferenze giuste', async ({ app }) => {
  expect(await build(app, 'tema', 'scuro')).toMatchObject({ partial: { theme: 'dark' } });
  expect(await build(app, 'tema', 'chiaro')).toMatchObject({ partial: { theme: 'light' } });
  expect(await build(app, 'dimensione_testo', 'grande')).toMatchObject({ partial: { textScale: 1.1 } });
  expect(await build(app, 'dimensione del testo', '125%')).toMatchObject({ partial: { textScale: 1.25 } });
  expect(await build(app, 'modalita_terminale', 'attiva')).toMatchObject({ partial: { terminal: { enabled: true } } });
  expect(await build(app, 'commento_home', 'nascondi')).toMatchObject({ partial: { showHomeMessage: false } });
  expect(await build(app, 'ore_inattivita', '12 ore')).toMatchObject({ partial: { autoArchive: { idleHours: 12 } } });
  // Chiavi fuori whitelist (impostazioni sensibili) → niente: non scrivibili.
  expect(await build(app, 'apiKey', 'segreto')).toBeNull();
  expect(await build(app, 'provider', 'openrouter')).toBeNull();
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
