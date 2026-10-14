// #1226 giro 2 — una scelta col `?` arriva all'owner in un posto solo: la domanda, non anche un feedback «da decidere».
import { test, expect } from '@playwright/test';

const piatto = (s) => String(s).replace(/\s+/g, ' ');

test("r2 chi verifica non manda la stessa scelta col ? sia in una domanda sia in un feedback derivato da decidere", async () => {
  const { readRoleInstructions } = await import('../../../scripts/dispatch.mjs');
  const t = piatto(readRoleInstructions('verifier', { scope: 'pieno' }));
  const chiedeDomanda = /la domanda accompagna un rilievo col `\?`/.test(t);
  const ancheFeedback = /Un 1 col `\?`, o un esterno di qualunque livello, va avanti in un feedback derivato che l'owner decide a parte/.test(t);
  expect(chiedeDomanda && ancheFeedback, 'la stessa scelta arriva all\'owner due volte, una come feedback in attesa di scelta').toBe(false);
});
