/**
 * Hamisha — configuration.
 * Defaults live here; account-specific values (folder ids, owner) live in Settings.js,
 * which clasp pushes but git ignores (see Settings.example.js). Nothing private is committed.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */
const DEFAULTS = Object.freeze({
  oldOwner: '',          // the account whose files must change hands, e.g. a work account
  rootId: '',            // folder the new owner owns; everything under it is swept
  extraIds: [],          // files or folders outside the root that are also swept
  skipIds: [],           // ids never touched (e.g. a doc a client is still filling in)
  idleDays: 2,           // only files untouched this long are moved, so live work isn't disrupted
  runHour: 2,            // daily run hour, in the project's time zone
  limitMs: 5 * 60 * 1000, // stop before Apps Script's 6-minute cap and resume shortly after
  prefix: '[MOVED] ',    // marks an original that has been replaced by a copy
  parkingName: '00 Moved here',
  logName: 'Hamisha · ownership log',
  digest: true,          // email the owner a short list when anything moved
  // Clean-up role (runs as oldOwner): trash originals once their copies are verified.
  logId: '',             // id of the log sheet the sweep writes; required for clean-up
  cleanup: true,         // set false to verify and report without trashing anything
  graceDays: 3,          // keep a marked original this long after its copy was made
  editMarginMs: 10 * 60 * 1000, // marking the original right after copying is not an edit
  maxSheetCells: 200000, // above this, sheets are compared by shape instead of every value
});

/** Merged, validated config. SETTINGS comes from Settings.js. */
function config_() {
  const s = (typeof SETTINGS === 'object' && SETTINGS) ? SETTINGS : {};
  const c = Object.assign({}, DEFAULTS, s);
  if (!c.oldOwner || !c.rootId) throw new Error('Hamisha: set oldOwner and rootId in Settings.js');
  return c;
}

/** Who is running decides the job: the old owner cleans up, anyone else sweeps. */
function role_(c) {
  return Session.getEffectiveUser().getEmail() === c.oldOwner ? 'cleanup' : 'sweep';
}
