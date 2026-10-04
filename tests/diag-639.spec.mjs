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


test('forcefullyCrashRenderer: quanto resta a morire, e su cosa e bloccato', async ({ app, shell, openTab, testServer }) => {
  void shell;
  test.setTimeout(200_000);
  const righe = [];
  const t0 = Date.now();
  const proc = app.process();
  proc.stderr.on('data', (b) => { for (const r of String(b).split('\n')) if (r.trim()) righe.push(`+${Date.now() - t0}ms [err] ${r.slice(0, 300)}`); });
  const url = testServer.html('<!DOCTYPE html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  const pid = await app.evaluate(({ webContents, BrowserWindow }, target) => {
    const shellWc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const mainWin = BrowserWindow.fromWebContents(shellWc);
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === target && BrowserWindow.fromWebContents(w) === mainWin);
    const p = wc.getOSProcessId();
    wc.forcefullyCrashRenderer();
    return p;
  }, url);
  let morto = -1;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const vivo = leggi(`/proc/${pid}/stat`);
    const errore = app.windows().some((w) => { try { return w.url().startsWith('filo://error/'); } catch (_) { return false; } });
    if (i === 4) {
      const helper = sh("pgrep -f systemd-coredump | head -5").trim().split('\n').filter(Boolean);
      console.log('DIAG helper pids: ' + helper.join(','));
      for (const h of helper) {
        console.log(`DIAG helper ${h} status:\n` + sh(`grep -E 'State|PPid|Name' /proc/${h}/status`));
        console.log(`DIAG helper ${h} stack:\n` + sh(`sudo cat /proc/${h}/stack`));
        console.log(`DIAG helper ${h} cmdline: ` + sh(`tr '\\0' ' ' < /proc/${h}/cmdline`));
        console.log(`DIAG helper ${h} fd:\n` + sh(`sudo ls -l /proc/${h}/fd`));
      }
      console.log(`DIAG renderer ${pid} thread:\n` + sh(`for t in /proc/${pid}/task/*; do echo "$t $(cat $t/stat | cut -d' ' -f2,3) wchan=$(cat $t/wchan)"; done`));
      console.log(`DIAG renderer ${pid} stack dei thread non idle:\n` + sh(`for t in /proc/${pid}/task/*; do s=$(cut -d' ' -f3 $t/stat); if [ "$s" != "I" ]; then echo "== $t $s"; sudo cat $t/stack; fi; done`));
      console.log(`DIAG renderer ${pid} VmSize/VmRSS: ` + sh(`grep -E 'VmSize|VmRSS|Threads' /proc/${pid}/status`));
      console.log('DIAG coredump.conf: ' + sh('cat /etc/systemd/coredump.conf 2>&1 | grep -v "^#" ; ls /etc/systemd/coredump.conf.d 2>&1; systemctl status systemd-coredump.socket --no-pager 2>&1 | head -5'));
      console.log('DIAG suid_dumpable: ' + leggi('/proc/sys/fs/suid_dumpable'));
    }
    if (i % 10 === 9) console.log(`DIAG t=${i + 1}s renderer=${vivo.startsWith('ERR') ? 'sparito' : vivo.split(' ')[2]} paginaErrore=${errore}`);
    if (vivo.startsWith('ERR') && morto < 0) { morto = i + 1; console.log(`DIAG renderer sparito a ${morto}s, paginaErrore=${errore}`); }
    if (morto > 0 && errore) break;
  }
  console.log('DIAG coredumpctl:\n' + sh('coredumpctl list --no-pager 2>&1 | tail -5; sudo ls -la /var/lib/systemd/coredump 2>&1 | tail -5'));
  console.log('DIAG journal coredump:\n' + sh("sudo journalctl --no-pager -n 25 -t systemd-coredump 2>&1 | cut -c1-300"));
  console.log('DIAG stderr app:\n' + righe.join('\n'));
  const tc = Date.now();
  await chiudiApp(app);
  console.log(`DIAG chiudiApp (gruppo): ${Date.now() - tc}ms`);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DIAG processi dopo la chiusura:\n' + processiElectron());
});
