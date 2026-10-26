// Verifica #1337 giro 5, rilievo 1: la risposta a una domanda in Gestione allega file con regole sue, non con la lista
// unica dei tipi: il selettore propone SVG e pagine web, e una cifratura rotta a metà dice che non è partito niente.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const giudici = (c) => ({ action: 'human_review', verdicts: [{ judge: 'a', class: c }, { judge: 'b', class: c }, { judge: 'c', class: c }] });
const ATTESA = { ...base, _id: 'fb-att', seq: 901, name: 'Colore del tema', status: 'design', statusReason: 'clarify', domandaId: 'D-7', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nCaldo o freddo?' };
const D7 = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'importante', titolo: '#901, chi ci lavora ha domande per te: Colore del tema', problema: 'Caldo o freddo?', creataIl: Date.now(), origine: { tipo: 'feedback', id: 'fb-att' },
  opzioni: [{ testo: 'Riprendi il lavoro con la tua risposta', pro: 'Riparte.', contro: '', azione: { tipo: 'riprendi', feedbackId: 'fb-att' } }], consiglio: { opzione: 0, perche: 'Riparte.' } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function apriDomanda(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [ATTESA]);
  await page.evaluate((ds) => window.__mgTest.setDomande(ds, { riferimenti: { 'fb-att': { num: '#901', priorita: 1, stato: 'design', motivo: 'clarify' } } }), [D7]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.locator('.mg-item', { hasText: 'Colore del tema' }).locator('.mg-domanda-badge').click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]');
  await expect(dq).toBeVisible();
  return dq;
}

test('r1 il selettore della risposta a una domanda propone solo i tipi che Filo accetta, .tsv compreso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const dq = await apriDomanda(page);
  const accept = await dq.locator('.mg-dq-file').getAttribute('accept');
  const lista = await page.evaluate(() => window.SN_FEEDBACK_ATTACH.ACCEPT);
  expect(accept.split(',')).not.toContain('image/*');
  expect(accept.split(',')).not.toContain('text/*');
  expect(accept).toBe(lista);
});

test('r1 la cifratura che si rompe al secondo file: la frase dice quale manca e che il primo è allegato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const dq = await apriDomanda(page);
  await page.evaluate(() => {
    let n = 0;
    window.SN_FEEDBACK.uploadAttachment = async (file, name) => {
      n += 1;
      if (n >= 2) {
        const e = new Error(window.SN_FEEDBACK.encryptionBlockedMessage('manca la chiave con cui si cifra'));
        e.cifratura = true;
        e.motivo = 'manca la chiave con cui si cifra';
        throw e;
      }
      return { kind: 'img', url: `https://firebasestorage.googleapis.com/v0/b/x/o/${n}`, name, type: file.type };
    };
  });
  await dq.locator('.mg-dq-file').setInputFiles([
    { name: 'prima.png', mimeType: 'image/png', buffer: PNG },
    { name: 'seconda.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(dq.locator('.mg-dq-allegato')).toHaveCount(1);
  const msg = dq.locator('.mg-dq-msg');
  await expect(msg).toContainText('seconda.png');
  await expect(msg).toContainText('prima.png');
  await expect(msg).not.toContainText('Non ho mandato niente');
});
