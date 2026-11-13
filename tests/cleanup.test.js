'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, loadHamisha, MIME } = require('./gas-mock');

const ME = 'owner@gmail.com';
const OLD = 'agent@work.com';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);

/**
 * Sweep as the new owner, then switch to the old owner for clean-up.
 * Tree: root (mine) > Client (mine) > [doc, sheet, png] (theirs) and 01 Plans (theirs) > brief (theirs).
 */
function sweptWorld(cleanupSettings = {}) {
  const w = createWorld({ me: ME, now: NOW });
  w.make('folder', { id: 'root', name: 'Root' });
  w.make('folder', { id: 'client', name: 'Client', parents: ['root'] });
  w.make('folder', { id: 'plans', name: '01 Plans', owner: OLD, parents: ['client'] });
  w.make('file', { id: 'doc', name: 'Plan', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['client'], updated: NOW - 5 * DAY });
  w.state.texts.set('doc', 'Day 1: Mara\nDay 2: Naivasha');
  w.make('file', { id: 'sheet', name: 'Budget', owner: OLD, mime: MIME.GOOGLE_SHEETS, parents: ['client'], updated: NOW - 5 * DAY,
    tabs: [[['Item', 'KES'], ['Fuel', 5000]]] });
  w.make('file', { id: 'png', name: 'Logo.png', owner: OLD, parents: ['client'], updated: NOW - 5 * DAY, size: 1234 });
  w.make('file', { id: 'brief', name: 'Brief', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['plans'], updated: NOW - 5 * DAY });
  w.make('file', { id: 'skipme', name: 'Owners form', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['client'], updated: NOW - 5 * DAY });

  const base = { oldOwner: OLD, rootId: 'root', skipIds: ['skipme'] };
  const sweeper = loadHamisha(w, base);
  sweeper.now(() => w.state.now);
  sweeper.run();
  const logId = w.state.props.get('log');

  // The clean-up project belongs to the old owner and has its own (empty) properties.
  w.state.me = OLD;
  w.state.props = new Map();
  w.state.triggers = [];
  const cleaner = loadHamisha(w, Object.assign({}, base, { logId }, cleanupSettings));
  cleaner.now(() => w.state.now);
  return { w, cleaner, sweeper, logId };
}

const log = (w, logId) => w.state.sheets.get(logId);
const statusOf = (w, logId, oldId) => {
  const row = log(w, logId).find((r) => String(r[3]).includes('/' + oldId + '/'));
  return row ? row[9] : undefined;
};

test('the old owner runs clean-up, not a sweep', () => {
  const { w, cleaner } = sweptWorld();
  const before = w.items.size;
  cleaner.run();
  assert.equal(w.items.size, before, 'clean-up never creates copies');
});

test('waits for the grace period before trashing anything', () => {
  const { w, cleaner, logId } = sweptWorld();
  const res = cleaner.run();
  assert.equal(res.trashed.length, 0);
  assert.equal(w.items.get('doc').trashed, false);
  assert.equal(statusOf(w, logId, 'doc'), 'waiting (grace period)');
});

test('after grace, trashes verified originals of every kind and records it', () => {
  const { w, cleaner, logId } = sweptWorld();
  w.state.now += 4 * DAY;
  const res = cleaner.run();
  for (const id of ['doc', 'sheet', 'png', 'brief']) {
    assert.equal(w.items.get(id).trashed, true, id + ' trashed');
    assert.equal(statusOf(w, logId, id), 'trashed');
  }
  assert.equal(res.trashed.length, 5, 'four files plus the emptied folder');
  assert.equal(w.state.mails.filter((m) => /clean-up/.test(m.subject)).length, 1);
});

test('an emptied [MOVED] folder is trashed once its files are gone', () => {
  const { w, cleaner, logId } = sweptWorld();
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(w.items.get('plans').trashed, true);
  assert.equal(statusOf(w, logId, 'plans'), 'trashed');
});

test('keeps a folder that still holds live files', () => {
  const { w, cleaner, logId } = sweptWorld();
  w.make('file', { id: 'late', name: 'Late file', owner: OLD, parents: ['plans'], updated: NOW + 3 * DAY });
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(w.items.get('plans').trashed, false);
  assert.equal(statusOf(w, logId, 'plans'), 'kept: folder not empty yet');
});

test('keeps an original that was edited after it was copied', () => {
  const { w, cleaner, logId } = sweptWorld();
  w.items.get('doc').updated = NOW + 1 * DAY;
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(w.items.get('doc').trashed, false);
  assert.equal(statusOf(w, logId, 'doc'), 'kept: original edited after it was copied');
});

test('keeps an original whose copy is missing, trashed or differs', () => {
  const { w, cleaner, logId } = sweptWorld();
  const copyOf = (name) => [...w.items.values()].find((x) => x.name === name && x.owner === ME);
  copyOf('Budget').trashed = true;
  copyOf('Logo.png').size = 999;
  w.state.texts.set(copyOf('Plan').id, 'something else');
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(statusOf(w, logId, 'sheet'), 'kept: copy is in the trash');
  assert.equal(statusOf(w, logId, 'png'), 'kept: file size differs');
  assert.equal(statusOf(w, logId, 'doc'), 'kept: document text differs');
  for (const id of ['sheet', 'png', 'doc']) assert.equal(w.items.get(id).trashed, false);
});

test('keeps a sheet whose copy has different values', () => {
  const { w, cleaner, logId } = sweptWorld();
  const copy = [...w.items.values()].find((x) => x.name === 'Budget' && x.owner === ME);
  copy.tabs[0][1][1] = 6000;
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(statusOf(w, logId, 'sheet'), 'kept: sheet values differ');
});

test('never touches skipped, unmarked or other people\'s files', () => {
  const { w, cleaner, logId } = sweptWorld();
  const row = log(w, logId).find((r) => String(r[3]).includes('/doc/'));
  w.items.get('doc').name = 'Plan';                 // someone removed the mark
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(w.items.get('skipme').trashed, false);
  assert.equal(w.items.get('doc').trashed, false);
  assert.equal(row[9], 'kept: original not marked [MOVED]');
});

test('report-only mode verifies without trashing', () => {
  const { w, cleaner, logId } = sweptWorld({ cleanup: false });
  w.state.now += 4 * DAY;
  cleaner.run();
  assert.equal(w.items.get('doc').trashed, false);
  assert.equal(statusOf(w, logId, 'doc'), 'verified (clean-up off)');
});

test('running clean-up again is a no-op', () => {
  const { w, cleaner } = sweptWorld();
  w.state.now += 4 * DAY;
  cleaner.run();
  const mails = w.state.mails.length;
  const res = cleaner.run();
  assert.equal(res.trashed.length, 0);
  assert.equal(w.state.mails.length, mails, 'no repeat email');
});

test('refuses to clean up without the log id', () => {
  const w = createWorld({ me: OLD, now: NOW });
  w.make('folder', { id: 'root', name: 'Root' });
  const api = loadHamisha(w, { oldOwner: OLD, rootId: 'root' });
  assert.throws(() => api.run(), /set logId/);
});
