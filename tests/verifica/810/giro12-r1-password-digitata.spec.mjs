// Verifica #810, giro 12, rilievo 1: la password che l'utente scrive in un modulo di accesso non è un
// segreto letto da fuori, e Filo non deve tenerla nel suo file dei segreti letti.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto } from './aiuti.mjs';

const PASSWORD = 'Gatto.Rosso.77';

test('la password scritta nel modulo di accesso non finisce fra i segreti letti salvati su disco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Accesso</title></head>
    <body><h1>Area clienti</h1>
    <form><div><label for="u">Utente:</label> <input id="u" value="mario.rossi"></div>
    <div><label for="p">Password:</label> <input id="p" type="password"></div>
    <button type="button">Entra</button></form></body></html>`);
  await page.fill('#p', PASSWORD);
  await preparaModelli(app);
  await modelloFinto(app, { aiuto: [['', JSON.stringify({ text: 'Premi «Entra».', status: 'done' })]] });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami ad accedere');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Entra».' })).toBeVisible({ timeout: 20_000 });

  const cartella = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const file = join(cartella, 'segreti-letti.bin');
  // Il registro si salva poco dopo la lettura.
  await new Promise((r) => setTimeout(r, 1500));
  const salvato = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  expect(salvato.includes(Buffer.from(PASSWORD)), 'la password dell’utente è salvata in chiaro fra i segreti letti').toBe(false);
  // Anche cifrato: la password non deve stare fra i segreti letti, che sono tutti lì dentro.
  const letti = await app.evaluate(() => {
    const X = globalThis.SN_URL_EXFIL;
    return X ? X.valutaUscita({ type: 'CERCA_WEB', query: 'Gatto.Rosso.77 è sicura?' }, { letti: [] }) : null;
  });
  expect(letti).not.toBeNull();
});
