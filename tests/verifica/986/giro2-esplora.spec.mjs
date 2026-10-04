// Verifica #986 giro 2, esplorazione: aspetto della sezione in tema chiaro e scuro, stretta, con tutti gli stati.
import { test, expect } from '../../fixtures/electron.mjs';

const BACHECA = 'filo://board/board.html';

test('aspetto: tutti gli stati, testo lungo, tema chiaro e scuro, finestra stretta', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    const base = Date.now();
    const lungo = 'Quando apro la pagina delle impostazioni e cerco di cambiare il colore del bordo delle schede non succede niente e '.repeat(4);
    await M.registra({ id: 'a', testo: 'Il tasto Salva non fa niente', creataIl: base - 1000, allegati: ['schermata annotata', 'log.txt'] });
    await M.registra({ id: 'b', testo: lungo, creataIl: base - 2000, stato: 'inviata', num: '990', titolo: 'Il colore del bordo delle schede non cambia mai, qualunque cosa scelga nelle impostazioni avanzate' });
    await M.registra({ id: 'c', testo: 'Non parte', creataIl: base - 3000 });
    await M.nonPartita('c');
    await M.registra({ id: 'd', feedbackId: 'd', testo: 'Lo zoom', creataIl: base - 4000, stato: 'inviata', num: '991' });
    await M.chiusa('d', { stato: 'risolta', num: '991', titolo: 'Lo zoom si resettava', risposta: 'Adesso lo zoom resta per sito anche dopo il riavvio.' });
    await M.registra({ id: 'e', feedbackId: 'e', testo: 'Doppione', creataIl: base - 5000, stato: 'inviata', num: '992' });
    await M.chiusa('e', { stato: 'chiusa', num: '992', titolo: 'Doppione di un altro' });
  });
  const b = await openTab(`${BACHECA}#segnalazioni`);
  await expect(b.locator('#bdMie .bd-mia')).toHaveCount(5);
  await b.locator('#bdMie .bd-mia').nth(3).locator('.bd-mia-testa').click();
  await b.locator('#bdMie .bd-mia').nth(1).locator('.bd-mia-testa').click();
  for (const tema of ['light', 'dark']) {
    await b.emulateMedia({ colorScheme: tema });
    await b.waitForTimeout(300);
    await b.screenshot({ path: `tests/.shots/986-g2-${tema}.png`, fullPage: true });
  }
  await b.setViewportSize({ width: 420, height: 900 }).catch(() => {});
  await b.waitForTimeout(300);
  await b.screenshot({ path: 'tests/.shots/986-g2-stretta.png', fullPage: true });
  await b.locator('#bdMie .bd-mia').first().locator('.bd-mia-togli').click();
  await b.screenshot({ path: 'tests/.shots/986-g2-togli.png' });
});
