const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/archive-core.js', 'utf8');
function harness(native) {
  const writes = [];
  const localStorage = {
    getItem: () => JSON.stringify({ title: 'stale browser data' }),
    setItem: (...args) => writes.push(args)
  };
  const sandbox = { console, URL, localStorage, FamilyArchiveNative: native, fetch: async () => ({ ok: true, json: async () => ({ title: 'bundled' }) }) };
  vm.runInNewContext(source, sandbox);
  return { core: sandbox.FamilyArchive, writes };
}
test('native canonical read ignores stale browser localStorage', async () => {
  const { core, writes } = harness({ readArchive: async () => ({ title: 'device' }), mediaUrl: p => `app-media://local/${p}` });
  assert.equal((await core.loadArchive()).title, 'device');
  assert.equal(writes.length, 0);
  assert.equal(core.mediaUrl('media/a.jpg'), 'app-media://local/media/a.jpg');
  const desktop = harness({ mediaUrl: p => `family://app/${p}` });
  assert.equal(desktop.core.mediaUrl('media/a.jpg'), 'family://app/media/a.jpg');
});
test('native null read uses bundled archive, not browser draft', async () => {
  const { core } = harness({ readArchive: async () => null });
  assert.equal((await core.loadArchive()).title, 'bundled');
});
test('native writes serialize snapshots, errors propagate, queue recovers', async () => {
  const calls = [], pending = [];
  const { core, writes } = harness({
    mediaUrl: () => 'javascript:alert(1)',
    writeArchive: (archive) => { calls.push(archive.title); return new Promise((resolve, reject) => pending.push({ resolve, reject })); }
  });
  assert.equal(core.mediaUrl('media/a.jpg'), null);
  const firstArchive = { title: 'first' };
  const first = core.saveArchive(firstArchive);
  firstArchive.title = 'changed';
  const second = core.saveArchive({ title: 'second' });
  await Promise.resolve();
  assert.deepEqual(calls, ['first']);
  pending[0].reject(new Error('disk full'));
  await assert.rejects(first, /disk full/);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['first', 'second']);
  pending[1].resolve();
  assert.equal((await second).title, 'second');
  assert.equal(writes.length, 0);
});
test('browser save writes localStorage and propagates quota errors', async () => {
  const { core, writes } = harness(null);
  assert.equal((await core.saveArchive({ title: 'browser' })).title, 'browser');
  assert.equal(JSON.parse(writes[0][1]).title, 'browser');
});
