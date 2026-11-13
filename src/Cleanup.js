/**
 * Hamisha — clean-up role. Runs as the OLD owner, because only an owner can trash a file.
 *
 * For every original the sweep logged, it trashes the original only when ALL of these hold:
 *   - the original is still owned by the old owner, carries the [MOVED] mark, and isn't on the skip list;
 *   - the grace period since the copy was made has passed;
 *   - the copy exists, isn't trashed, and is owned by someone other than the old owner;
 *   - name (without the mark) and file type match;
 *   - nobody edited the original after it was copied;
 *   - the content matches: Docs text, Sheets values, file size for uploaded files.
 * Folders are trashed only when marked, past grace, their twin exists, and they are empty.
 * Every decision is written back to the log; anything not trashed says why.
 * Trash, not permanent delete: Drive keeps trashed items for 30 days.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */
const COL = { action: 0, title: 2, oldLink: 3, newId: 4, logged: 8, status: 9, when: 10 };
/** Drive links: …/d/<id>/…, …/folders/<id>, or ?id=<id>. */
const ID_RE = /(?:\/d\/|\/folders\/|[?&]id=)([-\w]+)/;
const BANNER = 'This document has moved.';
const WAIT = 'waiting (grace period)';

function cleanup_(resuming) {
  const ctx = newContext_(resuming);
  ctx.trashed = [];
  ctx.kept = 0;
  clearResumeTriggers_();
  if (!ctx.c.logId) throw new Error('Hamisha: set logId in Settings.js for the clean-up role');
  const sheet = SpreadsheetApp.openById(ctx.c.logId).getSheets()[0];
  let finished = false;
  try {
    const rows = sheet.getDataRange().getValues();
    if (rows.length && rows[0][COL.status] !== 'Clean-up') {
      sheet.getRange(1, COL.status + 1, 1, 2).setValues([['Clean-up', 'Clean-up date']]);
    }
    for (let r = 1; r < rows.length; r++) {
      if (rows[r][COL.action] === 'copied') cleanRow_(ctx, sheet, r, rows[r], verifyFile_);
    }
    // Folders after files, deepest last-logged first, so emptied parents follow their children.
    for (let r = rows.length - 1; r >= 1; r--) {
      if (rows[r][COL.action] === 'folder') cleanRow_(ctx, sheet, r, rows[r], verifyFolder_);
    }
    finished = true;
  } catch (e) {
    if (e.message !== TIME_UP) throw e;
    ScriptApp.newTrigger('resume').timeBased().after(60 * 1000).create();
  }
  cleanupDigest_(ctx);
  return { finished: finished, trashed: ctx.trashed, kept: ctx.kept };
}

function cleanRow_(ctx, sheet, r, row, verify) {
  tick_(ctx);
  const status = String(row[COL.status] || '');
  if (status.indexOf('trashed') === 0) return;               // done in an earlier run
  const m = String(row[COL.oldLink]).match(ID_RE);
  if (!m) return writeStatus_(sheet, r, status, 'kept: no id in old link');
  const oldId = m[1];
  let verdict;
  try { verdict = verify(ctx, oldId, String(row[COL.newId]), row[COL.logged]); } catch (e) { verdict = 'kept: ' + e.message; }

  if (verdict === true) {
    if (!ctx.c.cleanup) return writeStatus_(sheet, r, status, 'verified (clean-up off)');
    DriveApp.getFileById(oldId).setTrashed(true);
    ctx.trashed.push(String(row[COL.title]));
    return writeStatus_(sheet, r, status, 'trashed');
  }
  if (verdict === 'already') return writeStatus_(sheet, r, status, 'trashed (already)');
  if (verdict !== WAIT) ctx.kept++;
  writeStatus_(sheet, r, status, verdict);
}

/** Only touch the sheet when the status changes, so quiet days cost nothing. */
function writeStatus_(sheet, r, before, after) {
  if (before === after) return;
  sheet.getRange(r + 1, COL.status + 1, 1, 2).setValues([[after, new Date(now_())]]);
}

/** Checks shared by files and folders. Returns '' when fine, else the reason to keep. */
function commonChecks_(ctx, original, logged) {
  if (ctx.c.skipIds.indexOf(original.getId()) >= 0) return 'kept: on skip list';
  if (!isOld_(ctx, original)) return 'kept: not owned by ' + ctx.c.oldOwner;
  if (original.getName().indexOf(ctx.c.prefix) !== 0) return 'kept: original not marked ' + ctx.c.prefix.trim();
  const t = new Date(logged).getTime();
  if (isNaN(t)) return 'kept: no log time';
  if (now_() - t < ctx.c.graceDays * DAY_MS) return WAIT;
  return '';
}

