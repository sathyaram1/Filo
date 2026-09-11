import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';

const APP_ROOT = '/home/user/Filo';

test('probe: una pagina web arriva a DEFAULTS_UPDATE?', async () => {
  const userData = cartellaTemporanea('filo-probe2-581-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'd'), NODE_ENV: 'test' },
  });
  await app.firstWindow();
  const r = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const da = (url, msg) => globalThis.SN_HANDLE_MESSAGE(msg, { url });
    const out = {};
    out.nomiMsg = { get: MSG.DEFAULTS_GET, upd: MSG.DEFAULTS_UPDATE, pub: MSG.DEFAULT_MODELS_PUBLIC };
    out.updateDaWeb = await da('https://evil.example/p', { type: MSG.DEFAULTS_UPDATE, config: { apiKeys: { openrouter: 'chiave-attaccante' } } });
    out.getDaWeb = await da('https://evil.example/p', { type: MSG.DEFAULTS_GET });
    out.pubDaWeb = await da('https://evil.example/p', { type: MSG.DEFAULT_MODELS_PUBLIC });
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
