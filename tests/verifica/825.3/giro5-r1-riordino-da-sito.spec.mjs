// Giro 5: il riordino delle schede (che chiama il modello) si lancia da un sito, senza conferma.
import { test, expect } from '../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina', tab: { id: 1, url: 'https://evil.example/pagina' } };

test('un sito non lancia il riordino delle schede, né con la conferma forgiata né diretto', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async ({ BrowserWindow }, sito) => {
    globalThis.__triage = 0;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) w._filoTabs.runAutoTriage = async () => { globalThis.__triage += 1; return { archived: 3 }; };
    }
    const MSG = globalThis.SN_MSG.MSG;
    const conferma = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.FILO_CONFIRM_ACTION, action: { type: 'PULISCI_TAB' } }, sito);
    const diretto = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.RUN_TAB_TRIAGE }, sito);
    return { conferma, diretto, triage: globalThis.__triage };
  }, SITO);
  expect(out.conferma.executed, 'la conferma a freddo da un sito ha eseguito il riordino').not.toBe(true);
  expect(out.diretto.ok, 'il riordino diretto da un sito è partito').not.toBe(true);
  expect(out.triage).toBe(0);
});
