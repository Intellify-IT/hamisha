/**
 * Hamisha — log sheet (old link → new link) and the daily digest email.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */
const LOG_HEADER = ['Action', 'Path', 'Title', 'Old link', 'New ID', 'New link',
  'Others with access (re-share if needed)', 'Link sharing / note', 'Logged', 'Clean-up', 'Clean-up date'];

function logSheet_(ctx) {
  if (ctx.sheet) return ctx.sheet;
  const id = ctx.props.getProperty('log');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(ctx.c.logName);
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(ctx.c.rootId));
    const s = ss.getSheets()[0];
    s.appendRow(LOG_HEADER);
    s.setFrozenRows(1);
    ctx.props.setProperty('log', ss.getId());
  }
  ctx.sheet = ss.getSheets()[0];
  ctx.logUrl = ss.getUrl();
  return ctx.sheet;
}

function log_(ctx, row) {
  const r = row.slice(0, 8);
  r[8] = new Date(now_());
  logSheet_(ctx).appendRow(r);
}

function digest_(ctx) {
  if (!ctx.c.digest || !ctx.moved.length) return;
  logSheet_(ctx);
  MailApp.sendEmail(ctx.me,
    'Hamisha: ' + ctx.moved.length + ' file(s) moved to your Drive',
    ctx.moved.join('\n') + '\n\nLog: ' + ctx.logUrl);
}
