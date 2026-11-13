'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, loadHamisha, ACCESS, MIME } = require('./gas-mock');

const ME = 'owner@gmail.com';
const OLD = 'agent@work.com';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);

/** A small tree: root (mine) > Client (mine) > 01 Plans (theirs) > files. */
function setupWorld(extra = {}) {
  const w = createWorld({ me: ME, now: NOW });
  const root = w.make('folder', { id: 'root', name: 'Root' });
  const client = w.make('folder', { id: 'client', name: 'Client', parents: ['root'] });
  const plans = w.make('folder', { id: 'plans', name: '01 Plans', owner: OLD, parents: ['client'] });
  w.make('file', { id: 'old-doc', name: 'Plan doc', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['client'],
    updated: NOW - 5 * DAY, access: ACCESS.ANYONE_WITH_LINK, perm: 'EDIT', editors: [OLD, 'client@x.com'] });
  w.make('file', { id: 'fresh', name: 'Fresh sheet', owner: OLD, mime: MIME.GOOGLE_SHEETS, parents: ['client'], updated: NOW - 3600e3 });
  w.make('file', { id: 'in-plans', name: 'Brief', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['plans'], updated: NOW - 9 * DAY });
  w.make('file', { id: 'mine-in-plans', name: 'My notes', owner: ME, parents: ['plans'] });
  w.make('file', { id: 'skip-me', name: 'Owners form', owner: OLD, mime: MIME.GOOGLE_DOCS, parents: ['client'], updated: NOW - 9 * DAY });
  w.make('file', { id: 'short', name: 'Shortcut', owner: OLD, mime: MIME.SHORTCUT, parents: ['client'], updated: NOW - 9 * DAY });
  const settings = Object.assign({ oldOwner: OLD, rootId: 'root', skipIds: ['skip-me'], parkingName: 'Parking' }, extra);
  const api = loadHamisha(w, settings);
  api.now(() => w.state.now);
  return { w, api, root, client, plans };
}

const rows = (w) => [...w.state.sheets.values()][0] || [];
const actions = (w, a) => rows(w).filter((r) => r[0] === a);
const childrenNamed = (w, parent, name) => [...w.items.values()].filter((x) => x.parents.includes(parent) && x.name === name);

test('copies an idle file the old owner owns, in place, and marks the original', () => {
  const { w, api } = setupWorld();
  const res = api.run();
  assert.equal(res.finished, true);
  const copies = childrenNamed(w, 'client', 'Plan doc');
  assert.equal(copies.length, 1, 'one copy with the original name');
  assert.equal(copies[0].owner, ME);
  assert.equal(copies[0].access, ACCESS.ANYONE_WITH_LINK, 'link sharing mirrored');
  assert.equal(copies[0].perm, 'EDIT');
  assert.equal(w.items.get('old-doc').name, '[MOVED] Plan doc');
  assert.match(w.state.docs.get('old-doc'), /has moved/);
  const logged = actions(w, 'copied').find((r) => r[2] === 'Plan doc');
  assert.equal(logged[6], 'client@x.com', 'other people with access are listed for re-sharing');
});

test('leaves files that are still being edited, skipped ids and shortcuts alone', () => {
  const { w, api } = setupWorld();
  api.run();
  assert.equal(w.items.get('fresh').name, 'Fresh sheet');
  assert.equal(w.items.get('skip-me').name, 'Owners form');
  assert.equal(childrenNamed(w, 'client', 'Owners form').length, 1);
  assert.equal(childrenNamed(w, 'client', 'Shortcut').length, 1);
});

test('a folder the old owner owns gets a twin; the original is marked, contents move or copy', () => {
  const { w, api } = setupWorld();
  api.run();
  const twins = childrenNamed(w, 'client', '01 Plans');
  assert.equal(twins.length, 1, 'exactly one folder now carries the plain name');
  assert.equal(twins[0].owner, ME);
  assert.equal(w.items.get('plans').name, '[MOVED] 01 Plans');
  assert.deepEqual(w.items.get('mine-in-plans').parents, [twins[0].id], 'my own file moved into the twin');
  assert.equal(childrenNamed(w, twins[0].id, 'Brief').length, 1, 'their file copied into the twin');
});

test('running again changes nothing that was already handled', () => {
  const { w, api } = setupWorld();
  api.run();
  const count = w.items.size;
  const res = api.run();
  assert.equal(w.items.size, count, 'no new copies or folders');
  assert.equal(res.moved.length, 0);
});

test('a file becomes eligible once it has been idle long enough', () => {
  const { w, api } = setupWorld();
  api.run();
  w.state.now += 2 * DAY;
  api.run();
  assert.equal(w.items.get('fresh').name, '[MOVED] Fresh sheet');
  assert.equal(childrenNamed(w, 'client', 'Fresh sheet').length, 1);
});

test('stops near the time cap, schedules a resume, and the resume finishes without redoing work', () => {
  const { w, api } = setupWorld({ limitMs: 10 });
  // Every clock read advances 4 ms, so the pass times out part-way through.
  let t = NOW;
  api.now(() => (t += 4));
  const first = api.run();
  assert.equal(first.finished, false);
  assert.ok(w.state.triggers.some((x) => x.getHandlerFunction() === 'resume'));
  api.now(() => NOW);                       // plenty of time for the resume
  const second = api.resume();
  assert.equal(second.finished, true);
  assert.ok(!w.state.triggers.some((x) => x.getHandlerFunction() === 'resume'), 'resume trigger cleared');
  assert.equal(childrenNamed(w, 'client', 'Plan doc').length, 1, 'still exactly one copy');
});

test('setup installs one daily trigger and sweeps straight away', () => {
  const { w, api } = setupWorld();
  api.setup();
  api.setup();
  assert.equal(w.state.triggers.filter((x) => x.getHandlerFunction() === 'run').length, 1);
  assert.ok(actions(w, 'pass-done').length >= 1);
});

test('emails a digest only when something moved', () => {
  const { w, api } = setupWorld();
  api.run();
  assert.equal(w.state.mails.length, 1);
  assert.match(w.state.mails[0].subject, /moved/);
  api.run();
  assert.equal(w.state.mails.length, 1, 'no email on a quiet day');
});

test('items outside the root are swept into the parking folder', () => {
  const { w, api } = setupWorld({ extraIds: ['outside'] });
  w.make('file', { id: 'outside', name: 'Stray doc', owner: OLD, mime: MIME.GOOGLE_DOCS, updated: NOW - 9 * DAY });
  api.run();
  const parking = childrenNamed(w, 'root', 'Parking');
  assert.equal(parking.length, 1);
  assert.equal(childrenNamed(w, parking[0].id, 'Stray doc').length, 1, 'the doc is copied, not twinned as a folder');
  assert.equal([...w.items.values()].filter((x) => x.kind === 'folder' && x.name === 'Stray doc').length, 0);
});

test('refuses to run without the required settings', () => {
  const w = createWorld({ me: ME, now: NOW });
  const api = loadHamisha(w, {});
  assert.throws(() => api.run(), /set oldOwner and rootId/);
});
