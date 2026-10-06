// Verifica locale «lavori locali», giro 2, rilievo 2: i lavori locali passati non stanno nella bacheca pubblica.
// Lavoro locale = feedback col ramo claude/<x> che main ha fuso con «finish: claude/<x> via server» (la strada locale).
// Firestore VERO in sola lettura, token dell'owner (senza si salta). Non apre Filo.
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

test('nessun lavoro locale già fuso ha una scheda nella bacheca pubblica', async () => {
  test.setTimeout(120_000);
  const { findAdminRefreshToken, acquireBearer, FIRESTORE_BASE } = await imp('scripts/lib/firestore-auth.mjs');
  test.skip(!findAdminRefreshToken(), 'serve il token dell’owner di questa macchina');
  const log = execFileSync('git', ['log', 'origin/main', '--format=%s'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const fusiInLocale = new Set([...log.matchAll(/^finish: (claude\/\S+) via server/gm)].map((m) => m[1]));
  const bearer = await acquireBearer();
  const fb = await tutti(FIRESTORE_BASE, 'feedback', ['branch', 'seq', 'subSeq'], { Authorization: `Bearer ${bearer}` });
  const locali = fb.filter((d) => fusiInLocale.has(d.fields?.branch?.stringValue || ''));
  expect(locali.length, 'ci sono feedback di lavori locali da controllare').toBeGreaterThan(0);
  const schede = new Set((await tutti(FIRESTORE_BASE, 'feedback-public', ['seq'])).map((d) => d.name.split('/').pop()));
  const inBacheca = locali
    .filter((d) => schede.has(d.name.split('/').pop()))
    .map((d) => `#${d.fields?.seq?.integerValue}${Number(d.fields?.subSeq?.integerValue) ? `.${d.fields.subSeq.integerValue}` : ''} (${d.fields.branch.stringValue})`);
  expect(inBacheca, 'lavori locali ancora nella bacheca pubblica').toEqual([]);
});
