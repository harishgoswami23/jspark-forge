'use strict';
// v0.7 gate checks: a gate step can list what must be true before its long test command starts, on lines like
// `- before: free memory 4 GB`. parse() reads one line's value; check() tests a list of them on this machine and says in
// plain words what is missing. These are fixed, declared checks: nothing taken from the file is ever run. The only
// programs started are `docker` (fixed arguments) and Node itself, always with an argument list, never a shell.
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const MAX_MB = 1048576;
const FORMS = 'a "before:" line must be one of: free memory <n> GB|MB; port <n> open|free; container <name> running';

// Run by Node itself to try one TCP connection. The port arrives as an argument, never inside this text.
// Both this machine's addresses are tried (127.0.0.1 and ::1): a server that listens only on ::1 is "open" too (review
// of v0.7). open: one of them answered. closed: both refused (an address this machine does not have counts as refused).
const PORT_SCRIPT = [
  "const net=require('net');const port=Number(process.argv[1]);const hosts=['127.0.0.1','::1'];const got=[];",
  "const end=()=>{if(got.length<hosts.length)return;console.log(got.includes('open')?'open':got.every(x=>x==='closed')?'closed':'unknown');process.exit(0)};",
  'for(const host of hosts){const s=net.connect({host,port});let said=false;',
  'const say=x=>{if(said)return;said=true;got.push(x);s.destroy();end()};',
  's.setTimeout(1000);',
  "s.on('connect',()=>{console.log('open');process.exit(0)});",
  "s.on('timeout',()=>say('unknown'));",
  "s.on('error',e=>say(['ECONNREFUSED','EADDRNOTAVAIL','ENETUNREACH','EHOSTUNREACH','EAFNOSUPPORT'].includes(e.code)?'closed':'unknown'));}",
].join('');

// Memory that a new program can get, in MB. os.freemem() counts only memory nobody uses at all: on macOS and on older
// Linux that leaves out memory the system gives back on demand, so "free memory 4 GB" might never be met (review of
// v0.7). Linux: MemAvailable. macOS: free + inactive + speculative pages, from vm_stat (a fixed command, no arguments).
function availableMb() {
  try {
    if (process.platform === 'linux') {
      const m = require('node:fs').readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m);
      if (m) return Math.floor(Number(m[1]) / 1024);
    }
    if (process.platform === 'darwin') {
      const r = spawnSync('/usr/bin/vm_stat', [], { timeout: 3000, encoding: 'utf8' });
      if (!r.error && r.status === 0) {
        const out = String(r.stdout || '');
        const page = Number((out.match(/page size of (\d+) bytes/) || [])[1]) || 4096;
        const pages = name => Number((out.match(new RegExp(`^${name}:\\s+(\\d+)\\.`, 'm')) || [])[1]) || 0;
        const n = pages('Pages free') + pages('Pages inactive') + pages('Pages speculative');
        if (n > 0) return Math.floor((n * page) / 1048576);
      }
    }
  } catch { /* fall back to what Node reports */ }
  return Math.floor(os.freemem() / 1048576);
}

function parse(value) {
  const v = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const mem = v.match(/^free memory (\S+) (gb|mb)$/i);
  if (mem) {
    const unit = mem[2].toLowerCase();
    const n = mem[1];
    if (!(unit === 'gb' ? /^\d+(\.\d)?$/ : /^\d+$/).test(n)) {
      return { error: unit === 'gb' ? 'free memory must be a number with at most one decimal, like 4 or 1.5'
        : 'free memory in MB must be a whole number' };
    }
    const mb = Math.round(Number(n) * (unit === 'gb' ? 1024 : 1));
    if (mb <= 0) return { error: 'free memory must be more than 0' };
    if (mb > MAX_MB) return { error: 'free memory must be at most 1048576 MB (1024 GB)' };
    return { kind: 'memory', mb };
  }
  if (/^free memory\b/i.test(v)) return { error: 'free memory must look like: free memory <n> GB or free memory <n> MB' };

  const port = v.match(/^port (\S+) (\S+)$/i);
  if (port) {
    if (!/^\d+$/.test(port[1]) || Number(port[1]) < 1 || Number(port[1]) > 65535) {
      return { error: 'port must be a whole number from 1 to 65535' };
    }
    const want = port[2].toLowerCase();
    if (want !== 'open' && want !== 'free') return { error: 'a port check must end with open or free' };
    return { kind: 'port', port: Number(port[1]), want };
  }
  if (/^port\b/i.test(v)) return { error: 'a port check must look like: port <n> open or port <n> free' };

  const box = v.match(/^container (.+) running$/i);
  if (box) {
    if (!NAME.test(box[1])) {
      return { error: 'container name must start with a letter or digit, then letters, digits, _ . or -, at most 63 characters' };
    }
    return { kind: 'container', name: box[1] };
  }
  if (/^container\b/i.test(v)) return { error: 'a container check must look like: container <name> running' };
  return { error: FORMS };
}

