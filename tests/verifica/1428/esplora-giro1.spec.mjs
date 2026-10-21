// Verifica #1428 giro 1: riaprire con una nota una pratica chiusa e fidata, da una sessione sporca. Il server finto
// toglie la fiducia con la regola condivisa della Gestione (solo su un fidato aperto): la riapertura deve riuscire.
import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SPORCO } from '../../helpers/bigliettoFinto.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 una pratica chiusa e fidata si riapre con la nota da una sessione sporca, e perde la fiducia', async () => {
  const of = await import(pathToFileURL(join(ROOT, 'scripts', 'owner-feedback.mjs')).href);
  const MR = globalThis.SN_MANAGE_REVIEW;
  const doc = {
    name: 'projects/p/databases/(default)/documents/feedback/f1',
    fields: {
      seq: { integerValue: '553' }, clientId: { stringValue: 'local:claude' }, senderProof: { stringValue: 'admin' },
      status: { stringValue: 'done' }, statusPublic: { stringValue: 'closed' }, notes: { stringValue: '' },
      fiducia: { stringValue: 'fidato' },
    },
  };
  const veri = { ...of.sessione };
  of.sessione.biglietto = async () => SPORCO;
  of.sessione.togliFiducia = async () => {
    const c = MR.fiduciaTogliCheck({ fiducia: doc.fields.fiducia.stringValue, statusPublic: doc.fields.statusPublic.stringValue });
    if (!c.ok) return { ok: false, motivo: c.motivo };
    doc.fields.fiducia = { stringValue: 'non_fidato' };
    return { ok: true };
  };
  const vero = globalThis.fetch;
  const cifra = globalThis.SN_FEEDBACK_ENC_ENABLED;
  globalThis.SN_FEEDBACK_ENC_ENABLED = false;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'PATCH') {
      Object.assign(doc.fields, JSON.parse(init.body).fields);
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  let r;
  try {
    r = await of.scrivi('f1', 'todo', 'Riaperta da finish su claude/x: manca la parte del server', { bearer: 'finto', avviso: () => {} });
  } finally {
    globalThis.fetch = vero;
    globalThis.SN_FEEDBACK_ENC_ENABLED = cifra;
    Object.assign(of.sessione, veri);
  }
  expect(r.motivo || '').toBe('');
  expect(r.ok).toBe(true);
  expect(doc.fields.status.stringValue).toBe('todo');
  expect(doc.fields.notes.stringValue).toMatch(/manca la parte del server/);
  expect(doc.fields.fiducia.stringValue).toBe('non_fidato');
});
