// Verifica locale «lavori locali», giro 4, rilievo 1: i lavori locali passati che portano il ramo solo nella
// conversazione (non nel campo) restano nella bacheca pubblica. Firestore VERO in sola lettura; la parte che
// decifra le conversazioni vuole token e chiave dell'owner di questa macchina, senza si salta. Non apre Filo.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

async function tutti(base, coll, campi, headers = {}) {
  const out = [];
  let tok = '';
  do {
    const q = campi.map((c) => `mask.fieldPaths=${c}`).join('&');
    const r = await fetch(`${base}/${coll}?pageSize=300&${q}${tok ? `&pageToken=${tok}` : ''}`, { headers });
    expect(r.ok).toBe(true);
    const j = await r.json();
    out.push(...(j.documents || []));
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}

const numero = (d) => `#${d.fields?.seq?.integerValue}${Number(d.fields?.subSeq?.integerValue) ? `.${d.fields.subSeq.integerValue}` : ''}`;

test('#507 e #714, lavori fusi in locale, non hanno una scheda nella bacheca pubblica', async () => {
  const { FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  const schede = await tutti(FIRESTORE_BASE, 'feedback-public', ['seq', 'subSeq']);
  const inBacheca = schede.map(numero).filter((n) => n === '#507' || n === '#714');
  expect(inBacheca, 'lavori locali ancora nella bacheca pubblica').toEqual([]);
});

test('nessun feedback tuo o di una sessione, chiuso, la cui conversazione nomina un ramo fuso in locale, sta nella bacheca', async () => {
  test.setTimeout(180_000);
  const { findAdminRefreshToken, acquireBearer, FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  const { decryptFeedbackFields } = await imp('scripts/lib/decrypt-feedback-fields.mjs');
  const log = execFileSync('git', ['log', 'origin/main', '--first-parent', '--format=%s'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const fusiInLocale = new Set([...log.matchAll(/^finish: (claude\/[^\s)]+) via server/gm)].map((m) => m[1]));
  const bearer = await acquireBearer();
  const schede = new Set((await tutti(FIRESTORE_BASE, 'feedback-public', ['seq'])).map((d) => d.name.split('/').pop()));
  const fb = await tutti(FIRESTORE_BASE, 'feedback', ['seq', 'subSeq', 'clientId', 'status', 'notes'], { Authorization: `Bearer ${bearer}` });
  const trovati = [];
  for (const d of fb) {
    if (!schede.has(d.name.split('/').pop())) continue;
    const dec = await decryptFeedbackFields({ clientId: d.fields?.clientId?.stringValue || '', status: d.fields?.status?.stringValue || '' });
    test.skip(/^FENC1:/.test(String(dec.status || '')), 'serve la chiave dei feedback di questa macchina');
    if (!/^(owner|local):/i.test(String(dec.clientId || ''))) continue;
    if (!['done', 'archived'].includes(String(dec.status || '').trim())) continue;
    const notes = String((await decryptFeedbackFields({ notes: d.fields?.notes?.stringValue || '' })).notes || '');
    const rami = [...notes.matchAll(/claude\/[A-Za-z0-9._-]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));
    const fusi = rami.filter((r) => fusiInLocale.has(r));
    if (fusi.length) trovati.push(`${numero(d)} (${[...new Set(fusi)].join(', ')})`);
  }
  expect(trovati, 'lavori locali chiusi ancora nella bacheca pubblica').toEqual([]);
});
