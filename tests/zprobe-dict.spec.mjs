import { test, expect } from './fixtures/electron.mjs';

test('il dizionario personale raggiunge il correttore nativo?', async ({ app, openTab, testServer }) => {
  const langs = await app.evaluate(async ({ session }) => {
    const ses = session.defaultSession;
    return {
      available: (ses.availableSpellCheckerLanguages || []).slice(0, 10),
      current: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : null,
      enabled: ses.isSpellCheckerEnabled ? ses.isSpellCheckerEnabled() : null,
      custom: ses.listWordsInSpellCheckerDictionary ? await ses.listWordsInSpellCheckerDictionary() : null,
    };
  });
  console.log('LANGS', JSON.stringify(langs));

  const page = await testServer.openReady(openTab, `
    <!doctype html><meta charset="utf-8">
    <body style="font:16px system-ui;padding:20px">
      <textarea id="t" style="width:500px;height:120px;font-size:18px">Questa e una frase con la parola sbagliatissssima dentro.</textarea>
    </body>`);

  // Aggiunge la parola al dizionario personale via l'API del content script
  // (stessa strada del menu tasto destro "Aggiungi al dizionario").
  await page.evaluate(async () => {
    await window.SN_SPELLCHECK.addToDictionary('sbagliatissssima');
  });
  await page.waitForTimeout(500);

  const stored = await page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_personal_dict');
    return d.sn_personal_dict;
  });
  console.log('DICT STORAGE', JSON.stringify(stored));

  const after = await app.evaluate(async ({ session }) => {
    const ses = session.defaultSession;
    return ses.listWordsInSpellCheckerDictionary ? await ses.listWordsInSpellCheckerDictionary() : null;
  });
  console.log('NATIVE CUSTOM DICT AFTER', JSON.stringify(after));
});
