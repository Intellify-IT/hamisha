/**
 * Hamisha — tree walk and per-item handling.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */

/** Walk a folder; `target` is where its files should end up (itself, or its twin). */
function walk_(ctx, folder, target, path) {
  tick_(ctx);
  const doneKey = 'done:' + folder.getId();
  if (ctx.props.getProperty(doneKey) === ctx.pass) return; // finished earlier in this pass
  const files = folder.getFiles();
  while (files.hasNext()) handleFile_(ctx, files.next(), target, path);
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    if (ctx.props.getProperty('twin:' + sub.getId())) continue; // a folder Hamisha created
    if (isOld_(ctx, sub)) walkForeign_(ctx, sub, target, path);
    else walk_(ctx, sub, sub, path + '/' + sub.getName());
  }
  ctx.props.setProperty(doneKey, ctx.pass);
}

/** A folder the old owner owns: its contents go into a twin the new owner owns. */
function walkForeign_(ctx, folder, target, path) {
  const twin = twin_(ctx, folder, target);
  walk_(ctx, folder, twin, path + '/' + twin.getName());
}

function handleFile_(ctx, f, target, path) {
  tick_(ctx);
  const id = f.getId();
  if (ctx.c.skipIds.indexOf(id) >= 0 || ctx.props.getProperty('f:' + id)) return;
  if (f.isTrashed() || f.getMimeType() === MimeType.SHORTCUT) return;

  if (!isOld_(ctx, f)) {                       // already ours: just make sure it sits in the target
    if (!inFolder_(f, target)) {
      f.moveTo(target);
      log_(ctx, ['moved', path, f.getName(), f.getUrl(), id, f.getUrl(), '', '']);
    }
    return;
  }
  if (f.getName().indexOf(ctx.c.prefix) === 0) return;          // an original already replaced
  if (idleDays_(f) < ctx.c.idleDays) return;                    // still being worked on

  const copy = f.makeCopy(f.getName(), target);
  const link = mirrorLinkSharing_(f, copy);
  const others = f.getEditors().concat(f.getViewers())
    .map((u) => u.getEmail())
    .filter((e) => e && e !== ctx.c.oldOwner && e !== ctx.me);
  markOriginal_(ctx, f, copy);
  ctx.props.setProperty('f:' + id, copy.getId());
  ctx.moved.push(f.getName());
  log_(ctx, ['copied', path, copy.getName(), f.getUrl(), copy.getId(), copy.getUrl(), others.join(' '), link]);
}

function mirrorLinkSharing_(f, copy) {
  try {
    const access = f.getSharingAccess();
    if (access === DriveApp.Access.ANYONE_WITH_LINK || access === DriveApp.Access.ANYONE) {
      const perm = f.getSharingPermission();
      copy.setSharing(access, perm);
      return access + '/' + perm;
    }
    return '';
  } catch (e) { return 'check: ' + e.message; }
}

/** Old links stay useful: rename the original and, for Docs, point to the new copy. */
function markOriginal_(ctx, f, copy) {
  try {
    if (f.getMimeType() === MimeType.GOOGLE_DOCS) {
      const p = DocumentApp.openById(f.getId()).getBody()
        .insertParagraph(0, 'This document has moved. Current version: ' + copy.getUrl());
      p.setLinkUrl(copy.getUrl()).setBold(true);
    }
    f.setName(ctx.c.prefix + f.getName());
  } catch (e) { log_(ctx, ['mark-failed', '', f.getName(), f.getUrl(), '', '', '', e.message]); }
}

function markFolder_(ctx, folder) {
  try {
    if (folder.getName().indexOf(ctx.c.prefix) !== 0) folder.setName(ctx.c.prefix + folder.getName());
  } catch (e) { log_(ctx, ['mark-failed', '', folder.getName(), folder.getUrl(), '', '', '', e.message]); }
}

function twin_(ctx, folder, target) {
  const key = 'd:' + folder.getId();
  const have = ctx.props.getProperty(key);
  if (have) {
    try { const t = DriveApp.getFolderById(have); markFolder_(ctx, folder); return t; } catch (e) { /* recreate */ }
  }
  const t = target.createFolder(folder.getName().replace(ctx.c.prefix, ''));
  ctx.props.setProperty(key, t.getId());
  ctx.props.setProperty('twin:' + t.getId(), '1');
  markFolder_(ctx, folder);
  log_(ctx, ['folder', '', t.getName(), folder.getUrl(), t.getId(), t.getUrl(), '', '']);
  return t;
}

function parking_(ctx, root) {
  const have = ctx.props.getProperty('parking');
  if (have) return DriveApp.getFolderById(have);
  const f = root.createFolder(ctx.c.parkingName);
  ctx.props.setProperty('parking', f.getId());
  ctx.props.setProperty('twin:' + f.getId(), '1');
  return f;
}
