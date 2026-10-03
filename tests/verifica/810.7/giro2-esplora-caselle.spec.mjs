// Verifica #810.7, giro 2: il numero di carta diviso in quattro caselle e il codice monouso diviso in sei, senza
// nome sul campo; il numero di carta con una cifra sbagliata in un campo che il sito non chiama «carta».

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, arrivato } from './aiuti.mjs';

const pagina = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form>${corpo}<button type="button">Paga</button></form></body></html>`;

test('carta in quattro caselle: le cifre non arrivano al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const caselle = [1, 2, 3, 4].map((i) => `<input id="k${i}" maxlength="4" inputmode="numeric" style="width:60px">`).join(' ');
  const page = await testServer.openReady(openTab, pagina(`<label for="k1">Numero della carta</label> ${caselle}`));
  await superaAvviso(page);
  const valori = ['5500', '0000', '0000', '0004'];
  for (let i = 0; i < 4; i++) await page.fill(`#k${i + 1}`, valori[i]);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  await chiedi(app, page, 'aiutami a pagare', 1);
  const testo = await arrivato(app, page);
  const righe = testo.split('\\n').filter((r) => /:: #k[1-4]/.test(r));
  expect(righe.length).toBe(4);
  expect(righe.join('\n'), 'le cifre della carta sono arrivate al modello').not.toMatch(/5500|0004/);
});

test('codice monouso in sei caselle: le cifre non arrivano al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const caselle = [1, 2, 3, 4, 5, 6].map((i) => `<input id="o${i}" maxlength="1" inputmode="numeric" style="width:24px"${i === 1 ? ' autocomplete="one-time-code"' : ''}>`).join('');
  const page = await testServer.openReady(openTab, pagina(`<p>Inserisci il codice che ti abbiamo mandato</p>${caselle}`));
  await superaAvviso(page);
  const valori = ['7', '3', '9', '1', '4', '6'];
  for (let i = 0; i < 6; i++) await page.fill(`#o${i + 1}`, valori[i]);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  await chiedi(app, page, 'aiutami a entrare', 1);
  const testo = await arrivato(app, page);
  const righe = testo.split('\\n').filter((r) => /:: #o[1-6]/.test(r));
  expect(righe.length).toBe(6);
  const cifre = righe.map((r) => (r.match(/input \\"(\d)\\"/) || [])[1] || '').join('');
  expect(cifre, 'le cifre del codice sono arrivate al modello').not.toBe('739146');
});

test('carta con una cifra sbagliata in un campo chiamato «number»: non arriva al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<div>Numero della carta</div><input id="c" name="number" style="width:280px">'));
  await superaAvviso(page);
  await page.fill('#c', '4111 1111 1111 1112');
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  await chiedi(app, page, 'il sito dice che la carta non è valida', 1);
  expect(await arrivato(app, page), 'il numero di carta è arrivato al modello').not.toContain('4111 1111 1111 1112');
});
