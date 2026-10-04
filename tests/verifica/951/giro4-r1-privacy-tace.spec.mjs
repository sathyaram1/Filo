// Verifica #951, giro 4: tre cose che Filo fa coi dati e che il documento sulla privacy non dice.
// Ogni prova passa se il codice smette di farla OPPURE se il documento la dice: la scelta resta a chi corregge.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const privacy = () => readFileSync(join(ROOT, 'transparency', 'privacy.md'), 'utf8');
const frasi = (t) => t.split(/(?<=[.!?])\s+|\n+/);

test('il nome di un file allegato a un feedback: cifrato, o il documento lo mette fra ciò che resta in chiaro', async () => {
  require(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
  require(join(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
  require(join(ROOT, 'src', 'shared', 'feedback.js'));
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  globalThis.SN_FEEDBACK_PUBKEY = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  globalThis.SN_FEEDBACK_ENC_ENABLED = true;
  const documenti = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('uploadType=media')) return { ok: true, status: 200, json: async () => ({ downloadTokens: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }), text: async () => '' };
    if (u.includes('/counters/')) return { ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: '5' } }, updateTime: '2026-09-01T00:00:00Z' }) };
    documenti.push(JSON.parse(opts.body || '{}'));
    return { ok: true, status: 200, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/DOC_1' }), text: async () => '' };
  };
  const NOME = 'estratto-conto-mario-rossi.pdf';
  try {
    await globalThis.SN_FEEDBACK.submit({
      text: 'non si apre',
      files: [{ name: NOME, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 x').toString('base64') }],
    });
  } finally { globalThis.fetch = prev; }
  const doc = documenti.find((d) => d && d.fields && d.fields.files);
  expect(doc, 'il documento del feedback doveva partire').toBeTruthy();
  const nomeInChiaro = JSON.stringify(doc.fields.files).includes(NOME);
  const loDice = frasi(privacy()).some((f) => /in chiaro/i.test(f) && /nom[ei] de(i|gli|l)? ?(file|allegat)/i.test(f));
  expect(!nomeInChiaro || loDice, 'il nome del file sale in chiaro e il documento non lo elenca fra ciò che resta in chiaro').toBe(true);
});

test('i segreti che Filo ha letto restano sul computer per giorni: il documento lo dice', async () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'segretiLetti.js'), 'utf8');
  const salvaSuDisco = /segreti-letti\.bin/.test(src) && /GIORNI_RICORDO\s*=\s*\d+/.test(src);
  const loDice = /IBAN|numeri? di carta|segreti (che )?(Filo )?(ha )?lett/i.test(privacy());
  expect(!salvaSuDisco || loDice, 'il registro dei segreti letti sta su disco e il documento non lo nomina').toBe(true);
});

test('il voto sulla bacheca è pubblico e porta il codice dell\'account: il documento lo dice', async () => {
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const blocco = regole.slice(regole.indexOf('match /feedback-public/{doc}'));
  const votoPubblicoPerAccount = /allow read: if true/.test(blocco.slice(0, 200)) && /votes\[request\.auth\.uid\]/.test(blocco);
  const loDice = frasi(privacy()).some((f) => /vot/i.test(f) && /(chiunque|pubblic)/i.test(f) && /(codice|account|identit)/i.test(f));
  expect(!votoPubblicoPerAccount || loDice, 'chi vota lascia in pubblico il codice del suo account, e il documento non lo dice').toBe(true);
});
