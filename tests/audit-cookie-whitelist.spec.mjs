import { test, expect } from './fixtures/electron.mjs';

// AUDIT: la whitelist "Siti fidati" della pagina Sicurezza accetta solo domini
// validi (regex con TLD). Se l'utente inserisce un valore che cleanDomain
// rifiuta (es. "localhost", o un nome senza punto), il campo viene SVUOTATO
// in silenzio senza alcun messaggio: l'utente crede di aver aggiunto il sito.
test('cookie whitelist: invalid domain is silently dropped with no feedback', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#cookie-wl-input');

  // Attiva la modalità privacy (è l'unica in cui la whitelist è abilitata).
  await page.click('input[name="cookie-mode"][value="privacy"]');
  await expect(page.locator('#cookie-wl-input')).toBeEnabled();

  // 1) Dominio VALIDO → viene aggiunto e mostrato in lista.
  await page.fill('#cookie-wl-input', 'example.com');
  await page.click('#cookie-wl-add-btn');
  await expect(page.locator('#cookie-wl-list')).toContainText('example.com');

  // 2) Dominio NON valido ("localhost", senza TLD) → cleanDomain lo rifiuta.
  await page.fill('#cookie-wl-input', 'localhost');
  await page.click('#cookie-wl-add-btn');

  // Il campo viene svuotato (prova che il click ha "consumato" l'input)...
  await expect(page.locator('#cookie-wl-input')).toHaveValue('');
  // ...ma "localhost" NON è in lista e NON c'è nessun avviso/errore visibile.
  await expect(page.locator('#cookie-wl-list')).not.toContainText('localhost');

  await page.screenshot({ path: 'tests/.shots/audit-cookie-whitelist.png' });

  // Asserto il SINTOMO: nessun elemento di errore/avviso presente accanto al campo.
  // (se in futuro si aggiunge un messaggio di errore, questo test va aggiornato)
  const hasErrorMsg = await page.evaluate(() => {
    const input = document.getElementById('cookie-wl-input');
    const wrap = input?.closest('.sn-card, section, fieldset, div');
    const txt = (wrap?.textContent || '').toLowerCase();
    return /non valido|invalido|errore|formato|inserisci un dominio/.test(txt);
  });
  expect(hasErrorMsg).toBe(false); // conferma: rifiuto SILENZIOSO, nessun feedback
});