const plainGb = mb => (mb % 1024 === 0 ? String(mb / 1024) : (mb / 1024).toFixed(1));

// Size as written for a need: GB when it is at least 1 GB, else whole MB.
const need = mb => (mb >= 1024 ? `${plainGb(mb)} GB` : `${mb} MB`);

function describe(item) {
  if (item && item.kind === 'memory') return `free memory ${need(item.mb)}`;
  if (item && item.kind === 'port') return `port ${item.port} ${item.want}`;
  if (item && item.kind === 'container') return `container ${item.name} running`;
  return 'unknown check';
}

const realProbes = {
  freeMb: availableMb,
  portOpen(port) {
    const r = spawnSync(process.execPath, ['-e', PORT_SCRIPT, String(port)], { timeout: 4000, windowsHide: true, encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    const out = String(r.stdout || '').trim();
    return out === 'open' ? true : out === 'closed' ? false : null;
  },
  containerRunning(name) {
    if (typeof name !== 'string' || !NAME.test(name)) return null;
    const r = spawnSync('docker', ['ps', '--filter', 'name=^' + name + '$', '--filter', 'status=running',
      '--format', '{{.Names}}'], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout || '').split(/\r?\n/).some(l => l.trim() === name);
  },
};

function one(item, p) {
  const ask = fn => { try { return fn(); } catch (e) { return null; } };
  if (item && item.kind === 'memory') {
    const free = ask(() => p.freeMb());
    if (typeof free !== 'number' || !isFinite(free)) return { ok: false, text: 'could not check free memory' };
    const have = item.mb >= 1024 ? `${(free / 1024).toFixed(1)} GB` : `${free} MB`;
    const want = need(item.mb);
    return free >= item.mb ? { ok: true, text: `free memory is ${have} (needs ${want})` }
      : { ok: false, text: `free memory is ${have}, needs ${want}` };
  }
  if (item && item.kind === 'port') {
    const open = ask(() => p.portOpen(item.port));
    if (open !== true && open !== false) return { ok: false, text: `could not check port ${item.port}` };
    if (item.want === 'open') {
      return open ? { ok: true, text: `port ${item.port} is open` } : { ok: false, text: `nothing is listening on port ${item.port}` };
    }
    return open ? { ok: false, text: `port ${item.port} is already in use` } : { ok: true, text: `port ${item.port} is free` };
  }
  if (item && item.kind === 'container') {
    const up = ask(() => p.containerRunning(item.name));
    if (up === true) return { ok: true, text: `container ${item.name} is running` };
    if (up === false) return { ok: false, text: `container ${item.name} is not running` };
    return { ok: false, text: `could not check container ${item.name} (docker did not answer)` };
  }
  return { ok: false, text: 'unknown check' };
}

function check(items, probes) {
  const p = Object.assign({}, realProbes, probes || {});
  return (Array.isArray(items) ? items : []).map(item => {
    try { return one(item, p); } catch (e) { return { ok: false, text: 'unknown check' }; }
  });
}

const failures = results => (results || []).filter(r => !r.ok).map(r => r.text);

module.exports = { parse, check, failures, describe, realProbes };
