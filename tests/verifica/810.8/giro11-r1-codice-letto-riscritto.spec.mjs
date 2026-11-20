// Verifica #810.8 giro 11: un codice letto da una pagina resta letto quando l'utente lo riscrive in un campo cominciato
// prima della lettura, o quando l'assistente propone di metterlo in un campo (la porta del giro 6, ancora aperta).
import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, POSTA, modelli, apriAiuto, chiedi, letti, dopoUnRiavvio } from './aiuti.mjs';

test('r1 il codice letto resta letto quando l’assistente propone di metterlo nella risposta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, POSTA);
  await modelli(app, {
    aiuto: [
      ['scritto io', JSON.stringify({ text: 'Ti preparo la risposta.', status: 'done', highlight: { selector: '#risposta', action: 'fill', value: `Il codice è ${CODICE}`, note: 'Risposta' } })],
      ['', '{"text":"Ecco.","status":"done"}'],
    ],
  });
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'cosa mi chiede Marco?');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain(CODICE);
  await chiedi(aiuto, `rispondi a Marco che il codice è ${CODICE}, l’ho scritto io`, 'Ti preparo la risposta.');
  await expect(aiuto.locator('.sn-highlight-value')).toContainText(CODICE, { timeout: 20_000 });
  await page.waitForTimeout(800);
  expect(await dopoUnRiavvio(app), 'il codice letto è sparito dal registro').toContain(CODICE);
});

test('r1 il codice letto resta letto quando l’utente lo scrive in fondo a una nota cominciata prima', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const nota = await testServer.openReady(openTab, `<!doctype html><html><head><title>Note</title></head><body><h1>Note</h1>
    <textarea id="n" style="width:500px;height:120px"></textarea></body></html>`);
  await nota.locator('#n').click();
  await nota.keyboard.type('Promemoria per domani: ', { delay: 10 });
  await nota.waitForTimeout(600);
  const banca = await testServer.openReady(openTab, POSTA, { pubblico: true });
  await modelli(app);
  const aiuto = await apriAiuto(app, shell, banca);
  await chiedi(aiuto, 'cosa mi chiede Marco?');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain(CODICE);
  const id = await shell.evaluate(async () => ((await window.filoShell.tabs.snapshot()).tabs || []).find((t) => /Note/.test(t.title || ''))?.id);
  if (id) await shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
  await nota.locator('#n').click();
  await nota.keyboard.press('End');
  await nota.keyboard.type(`codice ${CODICE}`, { delay: 20 });
  await nota.waitForTimeout(1000);
  expect(await dopoUnRiavvio(app), 'il codice letto è sparito dal registro').toContain(CODICE);
});
