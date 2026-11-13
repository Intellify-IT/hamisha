/**
 * Hamisha — small helpers.
 * Author: Vincent Wachira <vwachira@opencapital.com>
 */
const TIME_UP = 'HAMISHA_TIME_UP';
const DAY_MS = 24 * 60 * 60 * 1000;

function now_() { return Date.now(); }

function tick_(ctx) { if (now_() - ctx.start > ctx.c.limitMs) throw new Error(TIME_UP); }

function isOld_(ctx, item) {
  try { return item.getOwner().getEmail() === ctx.c.oldOwner; } catch (e) { return false; }
}

function inFolder_(f, folder) {
  const it = f.getParents();
  while (it.hasNext()) if (it.next().getId() === folder.getId()) return true;
  return false;
}

function idleDays_(f) { return (now_() - f.getLastUpdated().getTime()) / DAY_MS; }
