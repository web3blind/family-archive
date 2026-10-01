const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../assets/js/platform.js'), 'utf8');
function mount(capacitor) {
  const window = capacitor ? { Capacitor: capacitor } : {};
  vm.runInNewContext(script, { window, Promise, Error, encodeURIComponent });
  return window;
}

test('ordinary browser does not acquire a native adapter', () => {
  assert.equal(mount().FamilyArchiveNative, undefined);
  assert.equal(mount({ getPlatform: () => 'web' }).FamilyArchiveNative, undefined);
});

test('Android adapter unwraps plugin results and converts private paths synchronously', async () => {
  const calls = [];
  const native = {
    getRootUri: async () => ({ rootUri: 'file:///data/user/0/xyz/files/family-archive/' }),
    readArchive: async () => ({ archive: { title: 'real' } }),
    writeArchive: async data => { calls.push(data.archive.title); return {}; },
    pickMedia: async () => ({ media: { path: 'media/picture.jpg', title: 'picture.jpg', type: 'photo' } }),
    importArchive: async () => ({ archive: { title: 'import' } }),
    openArchive: async () => ({ archive: null }),
    exportArchive: async () => ({ status: 'exported' }),
    openMedia: async data => { calls.push(data.path); return {}; }
  };
  const adapter = mount({ getPlatform: () => 'android', isNativePlatform: () => true,
    registerPlugin: () => native, convertFileSrc: value => `converted:${value}` }).FamilyArchiveNative;
  assert.equal(adapter.platform, 'android');
  assert.equal((await adapter.readArchive()).title, 'real');
  assert.equal(adapter.mediaUrl('media/a b.jpg'), 'converted:file:///data/user/0/xyz/files/family-archive/media/a%20b.jpg');
  assert.equal(adapter.mediaUrl('media/reunion/portrait.jpg'), 'converted:file:///data/user/0/xyz/files/family-archive/media/reunion/portrait.jpg');
  for (const unsafe of ['../archive.json', 'media/../archive.json', 'media/a//b.jpg', 'https://x', 'media/.hidden']) {
    assert.equal(adapter.mediaUrl(unsafe), '');
  }
  await adapter.writeArchive({ title: 'saved' });
  assert.deepEqual(calls, ['saved']);
  assert.equal((await adapter.pickMedia()).path, 'media/picture.jpg');
  assert.equal((await adapter.importArchive()).title, 'import');
  assert.equal(await adapter.openArchive(), null);
  assert.equal(await adapter.exportArchive(), 'exported');
  await adapter.openMedia('media/Семья/Письмо.pdf');
  assert.equal(calls.at(-1),'media/Семья/Письмо.pdf');
  await assert.rejects(adapter.openMedia('../archive.json'), /Небезопасный/);
});

test('Android picker passes through the nested media result and handles cancel', async () => {
  const item = { path: 'media/portrait.jpg', type: 'photo', title: 'portrait.jpg' };
  let response = { media: item };
  const adapter = mount({ getPlatform: () => 'android', registerPlugin: () => ({
    getRootUri: async () => ({ rootUri: 'file:///root/' }), pickMedia: async () => response
  }) }).FamilyArchiveNative;
  assert.equal((await adapter.pickMedia()).path, item.path);
  response = { cancelled: true };
  assert.equal(await adapter.pickMedia(), null);
});

test('cancel is null and initialization failure rejects instead of silently substituting bundled archive', async () => {
  const native = { getRootUri: async () => { throw new Error('storage inaccessible'); } };
  const adapter = mount({ getPlatform: () => 'android', registerPlugin: () => native }).FamilyArchiveNative;
  await assert.rejects(adapter.readArchive(), /storage inaccessible/);
  const cancelled = mount({ getPlatform: () => 'android', registerPlugin: () => ({
    getRootUri: async () => ({ rootUri: 'file:///root/' }), readArchive: async () => ({}),
    pickMedia: async () => ({}), importArchive: async () => ({}),
    openArchive: async () => ({}), exportArchive: async () => ({})
  }) }).FamilyArchiveNative;
  assert.equal(await cancelled.readArchive(), null);
  assert.equal(await cancelled.pickMedia(), null);
  assert.equal(await cancelled.importArchive(), null);
  assert.equal(await cancelled.openArchive(), null);
  assert.equal(await cancelled.exportArchive(), null);
});
