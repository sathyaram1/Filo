import { test, expect, _electron as electron } from '@playwright/test';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { cartellaTemporanea } from '/home/user/Filo/tests/helpers/percorsi.mjs';
import { argomentiScala } from '/home/user/Filo/tests/helpers/scala.mjs';

const APP_ROOT = '/home/user/Filo';

test('probe: si arriva al modulo auth dal main?', async () => {
  const userData = cartellaTemporanea('filo-probe-581-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_DEFAULT_TAVILY_KEY: 'tav-x' },
  });
  await app.firstWindow();
  const r = await app.evaluate(async () => {
    const out = {};
    try {
      const req = process.mainModule && process.mainModule.require;
      out.haMainModule = typeof req === 'function';
      if (req) {
        const auth = process.mainModule.require('./services/auth/google-auth');
        out.chiaviAuth = Object.keys(auth);
      }
    } catch (e) { out.errore = e.message; }
    try {
      out.globali = Object.keys(globalThis).filter((k) => /^(SN_|__filo)/.test(k));
    } catch (_) {}
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
