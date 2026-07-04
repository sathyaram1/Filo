// Feedback #216: nelle Opzioni, aggiungere un modello personalizzato senza
// nickname (o con un nickname duplicato) faceva sparire la riga SENZA nessun
// avviso — anzi l'app mostrava "Salvato", quindi l'utente credeva che fosse
// tutto a posto. Riprodotto: Opzioni → disattiva "usa modelli predefiniti" →
// compila provider+stringa modello ma lascia il nickname vuoto → sposta il
// cursore → appare "Salvato" → dopo reload la riga non c'è più.
//
// Questi test asseriscono il COMPORTAMENTO corretto, non solo l'assenza
// dell'errore precedente:
//   1. Una riga con nickname vuoto ma provider/stringa compilati NON produce
//      una conferma "Salvato" indistinguibile da un salvataggio riuscito: la
//      riga viene evidenziata e la conferma segnala che qualcosa è stato
//      scartato. Senza il fix l'hint aveva solo la classe `sn-show` (nessun
//      indicatore d'allerta) e la riga non aveva alcun segno.
//   2. Una seconda riga con lo stesso nickname di una già presente viene
//      scartata con lo stesso avviso (non silenziosamente, non con un
//      duplicato invisibile nel registry).
//   3. Una riga valida (nickname compilato, non duplicato) continua a
//      salvare normalmente: la conferma resta "Salvato" senza avviso e la
//      riga non viene marcata come non valida.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealRegistry(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
}

test('riga senza nickname: evidenziata e NON confermata come salvataggio pulito', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealRegistry(page);

  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = ''; // nickname lasciato vuoto
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // La conferma NON deve sembrare un salvataggio pulito: deve portare
  // l'indicatore d'allerta (il fix), non solo `sn-show`.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4_000 });

  const rowState = await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    return {
      rowInvalid: row.classList.contains('sn-row-invalid'),
      nickInvalid: row.querySelector('.sn-model-nick').classList.contains('sn-input-invalid'),
      msg: row.querySelector('.sn-model-row-msg')?.textContent || '',
    };
  });
  expect(rowState.rowInvalid).toBe(true);
  expect(rowState.nickInvalid).toBe(true);
  expect(rowState.msg.length).toBeGreaterThan(0);

  // La riga non compare nel registry salvato: dopo reload non c'è traccia
  // dell'id inserito (comportamento invariato — quello che cambia è che ora
  // l'utente lo sa).
  await page.reload();
  await revealRegistry(page);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].map((i) => i.value));
  expect(ids).not.toContain('openai/gpt-4o-mini');
});

test('nickname duplicato: la seconda riga viene scartata con lo stesso avviso', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealRegistry(page);

  await page.evaluate(() => {
    const list = document.getElementById('modelRegistryList');
    const first = list.querySelector('.sn-model-row:not(.sn-model-row-head)');
    first.querySelector('.sn-model-nick').value = 'dup';
    first.querySelector('.sn-model-provider').value = 'openrouter';
    first.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';

    document.getElementById('addModelRow').click();
    const rows = [...list.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')];
    const second = rows[rows.length - 1];
    second.querySelector('.sn-model-nick').value = 'dup';
    second.querySelector('.sn-model-provider').value = 'gemini';
    second.querySelector('.sn-model-id').value = 'gemini-2.0-flash';
    second.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4_000 });

  const secondRowInvalid = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    const second = rows.find((r) => r.querySelector('.sn-model-id')?.value === 'gemini-2.0-flash');
    return second ? second.classList.contains('sn-row-invalid') : null;
  });
  expect(secondRowInvalid).toBe(true);

  // Il registry salvato tiene solo la prima definizione del nickname duplicato.
  await page.reload();
  await revealRegistry(page);
  const dupModel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    const row = rows.find((r) => r.querySelector('.sn-model-nick')?.value === 'dup');
    return row ? row.querySelector('.sn-model-id').value : null;
  });
  expect(dupModel).toBe('openai/gpt-4o-mini');
});

test('riga valida: la conferma resta "Salvato" senza avviso e senza segni sulla riga', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealRegistry(page);

  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'valida';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  await expect(page.locator('#savedHint')).not.toHaveClass(/sn-hint-warn/);

  const rowInvalid = await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    return row.classList.contains('sn-row-invalid');
  });
  expect(rowInvalid).toBe(false);
});
