'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ensureArchiveShape} = require('../assets/js/archive-core.js');
const cases = require('./fixtures/archive-validation.json');
test('common Android and JavaScript validation corpus (34 archives)', () => {
 for (const item of cases) {
  if (item.valid) assert.doesNotThrow(() => ensureArchiveShape(item.archive), item.label);
  else assert.throws(() => ensureArchiveShape(item.archive), undefined, item.label);
 }
});
