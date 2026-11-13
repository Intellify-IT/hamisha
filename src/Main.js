/**
 * Hamisha — moves Drive files to the account running this script, by copying them.
 *
 * Why: Google Workspace blocks transferring ownership to accounts outside the organisation.
 * A copy is owned by whoever makes it, so running this as the new owner moves the files.
 *
 * Two roles, same code, decided by who runs it (see role_):
 *   - as the NEW owner: sweep — copy, mark originals, log.
 *   - as the OLD owner: clean-up — verify each logged copy, then trash the original.
 *
 * Entry points:
 *   setup()  — run once from the editor: installs the daily trigger and runs now.
 *   run()    — daily trigger: starts a fresh pass over the whole tree.
 *   resume() — scheduled by run() when a pass nears the time cap; continues the same pass.
 *
 * The sweep never deletes. The clean-up only trashes (recoverable for 30 days) verified originals. Author: Vincent Wachira <vwachira@opencapital.com>
 */

function setup() {
  const c = config_();
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyDays(1).atHour(c.runHour).create();
  run();
}

function run() { return role_(config_()) === 'cleanup' ? cleanup_(false) : sweep_(false); }
function resume() { return role_(config_()) === 'cleanup' ? cleanup_(true) : sweep_(true); }

/**
 * One sweep. A pass is the walk of the whole tree; a pass may span several executions.
 * @param {boolean} resuming continue the current pass instead of starting a new one
 * @return {{finished: boolean, moved: string[]}}
 */
function sweep_(resuming) {
  const ctx = newContext_(resuming);
  clearResumeTriggers_();
  let finished = false;
  try {
    const root = DriveApp.getFolderById(ctx.c.rootId);
    walk_(ctx, root, root, root.getName());
    ctx.c.extraIds.forEach((id) => sweepExtra_(ctx, root, id));
    finished = true;
    log_(ctx, ['pass-done', '', '', '', '', '', '', ctx.pass]);
  } catch (e) {
    if (e.message !== TIME_UP) { log_(ctx, ['ERROR', '', e.message, '', '', '', '', '']); throw e; }
    ScriptApp.newTrigger('resume').timeBased().after(60 * 1000).create();
  }
  digest_(ctx);
  return { finished: finished, moved: ctx.moved };
}

function newContext_(resuming) {
  const c = config_();
  const props = PropertiesService.getScriptProperties();
  const start = now_();
  if (!resuming || !props.getProperty('pass')) props.setProperty('pass', String(start));
  return {
    c: c,
    props: props,
    start: start,
    pass: props.getProperty('pass'),
    me: Session.getEffectiveUser().getEmail(),
    moved: [],
  };
}

function sweepExtra_(ctx, root, id) {
  const parking = parking_(ctx, root);
  // Decide by MIME type: getFolderById does not fail for a file id in Apps Script.
  const item = DriveApp.getFileById(id);
  if (item.getMimeType() === MimeType.FOLDER) walkForeign_(ctx, DriveApp.getFolderById(id), parking, parking.getName());
  else handleFile_(ctx, item, parking, parking.getName());
}

function clearResumeTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'resume')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}
