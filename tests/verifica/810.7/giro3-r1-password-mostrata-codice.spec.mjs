// Verifica #810.7, giro 3, rilievo 1: un segreto riconosciuto solo dal nome che gli dà il sito. La password resa
// visibile dal sito con l'etichetta non legata, e il codice monouso in un campo solo senza nome, arrivano al modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, arrivato } from './aiuti.mjs';

const pagina = (corpo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Accesso</h1>
  <form>${corpo}<button type="button">Entra</button></form></body></html>`;
const RISPOSTA = JSON.stringify({ text: 'Premi «Entra».', status: 'done' });

test('password resa visibile dal sito, etichetta non legata: non arriva al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<div>Password</div><input id="c" name="pass" type="password"> '
    + '<button type="button" id="occhio" onclick="c.type=\'text\'">Mostra</button>'));
  await superaAvviso(page);
  await page.fill('#c', 'Gatto.Rosso.77');
  await page.click('#occhio');
  await preparaModelli(app);
  await modelloFinto(app, RISPOSTA);
  await apriAiuto(shell, page);
  await chiedi(app, page, 'non riesco ad entrare', 1);
  expect(await arrivato(app, page), 'la password è arrivata al modello').not.toContain('Gatto.Rosso');
});

test('codice monouso in un campo solo senza nome: non arriva al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Inserisci il codice che ti abbiamo mandato via SMS</p>'
    + '<input id="c" maxlength="6" inputmode="numeric">'));
  await page.fill('#c', '739146');
  await preparaModelli(app);
  await modelloFinto(app, RISPOSTA);
  await apriAiuto(shell, page);
  await chiedi(app, page, 'non funziona', 1);
  expect(await arrivato(app, page), 'il codice è arrivato al modello').not.toContain('739146');
});
