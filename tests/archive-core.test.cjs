const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { console, globalThis: {}, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' } };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync('assets/js/archive-core.js', 'utf8'), sandbox, { filename: 'archive-core.js' });
const core = sandbox.FamilyArchive;

const archive = core.ensureArchiveShape({
  title: 'Test',
  rootPersonId: 'child',
  people: [
    { id: 'child', fullName: 'Child', motherId: 'mother', fatherId: 'father', storyIds: ['s1'], mediaIds: ['m1'], rememberFor: 'test' },
    { id: 'mother', fullName: 'Mother', motherId: 'grandmother' },
    { id: 'father', fullName: 'Father' },
    { id: 'grandmother', fullName: 'Grandmother' }
  ],
  stories: [{ id: 's1', title: 'Story', personIds: ['child'] }],
  media: [{ id: 'm1', type: 'photo', title: 'Photo', path: 'media/test.svg', personIds: ['child'] }]
});

assert.equal(archive.version, 1);
assert.equal(archive.people.length, 4);
assert.equal(archive.rootPersonId, 'child');

const mediaMap = core.byId(archive.media);
assert.equal(core.findPrimaryPhoto(archive.people[0], mediaMap).id, 'm1');
assert.equal(core.getPersonStories(archive.people[0], archive.stories).length, 1);
assert.equal(core.getPersonMedia(archive.people[0], archive.media).length, 1);

const tree = core.buildAncestorTree('child', archive.people, 4);
assert.equal(tree.person.fullName, 'Child');
assert.equal(tree.children[0].person.fullName, 'Mother');
assert.equal(tree.children[1].person.fullName, 'Father');
assert.equal(tree.children[0].children[0].person.fullName, 'Grandmother');
assert.equal(core.countKnownAncestors(tree), 3);

const parsed = core.parseArchiveJson(JSON.stringify({ title: 'Imported', people: [{ id: 'p1', fullName: 'A' }] }));
assert.equal(parsed.title, 'Imported');
assert.equal(parsed.rootPersonId, 'p1');

const invalid = [
  null, [], { version: 2 }, { people: {} },
  { people: [{ id: 'x' }, { id: 'x' }] },
  { people: [{ id: 'x', motherId: 'missing' }] },
  { people: [{ id: 'x', motherId: 'x' }] },
  { people: [{ id: 'x', motherId: 'y' }, { id: 'y', fatherId: 'x' }] },
  { rootPersonId: 'missing' },
  { stories: [{ id: 's', personIds: ['missing'] }] },
  { media: [{ id: 'm', type: 'photo', path: '../outside' }] },
  { media: [{ id: 'm', type: 'photo', path: 'media/%2e%2e/evil.jpg' }] },
  { media: [{ id: 'm', type: 'photo', path: 'media/evil?x=.jpg' }] },
  { media: [{ id: 'm', type: 'photo', path: 'media/evil\\x.jpg' }] }
];
for (const value of invalid) assert.throws(() => core.ensureArchiveShape(value));
assert.equal(core.validMediaPath('media/семейное фото 1.jpg'), true);
assert.equal(core.mediaUrl('media/семейное фото 1.jpg'), 'media/%D1%81%D0%B5%D0%BC%D0%B5%D0%B9%D0%BD%D0%BE%D0%B5%20%D1%84%D0%BE%D1%82%D0%BE%201.jpg');
assert.equal(core.mediaUrl('javascript:alert(1)'), null);
assert.equal(core.ensureArchiveShape({ people: [{ id: 'x' }], media: [] }).people[0].rememberFor, '');

console.log('archive-core tests passed');
