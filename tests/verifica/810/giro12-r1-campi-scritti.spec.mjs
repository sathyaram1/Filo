// Verifica #810, giro 12, rilievo 1: la password e il numero di carta che l'utente scrive in un modulo non sono
// segreti letti da fuori, e Filo non deve scriverli nel suo file dei segreti letti.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto } from './aiuti.mjs';

// Il file dei segreti letti come lo legge Filo: in chiaro dove il sistema non cifra, decifrato altrove.
async function fileDeiLetti(app) {
  const file = join(await app.evaluate(({ app: a }) => a.getPath('userData')), 'segreti-letti.bin');
  // Il registro si salva poco dopo la lettura.
  await new Promise((r) => setTimeout(r, 1500));
  const salvato = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  if (!salvato.length || salvato.subarray(0, 1).toString() === '[') return salvato.toString('utf8');
  return app.evaluate(({ safeStorage }, b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')), salvato.toString('base64'));
}

const CASI = [
  {
    nome: 'la password scritta nel modulo di accesso',
    campo: '<label for="c">Password:</label> <input id="c" type="password">',
    valore: 'Gatto.Rosso.77',
    salvato: 'Gatto.Rosso.77',
  },
  {
    nome: 'il numero di carta scritto nel modulo di pagamento',
    campo: '<input id="c" autocomplete="cc-number" placeholder="1234 1234 1234 1234">',
    valore: '4111 1111 1111 1111',
    salvato: '4111111111111111',
  },
];

for (const caso of CASI) {
  test(`${caso.nome} non finisce fra i segreti letti salvati su disco`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Modulo</title></head>
      <body><h1>Area clienti</h1><form><div>${caso.campo}</div><button type="button">Avanti</button></form></body></html>`);
    await page.fill('#c', caso.valore);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['', JSON.stringify({ text: 'Premi «Avanti».', status: 'done' })]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire');
    await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Avanti».' })).toBeVisible({ timeout: 20_000 });
    expect(await fileDeiLetti(app), 'ciò che l’utente ha scritto è salvato fra i segreti letti da fuori').not.toContain(caso.salvato);
  });
}
