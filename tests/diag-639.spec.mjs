// DIAGNOSI #639 (ramo usa e getta): cosa succede sul runner di GitHub dopo il crash del renderer.
import { execSync } from 'node:child_process';
import { readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { test, expect, chiudiApp } from './fixtures/electron.mjs';

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, shell: '/bin/bash' }); }
  catch (e) { return `ERR ${e.message}\n${e.stdout || ''}${e.stderr || ''}`; }
}
function leggi(p) { try { return readFileSync(p, 'utf8').trim(); } catch (e) { return `ERR ${e.code}`; } }

test('ambiente', async () => {
  console.log('DIAG id: ' + sh('id'));
  console.log('DIAG uname: ' + sh('uname -a'));
  console.log('DIAG core_pattern: ' + leggi('/proc/sys/kernel/core_pattern'));
  console.log('DIAG core_pipe_limit: ' + leggi('/proc/sys/kernel/core_pipe_limit'));
  console.log('DIAG ulimit -c soft/hard: ' + sh("ulimit -c; ulimit -Hc"));
  console.log('DIAG ptrace_scope: ' + leggi('/proc/sys/kernel/yama/ptrace_scope'));
  console.log('DIAG userns: ' + leggi('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') + ' / ' + leggi('/proc/sys/kernel/unprivileged_userns_clone'));
  console.log('DIAG apport: ' + sh('systemctl is-active apport 2>&1; systemctl is-active systemd-coredump.socket 2>&1; cat /etc/default/apport 2>&1; ls -la /var/crash 2>&1; ls /usr/share/apport 2>&1 | head'));
  console.log('DIAG risorse: ' + sh('nproc; free -m'));
  console.log('DIAG env: sandbox=' + process.env.ELECTRON_DISABLE_SANDBOX + ' CI=' + process.env.CI + ' DISPLAY=' + process.env.DISPLAY);
});

function processiElectron() {
  return sh(`ps -eo pid,ppid,pgid,sid,stat,etimes,wchan:28,args --forest | grep -v grep | grep -iE 'electron|apport|coredump|crashpad' | cut -c1-260`);
}

function chiTieneLePipe(pidMain) {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    try { cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ').slice(0, 120); } catch (_) { continue; }
    if (!/electron/i.test(cmd)) continue;
    const fds = [];
    for (const fd of ['1', '2', '3', '4']) {
      try { fds.push(`${fd}->${readlinkSync(`/proc/${d}/fd/${fd}`)}`); } catch (_) {}
    }
    out.push(`${d} stat=[${leggi(`/proc/${d}/stat`).split(' ').slice(2, 3)}] ${fds.join(' ')} :: ${cmd}`);
  }
  return out.join('\n');
}

async function provaCrash({ app, openTab, testServer }, modo) {
  const righe = [];
  const t0 = Date.now();
  const proc = app.process();
  const raccogli = (tag) => (b) => { for (const r of String(b).split('\n')) if (r.trim()) righe.push(`+${Date.now() - t0}ms [${tag}] ${r.slice(0, 400)}`); };
  proc.stderr.on('data', raccogli('err'));
  proc.stdout.on('data', raccogli('out'));
  const url = testServer.html('<!DOCTYPE html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  const pid = await app.evaluate(({ webContents, BrowserWindow }, { target, modo: m }) => {
    const shellWc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const mainWin = BrowserWindow.fromWebContents(shellWc);
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === target && BrowserWindow.fromWebContents(w) === mainWin);
    if (!wc) throw new Error('webContents della scheda non trovato');
    const p = wc.getOSProcessId();
    if (m === 'forza') wc.forcefullyCrashRenderer();
    return p;
  }, { target: url, modo });
  if (modo === 'kill') process.kill(pid, 'SIGKILL');
  righe.push(`+${Date.now() - t0}ms [diag] crash ${modo} pid=${pid}`);
  let trovata = false;
  for (let i = 0; i < 20 && !trovata; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const stat = leggi(`/proc/${pid}/stat`).split(' ').slice(2, 3).join(' ');
    const wchan = leggi(`/proc/${pid}/wchan`);
    trovata = app.windows().some((w) => { try { return w.url().startsWith('filo://error/'); } catch (_) { return false; } });
    const urls = app.windows().map((w) => { try { return w.url().slice(0, 60); } catch (_) { return '?'; } });
    console.log(`DIAG ${modo} t=${i + 1}s pid ${pid} stato=[${stat}] wchan=${wchan} paginaErrore=${trovata} finestre=${JSON.stringify(urls)}`);
    if (i === 2 || i === 10) console.log(`DIAG ${modo} processi t=${i + 1}s\n` + processiElectron());
  }
  const stato = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w ? w._filoTabs.tabs.map((t) => { let u = '', c = null; try { u = t.view.webContents.getURL(); c = t.view.webContents.isCrashed(); } catch (_) {} return { url: t.url, wc: u, crashed: c, at: t._crashRecoveryAt || null }; }) : 'nessuna finestra con _filoTabs';
  }).catch((e) => `evaluate fallito: ${e.message}`);
  console.log(`DIAG ${modo} schede: ${JSON.stringify(stato)}`);
  console.log(`DIAG ${modo} processi prima della chiusura\n` + processiElectron());
  const tc = Date.now();
  const pidMain = proc.pid;
  await chiudiApp(app);
  console.log(`DIAG ${modo} chiudiApp: ${Date.now() - tc}ms, exitCode=${proc.exitCode} signal=${proc.signalCode}`);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`DIAG ${modo} processi DOPO la chiusura\n` + processiElectron());
  console.log(`DIAG ${modo} chi tiene le pipe dopo la chiusura (main ${pidMain})\n` + chiTieneLePipe(pidMain));
  console.log(`DIAG ${modo} stderr dell'app\n` + righe.join('\n'));
  return trovata;
}

test('crash con SIGKILL al processo del renderer', async ({ app, shell, openTab, testServer }) => {
  void shell;
  const ok = await provaCrash({ app, openTab, testServer }, 'kill');
  expect(ok).toBe(true);
});

test('crash con forcefullyCrashRenderer', async ({ app, shell, openTab, testServer }) => {
  void shell;
  const ok = await provaCrash({ app, openTab, testServer }, 'forza');
  expect(ok).toBe(true);
});
