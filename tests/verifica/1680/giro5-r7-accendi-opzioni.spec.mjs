// #1680 giro 5, rilievo 7: le opzioni di `manutentore accendi` non diventano numeri dell'ordine.

import { test, expect } from '@playwright/test';
import { main } from '../../../scripts/manutentore.mjs';

test('r7 accendi 812 --giorni 30 non mette #30 nell\'ordine', async () => {
  const scritti = [];
  const fetchVero = globalThis.fetch;
  const env = process.env.FILO_ADMIN_REFRESH_TOKEN;
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'finto';
  globalThis.fetch = async (url, opz = {}) => {
    if (opz.method === 'PATCH') scritti.push(JSON.parse(opz.body));
    const ordine = scritti.length ? scritti.at(-1).fields.ordine : { arrayValue: { values: [] } };
    const corpo = { id_token: 't', idToken: 't', access_token: 't', expires_in: '3600', fields: { ordine } };
    return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
  };
  const log = console.log; const err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    await main(['accendi', '812', '--giorni', '30']);
  } finally {
    console.log = log; console.error = err; globalThis.fetch = fetchVero;
    if (env === undefined) delete process.env.FILO_ADMIN_REFRESH_TOKEN; else process.env.FILO_ADMIN_REFRESH_TOKEN = env;
  }
  const numeri = scritti.flatMap((c) => (c.fields?.ordine?.arrayValue?.values || []).map((v) => v.stringValue));
  expect(numeri).toEqual(['812']);
});
