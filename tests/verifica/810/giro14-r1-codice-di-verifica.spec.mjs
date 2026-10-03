// Giro 14, rilievo 1: i messaggi di verifica più comuni (Amazon, Google, WhatsApp, PayPal…) non dicono «monouso».
import { test, expect } from '../../fixtures/electron.mjs';
import {
  CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, esitoUscita, NAVIGA_COL_CODICE,
} from './aiuti.mjs';

const FORME = {
  'italiano semplice': `Il tuo codice di verifica è ${CODICE}. Non condividerlo con nessuno.`,
  'Amazon': `${CODICE} è il tuo codice di verifica Amazon. Non condividerlo con nessuno.`,
  'inglese': `Your verification code is ${CODICE}. Don't share it with anyone.`,
};

for (const [nome, frase] of Object.entries(FORME)) {
  test(`un codice di verifica nella forma ${nome}, letto dalla pagina, non esce`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Posta</title></head>
<body style="padding:40px;font:16px sans-serif"><p>${frase}</p></body></html>`);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    expect(await esitoUscita(app, page)).toBe('fermato');
  });
}
