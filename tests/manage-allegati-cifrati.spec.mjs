// #1337: le caselle di risposta di Gestione caricano davvero (cifrato), solo la rete del deposito è finta; con la
// cifratura che si rompe a metà la frase nomina i file mancanti e quelli già attaccati (#602.1).
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function depositoFinto(page) {
  await page.evaluate(() => {
    const vera = window.fetch.bind(window);
    window.__caricati = [];
    window.fetch = async (url, init) => {
      if (/firebasestorage\.googleapis\.com/.test(String(url)) && init && init.method === 'POST') {
        window.__caricati.push(new Uint8Array(await init.body.arrayBuffer())[0]);
        return new Response(JSON.stringify({ downloadTokens: 'codice-finto' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return vera(url, init);
    };
  });
}

async function apriRombo(page) {
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.locator('.mg-item', { hasText: '#805' }).click();
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
}

test('risposta nella conversazione e alle Domande: una schermata e un log si allegano, cifrati', async ({ app, openTab }) => {
  const chiarire = { ...PRATICHE[1], notes: 'Domanda di Claude: quale colore?' };
  await mainFinto(app, { feedbacks: [PRATICHE[0], chiarire], riferimenti: RIFERIMENTI, domande: [domanda(52, { titolo: 'Colore del bordo' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await depositoFinto(page);
  await apriRombo(page);
  await page.locator('.mg-liv-risposta .mg-dq-file').setInputFiles([
    { name: 'schermata.png', mimeType: 'image/png', buffer: PNG },
    { name: 'server.log', mimeType: 'text/x-log', buffer: Buffer.from('errore 42') },
  ]);
  await expect(page.locator('.mg-liv-risposta .mg-dq-allegato')).toHaveText([/Immagine 1/, /server\.log/]);
  await expect(page.locator('#mgSideRispostaMsg')).toHaveText('');
  // Primo byte = versione del formato cifrato: nel deposito non sale niente in chiaro.
  expect(await page.evaluate(() => window.__caricati)).toEqual([1, 1]);

  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-52"]');
  await dq.locator('.mg-dq-file').setInputFiles([{ name: 'schermata.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(dq.locator('.mg-dq-allegato')).toHaveText([/Immagine 1/]);
});

test('risposta nella conversazione: con la cifratura rotta a metà la frase nomina i file mancanti e quello allegato', async ({ app, openTab }) => {
  const chiarire = { ...PRATICHE[1], notes: 'Domanda di Claude: quale colore?' };
  await mainFinto(app, { feedbacks: [PRATICHE[0], chiarire], riferimenti: RIFERIMENTI, domande: [] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await depositoFinto(page);
  await page.evaluate(() => {
    const vero = window.SN_FEEDBACK.uploadAttachment;
    let n = 0;
    window.SN_FEEDBACK.uploadAttachment = async (file, name) => {
      n += 1;
      if (n === 2) window.SN_FEEDBACK_CRYPTO.hasPublicKey = () => false;
      return vero(file, name);
    };
  });
  await apriRombo(page);
  await page.locator('.mg-liv-risposta .mg-dq-file').setInputFiles([
    { name: 'primo.png', mimeType: 'image/png', buffer: PNG },
    { name: 'secondo.png', mimeType: 'image/png', buffer: PNG },
    { name: 'log.txt', mimeType: 'text/plain', buffer: Buffer.from('errore 42') },
  ]);
  const msg = page.locator('#mgSideRispostaMsg');
  await expect(msg).toContainText('Non ho allegato «secondo.png» e «log.txt»: manca la chiave con cui si cifra.');
  await expect(msg).toContainText('«primo.png» invece è allegato.');
  await expect(msg).not.toContainText('Non ho mandato niente');
  await expect(page.locator('.mg-liv-risposta .mg-dq-allegato')).toHaveCount(1);
  await page.locator('.mg-liv-risposta').screenshot({ path: 'tests/.shots/manage-allegati-cifratura-meta.png' });
});