function checkCopy_(ctx, newId) {
  let copy;
  try { copy = DriveApp.getFileById(newId); } catch (e) { return { reason: 'kept: copy not found' }; }
  if (copy.isTrashed()) return { reason: 'kept: copy is in the trash' };
  if (isOld_(ctx, copy)) return { reason: 'kept: copy still owned by ' + ctx.c.oldOwner };
  return { copy: copy };
}

function verifyFile_(ctx, oldId, newId, logged) {
  let original;
  try { original = DriveApp.getFileById(oldId); } catch (e) { return 'kept: original not found'; }
  if (original.isTrashed()) return 'already';
  if (original.getMimeType() === MimeType.FOLDER) return 'kept: logged as a file but is a folder';
  const why = commonChecks_(ctx, original, logged);
  if (why) return why;
  const got = checkCopy_(ctx, newId);
  if (got.reason) return got.reason;
  const copy = got.copy;
  if (original.getName().slice(ctx.c.prefix.length) !== copy.getName()) return 'kept: names differ';
  if (original.getMimeType() !== copy.getMimeType()) return 'kept: file types differ';
  if (original.getLastUpdated().getTime() > new Date(logged).getTime() + ctx.c.editMarginMs) {
    return 'kept: original edited after it was copied';
  }
  const diff = contentDiff_(ctx, original, copy);
  return diff ? 'kept: ' + diff : true;
}

function verifyFolder_(ctx, oldId, newId, logged) {
  let meta;
  try { meta = DriveApp.getFileById(oldId); } catch (e) { return 'kept: original not found'; }
  if (meta.isTrashed()) return 'already';
  if (meta.getMimeType() !== MimeType.FOLDER) return 'kept: logged as a folder but is a file';
  const folder = DriveApp.getFolderById(oldId);
  const why = commonChecks_(ctx, folder, logged);
  if (why) return why;
  const got = checkCopy_(ctx, newId);
  if (got.reason) return got.reason.replace('copy', 'twin folder');
  if (hasLiveChildren_(folder)) return 'kept: folder not empty yet';
  return true;
}

function hasLiveChildren_(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) if (!files.next().isTrashed()) return true;
  const subs = folder.getFolders();
  while (subs.hasNext()) if (!subs.next().isTrashed()) return true;
  return false;
}

/** '' when the copy holds the same content as the original, else what differs. */
function contentDiff_(ctx, original, copy) {
  const mime = original.getMimeType();
  if (mime === MimeType.GOOGLE_DOCS) {
    const a = stripBanner_(DocumentApp.openById(original.getId()).getBody().getText());
    const b = DocumentApp.openById(copy.getId()).getBody().getText();
    return a.trim() === b.trim() ? '' : 'document text differs';
  }
  if (mime === MimeType.GOOGLE_SHEETS) {
    const a = SpreadsheetApp.openById(original.getId()).getSheets();
    const b = SpreadsheetApp.openById(copy.getId()).getSheets();
    if (a.length !== b.length) return 'sheet tabs differ';
    for (let i = 0; i < a.length; i++) {
      const ra = a[i].getDataRange();
      const rb = b[i].getDataRange();
      if (ra.getNumRows() !== rb.getNumRows() || ra.getNumColumns() !== rb.getNumColumns()) return 'sheet size differs';
      if (ra.getNumRows() * ra.getNumColumns() > ctx.c.maxSheetCells) continue;
      if (JSON.stringify(ra.getValues()) !== JSON.stringify(rb.getValues())) return 'sheet values differ';
    }
    return '';
  }
  const sa = original.getSize();
  const sb = copy.getSize();
  if (sa > 0 && sa !== sb) return 'file size differs';
  return '';                               // other Google types (Slides, Forms…): checks above suffice
}

function stripBanner_(text) {
  if (text.indexOf(BANNER) !== 0) return text;
  const nl = text.indexOf('\n');
  return nl < 0 ? '' : text.slice(nl + 1);
}

function cleanupDigest_(ctx) {
  if (!ctx.c.digest || !ctx.trashed.length) return;
  MailApp.sendEmail(ctx.me,
    'Hamisha clean-up: ' + ctx.trashed.length + ' verified original(s) moved to trash',
    ctx.trashed.join('\n') + '\n\nKept for review: ' + ctx.kept +
    '\nTrash keeps them for 30 days. Log: https://docs.google.com/spreadsheets/d/' + ctx.c.logId);
}
