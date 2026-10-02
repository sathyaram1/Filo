// #894 giro 2, rilievo 1: un sito in whitelist con un certificato rotto non chiama giudizio AI né finestra isolata.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('google.com con certificato non corrispondente: niente giudizio AI e niente finestra isolata', async () => {
  const SB = require('../../../src/main/services/safebrowse/index.js');
  for (const c of Object.values(SB._caches)) c.m.clear();
  const conta = { llm: 0, sandbox: 0 };
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async () => { conta.llm++; return { suspicious: false }; },
    sandbox: async () => { conta.sandbox++; return { verdict: 'clean' }; },
  });
  SB.recordCert('www.google.com', 'mismatch');
  const v = SB.analyze('https://www.google.com/', {}, () => {});
  await new Promise((r) => setTimeout(r, 200));
  expect(v.level).toBe('sospetto');
  expect(conta).toEqual({ llm: 0, sandbox: 0 });
});
