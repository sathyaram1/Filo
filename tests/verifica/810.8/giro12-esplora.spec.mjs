// Verifica #810.8 giro 12, esplorazione: strade nuove per cui un valore dell'utente arriva in un campo.
import { test, expect } from '../../fixtures/electron.mjs';
import { CARTA, CODICE, POSTA, PAGAMENTO, compatta, modelli, oltreLAvviso, apriAiuto, chiedi, letti, dopoUnRiavvio } from './aiuti.mjs';

const campoCarta = '<label for="c">Numero della carta</label><input id="c" placeholder="1234 5678 9012 3456">';

test('carta scritta nel riquadro di pagamento di un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dentro = testServer.html(`<!doctype html><html><body>${campoCarta}</body></html>`);
  const page = await testServer.openReady(openTab, PAGAMENTO(`<iframe id="pay" src="${dentro}" style="width:520px;height:90px;border:0"></iframe>`), { pubblico: true });
  await modelli(app);
  const frame = page.frameLocator('#pay');
  await frame.locator('#c').click();
  await page.keyboard.type(CARTA, { delay: 20 });
  await expect(frame.locator('#c')).toHaveValue(CARTA);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'aiutami a finire il pagamento');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  const visti = await app.evaluate(() => JSON.stringify(globalThis.SN_SEGRETI_LETTI.tutti()));
  console.log('letti', visti);
  expect(await dopoUnRiavvio(app)).not.toContain(compatta(CARTA));
});

test('PIN scritto col tastierino della banca', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const tasti = [...'1234567890'].map((d) => `<button type="button" class="t">${d}</button>`).join('');
  const page = await testServer.openReady(openTab, PAGAMENTO(`<label for="pin">PIN dispositivo:</label><input id="pin" type="password" readonly>
    <div>${tasti}</div><script>document.querySelectorAll('.t').forEach((b) => b.addEventListener('click', () => { document.getElementById('pin').value += b.textContent; }));</script>`));
  await oltreLAvviso(app);
  await modelli(app);
  for (const d of '58392017') await page.locator('.t', { hasText: d }).click();
  await expect(page.locator('#pin')).toHaveValue('58392017');
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'aiutami a finire');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  const visti = await app.evaluate(() => JSON.stringify(globalThis.SN_SEGRETI_LETTI.tutti()));
  console.log('letti', visti);
  expect(await dopoUnRiavvio(app)).not.toContain('58392017');
});

test('carta rimessa con Ctrl+Y', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGAMENTO(campoCarta));
  await oltreLAvviso(app);
  await modelli(app);
  await page.locator('#c').click();
  await page.keyboard.type(CARTA, { delay: 20 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(300);
  console.log('dopo due annulla', await page.locator('#c').inputValue());
  await page.keyboard.press('Control+Y');
  await page.waitForTimeout(300);
  console.log('dopo ripeti', await page.locator('#c').inputValue());
  await expect(page.locator('#c')).toHaveValue(CARTA);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'aiutami a finire il pagamento');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  expect(await dopoUnRiavvio(app)).not.toContain(compatta(CARTA));
});

test('IBAN scritto in un campo senza nome: cosa vede il modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const IBAN = 'IT60X0542811101000000123456';
  const page = await testServer.openReady(openTab, PAGAMENTO('<div>Bonifico</div><input id="x" style="width:400px;font-size:18px">'));
  await oltreLAvviso(app);
  await modelli(app);
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const a = P.completeWithFallback, b = P.streamCompleteWithFallback;
    P.completeWithFallback = async (o) => { globalThis.__visti.push(o.messages); return a(o); };
    P.streamCompleteWithFallback = async (o) => { globalThis.__visti.push(o.messages); return b(o); };
  });
  await page.locator('#x').click();
  await page.keyboard.type(IBAN, { delay: 15 });
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'ho scritto giusto?');
  const visti = await app.evaluate(() => globalThis.__visti);
  const testo = JSON.stringify(visti);
  console.log('IBAN nel testo al modello:', testo.includes(IBAN));
  const fs = await import('node:fs');
  fs.mkdirSync('tests/.shots', { recursive: true });
  let n = 0;
  for (const m of visti.flat()) {
    for (const p of Array.isArray(m && m.content) ? m.content : []) {
      const u = p && (p.image_url?.url || p.url || '');
      if (typeof u === 'string' && u.startsWith('data:image')) {
        fs.writeFileSync(`tests/.shots/giro12-foto-${n++}.${u.slice(11, 15).replace(/;.*/, '')}`, Buffer.from(u.split(',')[1], 'base64'));
      }
    }
  }
  console.log('foto salvate', n);
  expect(await dopoUnRiavvio(app)).not.toContain(compatta(IBAN));
});

test('codice letto, proposto e accettato resta letto', async ({ app, shell, openTab, testServer }) => {
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
  await aiuto.locator('.sn-highlight-accept').click({ timeout: 20_000 });
  await expect(page.locator('#risposta')).toHaveValue(`Il codice è ${CODICE}`);
  await page.waitForTimeout(800);
  expect(await dopoUnRiavvio(app), 'il codice letto è sparito dal registro').toContain(CODICE);
});
