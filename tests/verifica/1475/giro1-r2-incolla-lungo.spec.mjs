// Verifica #1475, giro 1, rilievo 2: incollare un testo lungo (1.500 righe, circa 130.000 caratteri) nell'editor
// non deve bloccare la pagina: il testo intero è nel documento in pochi secondi.
import { test, expect } from '../../fixtures/electron.mjs';

const RIGHE = 1500;

test('r2 un testo di 1.500 righe incollato entra intero in pochi secondi', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.evaluate((n) => {
    const d = document.getElementById('doc');
    d.focus();
    const testo = Array.from({ length: n }, (_, i) => `Riga ${i}: si discute di ferie, turni e di una caldaia che perde nel locale tecnico.`).join('\n');
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    window.__incollaInizio = performance.now();
    // Fuori da evaluate: se l'incolla blocca la pagina, il cronometro lo misura la prova, non il timeout di evaluate.
    setTimeout(() => {
      d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      window.__incollaFine = performance.now();
    }, 0);
  }, RIGHE);
  const t0 = Date.now();
  await expect.poll(() => editor.evaluate(() => window.__incollaFine != null), { timeout: 200_000, intervals: [500] }).toBe(true);
  const ms = Date.now() - t0;
  expect(await editor.evaluate((n) => document.getElementById('doc').innerText.includes(`Riga ${n - 1}:`), RIGHE)).toBe(true);
  expect(ms, `l'incolla ha bloccato la pagina per ${Math.round(ms / 1000)} secondi`).toBeLessThan(5_000);
});
