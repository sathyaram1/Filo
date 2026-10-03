// La password e i dati della carta che l'utente scrive in un modulo non partono verso il modello dell'assistente
// di pagina (#810.7): il campo arriva col suo nome, il valore resta nella pagina. Senza il fix è rossa: con
// l'etichetta legata al campo e nessun segnaposto, la descrizione degli elementi portava il valore in chiaro.

import { test, expect } from './fixtures/electron.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Risponde secondo l'ultimo messaggio dell'utente (`risposte`: [[parola, risposta]]); tutto ciò che arriva al
// modello resta in __visti.
async function modelloFinto(app, risposte) {
  await app.evaluate((_electron, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: scelta[1] };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, risposte);
}

async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

async function scriviAllAiuto(page, testo) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

// Tutto ciò che è arrivato al modello, senza l'indirizzo del server di prova (la porta potrebbe contenere le cifre).
async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('');
}

function rigaDelCampo(testo) {
  return (testo.split('\\n').find((r) => r.includes(':: #c')) || '').replace(/\\"/g, '"');
}

const modulo = (campo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Area clienti</h1>
  <form><div>${campo}</div><button type="button">Accedi</button></form></body></html>`;

const SEGRETI = [
  { nome: 'la password sotto l’etichetta «Password»', campo: '<label for="c">Password</label> <input id="c" type="password">', valore: 'Gatto.Rosso.77', etichetta: 'Password' },
  { nome: 'la password resa visibile dal sito', campo: '<label for="c">Password</label> <input id="c" type="text">', valore: 'Gatto.Rosso.77', etichetta: 'Password' },
  { nome: 'il numero di carta senza segnaposto', campo: '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" inputmode="numeric">', valore: '4111 1111 1111 1111', etichetta: 'Numero della carta' },
  { nome: 'il codice di sicurezza nella sua etichetta', campo: '<label>CVV <input id="c" inputmode="numeric"></label>', valore: '8264', etichetta: 'CVV' },
  { nome: 'un codice che il sito copre coi puntini', campo: '<label for="c">Codice</label> <input id="c" style="-webkit-text-security:disc">', valore: 'Zq7Kp2xW', etichetta: 'Codice' },
];

for (const caso of SEGRETI) {
  test(`${caso.nome}: al modello arriva il campo col suo nome, non quello che c'è scritto`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(caso.campo));
    await page.fill('#c', caso.valore);
    await preparaModelli(app);
    await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a entrare');
    await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });

    const testo = await arrivato(app, page);
    expect(testo, 'quello che l’utente ha scritto nel campo è arrivato al modello').not.toContain(caso.valore);
    expect(testo).not.toContain(caso.valore.replace(/\s/g, ''));
    expect(rigaDelCampo(testo), 'il modello deve sapere quale campo è').toContain(`"${caso.etichetta}`);
  });
}

test('un campo qualunque senza nome continua a farsi riconoscere da quello che c’è scritto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<input id="c">'));
  await page.fill('#c', 'biciclette rosse');
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a cercare');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });
  expect(rigaDelCampo(await arrivato(app, page))).toContain('"biciclette rosse"');
});

test('il clic sul campo della password indicato dall’assistente lo racconta col nome del campo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Password</label> <input id="c" type="password">'));
  await page.fill('#c', 'Gatto.Rosso.77');
  await preparaModelli(app);
  await modelloFinto(app, [
    ['cliccato', JSON.stringify({ text: 'Ora premi «Accedi».', status: 'done' })],
    ['', JSON.stringify({ text: 'Controlla la password.', highlight: { selector: '#c', action: 'click', note: 'qui' }, status: 'continue' })],
  ]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a entrare');
  await expect(page.locator('.sn-sidebar', { hasText: 'Controlla la password.' })).toBeVisible({ timeout: 20_000 });
  await page.click('#c');
  await expect(page.locator('.sn-sidebar', { hasText: 'Ora premi «Accedi».' })).toBeVisible({ timeout: 20_000 });

  await expect(page.locator('.sn-sidebar-log', { hasText: 'click su Password' })).toBeVisible();
  await expect(page.locator('.sn-sidebar')).not.toContainText('Gatto.Rosso.77');
  expect(await arrivato(app, page)).not.toContain('Gatto.Rosso.77');
});
