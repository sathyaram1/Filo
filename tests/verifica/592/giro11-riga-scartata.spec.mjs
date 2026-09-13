// Verifica #592, giro 11 — quello che scrivi nelle Opzioni e che Filo non
// salva sparisce dallo schermo, insieme alla spiegazione.
//
// È la porta che il giro 3 aveva già trovato e chiuso: «quello che hai scritto
// e che la pagina ha rifiutato di salvare sparisce appena cambia
// un'impostazione qualunque, e sparisce insieme al messaggio che ti spiegava
// perché». La correzione dei giri dopo ha tolto alla pagina il momento di
// sordità che aveva dopo ogni salvataggio, e adesso la pagina si rilegge subito
// dopo aver salvato lei. Così cancella i segni che aveva appena messo.
//
// Due casi, uno peggiore dell'altro:
//   • riga senza soprannome: resta scritta, ma perde l'evidenziazione e la
//     riga di spiegazione. In fondo compare l'avviso che qualcosa è stato
//     scartato, senza dire quale riga;
//   • riga con un soprannome già usato: sparisce del tutto, con dentro quello
//     che avevi scritto.
//
// Le due prove permanenti che coprono questa cosa sono già nel repo
// (tests/options-model-registry-invalid-row.spec.mjs) e sono rosse su questo
// ramo e verdi su main: queste qui sotto descrivono il sintomo dal punto di
// vista di chi guarda la pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';

async function apriRegistro(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4000 });
}

test('una riga senza soprannome resta segnata e spiegata', async ({ openTab }) => {
  const page = await openTab(OPZIONI);
  await apriRegistro(page);

  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = '';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4000 });
  // Un momento per l'annuncio che rimbalza indietro dopo il salvataggio.
  await page.waitForTimeout(800);

  const stato = await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    return {
      testo: row?.querySelector('.sn-model-id')?.value || '',
      segnata: !!row?.classList.contains('sn-row-invalid'),
      spiegazione: row?.querySelector('.sn-model-row-msg')?.textContent || '',
    };
  });
  expect(stato.testo, 'quello che hai scritto è sparito').toBe('openai/gpt-4o-mini');
  expect(stato.segnata, 'la riga scartata non è più evidenziata: l\'avviso in fondo dice che qualcosa non è stato salvato, ma non quale riga').toBe(true);
  expect(stato.spiegazione.length, 'la spiegazione accanto alla riga è sparita').toBeGreaterThan(0);
});

test('una riga con un soprannome già usato resta sullo schermo', async ({ openTab }) => {
  const page = await openTab(OPZIONI);
  await apriRegistro(page);

  await page.evaluate(() => {
    const list = document.getElementById('modelRegistryList');
    const prima = list.querySelector('.sn-model-row:not(.sn-model-row-head)');
    prima.querySelector('.sn-model-nick').value = 'veloce';
    prima.querySelector('.sn-model-provider').value = 'openrouter';
    prima.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';

    document.getElementById('addModelRow').click();
    const righe = [...list.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')];
    const seconda = righe[righe.length - 1];
    seconda.querySelector('.sn-model-nick').value = 'veloce';
    seconda.querySelector('.sn-model-provider').value = 'gemini';
    seconda.querySelector('.sn-model-id').value = 'gemini-2.0-flash';
    seconda.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4000 });
  await page.waitForTimeout(800);

  const seconda = await page.evaluate(() => {
    const righe = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    const r = righe.find((x) => x.querySelector('.sn-model-id')?.value === 'gemini-2.0-flash');
    return r ? { segnata: r.classList.contains('sn-row-invalid') } : null;
  });
  expect(seconda, 'la riga scartata è sparita dallo schermo con dentro quello che avevi scritto').not.toBeNull();
  expect(seconda.segnata, 'la riga scartata non è evidenziata').toBe(true);
});
