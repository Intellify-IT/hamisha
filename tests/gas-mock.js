/**
 * In-memory stand-ins for the Apps Script services Hamisha uses, so the source runs under node:test.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ACCESS = { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', ANYONE: 'ANYONE', DOMAIN: 'DOMAIN' };
const MIME = { FOLDER: 'folder', GOOGLE_DOCS: 'doc', GOOGLE_SHEETS: 'sheet', SHORTCUT: 'shortcut', PNG: 'png' };

function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

function createWorld({ me, now }) {
  const items = new Map();
  let seq = 0;
  const state = { me, now, mails: [], triggers: [], props: new Map(), docs: new Map(), texts: new Map(), sheets: new Map() };

  function make(kind, fields) {
    const id = fields.id || kind + '-' + (++seq);
    const item = Object.assign({ id, kind, parents: [], owner: state.me, trashed: false, editors: [], viewers: [], size: 0,
      access: ACCESS.PRIVATE, perm: 'VIEW', updated: state.now, mime: kind === 'folder' ? MIME.FOLDER : MIME.PNG }, fields, { id });
    items.set(id, item);
    return wrap(item);
  }
  const user = (email) => ({ getEmail: () => email });
  const children = (id, folders) => [...items.values()]
    .filter((x) => x.parents.includes(id) && !x.trashed && (folders ? x.kind === 'folder' : x.kind !== 'folder'))
    .map(wrap);

  function wrap(it) {
    const w = {
      _raw: it,
      getId: () => it.id,
      getName: () => it.name,
      setName: (n) => { it.name = n; return w; },
      getUrl: () => (it.kind === 'folder' ? 'https://drive.google.com/drive/folders/' : 'https://drive.google.com/file/d/') + it.id + '/view',
      getOwner: () => user(it.owner),
      getParents: () => iter(it.parents.map((p) => wrap(items.get(p)))),
      isTrashed: () => it.trashed,
      setTrashed: (v) => { it.trashed = v; return w; },
      getSize: () => it.size,
      getMimeType: () => it.mime,
      getLastUpdated: () => new Date(it.updated),
      getEditors: () => it.editors.map(user),
      getViewers: () => it.viewers.map(user),
      getSharingAccess: () => it.access,
      getSharingPermission: () => it.perm,
      setSharing: (a, p) => { it.access = a; it.perm = p; return w; },
      moveTo: (folder) => { it.parents = [folder.getId()]; return w; },
      makeCopy: (name, folder) => {
        const c = make('file', { name, mime: it.mime, owner: state.me, parents: [folder.getId()], size: it.size,
          tabs: it.tabs ? JSON.parse(JSON.stringify(it.tabs)) : undefined });
        if (state.texts.has(it.id)) state.texts.set(c.getId(), state.texts.get(it.id));
        return c;
      },
      getFiles: () => iter(children(it.id, false)),
      getFolders: () => iter(children(it.id, true)),
      createFolder: (name) => make('folder', { name, owner: state.me, parents: [it.id] }),
    };
    return w;
  }

  function get(id) {
    const it = items.get(id);
    if (!it) throw new Error('Not found: ' + id);
    return wrap(it);
  }

  const globals = {
    MimeType: MIME,
    DriveApp: {
      Access: ACCESS,
      // Like real Apps Script: getFolderById does NOT fail for a file id, it returns an object anyway.
      getFolderById: (id) => get(id),
      getFileById: (id) => get(id),
    },
    DocumentApp: {
      openById: (id) => ({ getBody: () => ({
        getText: () => state.texts.get(id) || '',
        insertParagraph: (i, text) => {
          state.docs.set(id, text);
          state.texts.set(id, text + '\n' + (state.texts.get(id) || ''));
          const p = { setLinkUrl: () => p, setBold: () => p };
          return p;
        },
      }) }),
    },
    SpreadsheetApp: {
      create: (name) => {
        const f = make('file', { name, mime: MIME.GOOGLE_SHEETS });
        state.sheets.set(f.getId(), []);
        return sheetApi(f.getId());
      },
      openById: (id) => { tabsOf(id); return sheetApi(id); },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null),
      setProperty: (k, v) => { state.props.set(k, String(v)); },
    }) },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, after: () => b,
          create: () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; } };
        return b;
      },
    },
    MailApp: { sendEmail: (to, subject, body) => state.mails.push({ to, subject, body }) },
    Session: { getEffectiveUser: () => user(state.me) },
    Logger: { log: () => {} },
    console,
    Date,
  };

  function tabsOf(id) {
    if (state.sheets.has(id)) return [state.sheets.get(id)];
    const it = items.get(id);
    if (it && it.tabs) return it.tabs;
    throw new Error('No sheet: ' + id);
  }
  function tabApi(rows) {
    const width = () => rows.reduce((m, r) => Math.max(m, r.length), 0);
    return {
      appendRow: (r) => rows.push(r.slice()),
      setFrozenRows: () => {},
      getDataRange: () => ({
        getValues: () => rows.map((r) => r.slice()),
        getNumRows: () => rows.length,
        getNumColumns: width,
      }),
      getRange: (r, c, nr, nc) => ({ setValues: (vals) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          const row = rows[r - 1 + i];
          while (row.length < c - 1 + j) row.push('');
          row[c - 1 + j] = vals[i][j];
        }
      } }),
    };
  }
  function sheetApi(id) {
    return {
      getId: () => id,
      getUrl: () => 'https://sheets/' + id,
      getSheets: () => tabsOf(id).map(tabApi),
    };
  }

  return { state, make, get, globals, items };
}

/** Load every src/*.js (except the settings example) into one context, like Apps Script does. */
function loadHamisha(world, settings) {
  const ctx = vm.createContext(Object.assign({}, world.globals));
  const dir = path.join(__dirname, '..', 'src');
  const code = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('Settings'))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  vm.runInContext('const SETTINGS = ' + JSON.stringify(settings) + ';\n' + code +
    '\nthis.__api = { setup, run, resume, now: (f) => { now_ = f; } };', ctx);
  return ctx.__api;
}

module.exports = { createWorld, loadHamisha, ACCESS, MIME };
