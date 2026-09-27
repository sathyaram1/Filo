// #708.1 giro 2 — su un desktop che Chromium non riconosce (sway) con un portachiavi
// vero acceso, l'accesso sopravvive alla riapertura; senza portachiavi l'avviso c'è.
// Solo Linux con gnome-keyring e dbus installati: bus e portachiavi li crea il test.

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EMAIL = 'sway@prova.test';
const haStrumenti = process.platform === 'linux'
  && spawnSync('which', ['gnome-keyring-daemon']).status === 0
  && spawnSync('which', ['dbus-daemon']).status === 0;

test.skip(!haStrumenti, 'serve Linux con gnome-keyring e dbus');

function busConPortachiavi(base, { conPortachiavi }) {
  const xdg = {
    XDG_DATA_HOME: join(base, 'data'), XDG_CONFIG_HOME: join(base, 'config'),
    XDG_CACHE_HOME: join(base, 'cache'), XDG_RUNTIME_DIR: join(base, 'run'),
  };
  for (const d of Object.values(xdg)) mkdirSync(d, { recursive: true });
  chmodSync(xdg.XDG_RUNTIME_DIR, 0o700);
  const out = execFileSync('dbus-daemon', ['--session', '--fork', '--print-address=1', '--print-pid=1'], { env: { ...process.env, ...xdg } })
    .toString().trim().split('\n');
  const env = { ...xdg, DBUS_SESSION_BUS_ADDRESS: out[0] };
  const pids = [Number(out[1])];
  if (conPortachiavi) {
    const k = spawnSync('gnome-keyring-daemon', ['--unlock', '--components=secrets'], { input: 'pw', env: { ...process.env, ...env } });
    const m = /pid=?(\d+)/i.exec(String(k.stdout));
    if (m) pids.push(Number(m[1]));
  }
  return { env, chiudi: () => { for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch (_) {} } } };
}

async function apri(userData, envBus) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env, ...envBus,
      XDG_CURRENT_DESKTOP: 'sway', DESKTOP_SESSION: 'sway',
      FILO_USER_DATA: userData, NODE_ENV: 'test',
    },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function accedi(app, shell) {
  await app.evaluate(({ shell: sh }, { email }) => {
    globalThis.__urlConsenso = null;
    sh.openExternal = async (url) => { globalThis.__urlConsenso = url; };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-s', sub: 'uid-s', email })}.x`;
    const vero = globalThis.fetch;
    const r = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return r({ id_token: jwt, access_token: 'a' });
      if (u.includes('accounts:signInWithIdp')) return r({ idToken: jwt, refreshToken: 'rt-s', email, displayName: 'S', photoUrl: '', expiresIn: '3600' });
      return vero(input, init);
    };
  }, { email: EMAIL });
  await shell.evaluate(() => { window.__esito = window.filoShell.auth.signIn(); });
  let url = null;
  const scade = Date.now() + 10_000;
  while (!url && Date.now() < scade) {
    url = await app.evaluate(() => globalThis.__urlConsenso);
    if (!url) await new Promise((res) => setTimeout(res, 100));
  }
  const p = new URL(url).searchParams;
  const ritorno = new URL(p.get('redirect_uri'));
  ritorno.searchParams.set('code', 'c');
  ritorno.searchParams.set('state', p.get('state'));
  await fetch(ritorno);
  return shell.evaluate(() => window.__esito);
}

for (const conPortachiavi of [true, false]) {
  test(`sway ${conPortachiavi ? 'col' : 'senza'} portachiavi: chiudi e riapri`, async () => {
    test.setTimeout(90_000);
    const base = cartellaTemporanea('filo-708-k-');
    const userData = join(base, 'ud');
    const bus = busConPortachiavi(base, { conPortachiavi });
    try {
      let { app, shell } = await apri(userData, bus.env);
      const esito = await accedi(app, shell);
      expect(esito.ok).toBe(true);
      expect(esito.remembered).toBe(conPortachiavi);
      const avviso = shell.locator('.shell-notif-msg', { hasText: 'dovrai accedere di nuovo' });
      if (conPortachiavi) {
        await shell.waitForTimeout(1500);
        await expect(avviso).toHaveCount(0);
      } else {
        await expect(avviso).toHaveCount(1, { timeout: 8_000 });
      }
      await chiudiApp(app);

      ({ app, shell } = await apri(userData, bus.env));
      const stato = await shell.evaluate(() => window.filoShell.auth.status());
      expect(stato.signedIn).toBe(conPortachiavi);
      if (conPortachiavi) expect(stato.profile && stato.profile.email).toBe(EMAIL);
      await chiudiApp(app);
    } finally {
      bus.chiudi();
      try { rmSync(base, { recursive: true, force: true }); } catch (_) {}
    }
  });
}
