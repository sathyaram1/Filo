// Verifica #810.19 giro 1, strade provate e chiuse: la cronologia degli appunti di Filo, il prefisso del paese mostrato
// accanto al campo dell'IBAN, una proposta lunghissima dell'assistente in righe corte mai accettata.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriCronologia } from '../../helpers/cronologiaAppunti.mjs';
import { PAGAMENTO, preparaModelli, modelloFinto, oltreLAvviso, apriAiuto, scriviAllAiuto, lettiSalvati, chiediEGuarda } from './aiuti.mjs';

const PASSWORD = 'Zq7#mR42kLp';

test('l’IBAN scritto dopo il prefisso IT che il sito mostra accanto al campo non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGAMENTO('<label for="i">IBAN</label> <span class="pref">IT</span><input id="i">'));
  await oltreLAvviso(app);
  await preparaModelli(app);
  await modelloFinto(app);
  await page.locator('#i').click();
  await page.keyboard.type('60X0542811101000000123456');
  await expect(page.locator('#i')).toHaveValue('60X0542811101000000123456');
  const dopo = await chiediEGuarda(app, shell, page);
  expect(dopo.filter((x) => x.includes('60x0542811101000000123456')), 'l’IBAN è rimasto fra i segreti letti').toEqual([]);
});

test('la password incollata dalla cronologia degli appunti di Filo non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, testi) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const t of testi) {
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.PUSH_CLIPBOARD_ENTRY, entry: { type: 'text', text: t } }, { url: 'filo://security/security.html' });
    }
  }, [PASSWORD, 'una frase qualunque copiata dopo']);
  const page = await testServer.openReady(openTab, PAGAMENTO('<label for="p">Password:</label><input id="p" type="password">'));
  await oltreLAvviso(app);
  await preparaModelli(app);
  await modelloFinto(app);
  const { voci } = await apriCronologia(app, page, '#p');
  const voce = voci.find((v) => v.testo === PASSWORD);
  expect(voce, 'la password è nella cronologia').toBeTruthy();
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(page.locator('#p')).toHaveValue(PASSWORD);
  const dopo = await chiediEGuarda(app, shell, page);
  expect(dopo, 'la password incollata è rimasta fra i segreti letti').not.toContain(PASSWORD.toLowerCase());
});

test('centomila codici in righe corte proposti dall’assistente, senza Accetta, non coprono il codice letto dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  const righe = Array.from({ length: 100_000 }, (_, i) => String(100000 + i));
  const codice = '153829';
  const giochi = await testServer.openReady(openTab, '<!doctype html><html><head><title>Giochi</title></head><body><textarea id="risposta"></textarea></body></html>');
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Ti preparo le note.', status: 'done', highlight: { selector: '#risposta', action: 'fill', value: righe.join('\n'), note: 'Note' } }));
  const aiuto = await apriAiuto(app, shell, giochi);
  await scriviAllAiuto(aiuto, 'cosa scrivo nelle note?');
  await expect(aiuto.locator('.sn-highlight-value')).toContainText('100000', { timeout: 60_000 });
  await giochi.waitForTimeout(1000);
  const banca = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head><body>
    <p>Il tuo codice di recupero è ${codice}. Non darlo a nessuno.</p></body></html>`, { pubblico: true });
  await modelloFinto(app);
  const aiuto2 = await apriAiuto(app, shell, banca);
  await scriviAllAiuto(aiuto2, 'cosa devo fare?');
  await expect.poll(() => lettiSalvati(app), { timeout: 20_000 }).toContain(codice);
});
