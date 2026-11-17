/**
 * Module: tests/claude-settings.test.js
 * Description: #1 done-test: .claude/settings.json follows Vincent's rule 2 (17 Nov, "ask, not deny"; home-north
 *              standards/working-rules.md): deny holds only secret reads/prints, force-push, hook bypass and mass
 *              kill; admin merge, rm -rf on / or ~, gcloud delete/IAM/deploy and bin/release prod are asks.
 * Author: Vincent Wachira
 * Created: 2026-11-17
 * Last Modified: 2026-11-17
 * Version: 1.1.0
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const B = ["Bash(gcloud secrets versions access*)", "Bash(gcloud auth print-*)", "Bash(gh auth token*)",
  "Bash(security find-generic-password*)", "Bash(security find-internet-password*)", "Bash(printenv*)",
  "Bash(env)", "Bash(op read*)", "Bash(op item get*)", "Bash(vault read*)", "Bash(vault kv get*)",
  "Bash(kubectl get secret*)", "Bash(aws secretsmanager get-secret-value*)"];
const C = ["Bash(git *push *--force*)", "Bash(git *push -f*)", "Bash(git *push * -f*)", "Bash(git *push * +*)"];
const D = ["Bash(git * --no-verify*)", "Bash(git *commit -n*)", "Bash(git *-c core.hooks*)"];
const E = ["Bash(pkill:*)", "Bash(killall:*)", "Bash(kill -9 -1)"];
const EXTRA = ["Bash(gcloud secrets versions access *)", "Bash(git push --force*)", "Bash(git push -f*)",
  "Bash(git push * --force*)", "Bash(git push * -f*)", "Bash(git push --force-with-lease*)",
  "Bash(git -C * push --force*)"];
const ASK = ["Bash(gh pr merge * --admin*)", "Bash(rm -*r* /*)", "Bash(rm -*r* ~*)", "Bash(rm -*r* $HOME*)",
  "Bash(gcloud * delete *)", "Bash(gcloud * add-iam-policy-binding*)", "Bash(gcloud iam *)",
  "Bash(gcloud *run *deploy*)", "Bash(gcloud *run *update*)", "Bash(*bin/release prod*)",
  "Bash(gcloud * remove-iam-policy-binding*)", "Bash(git push * main)", "Bash(git push * HEAD:main)",
  "Bash(git push * master)", "Bash(git push * HEAD:master)"];
const SECRET = /\.env|\.pem|\.key\b|\.p12|\.pfx|id_|\.ssh|secrets\/|credentials|\.docker\/config\.json|gcloud|\.aws|-key\.json|_key\.json/;

const load = () => {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".claude", "settings.json"), "utf8"));
  return { deny: s.permissions?.deny ?? [], ask: s.permissions?.ask ?? [] };
};
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// `*` = any text, whole string; a trailing `:*` = the prefix alone or the prefix + " ...".
const hit = (rule, cmd) => {
  const m = /^Bash\(([\s\S]*)\)$/.exec(rule);
  if (!m) return false;
  const pat = m[1];
  if (pat.endsWith(":*")) { const pre = pat.slice(0, -2); return cmd === pre || cmd.startsWith(pre + " "); }
  return new RegExp("^" + pat.split("*").map(esc).join("[\\s\\S]*") + "$").test(cmd);
};
const refused = (s, c) => s.deny.some((r) => hit(r, c));
const asked = (s, c) => s.ask.some((r) => hit(r, c));

test("1. deny holds B-E and only secret / force-push / hook-bypass / mass-kill rules", () => {
  const s = load();
  assert.deepEqual([...B, ...C, ...D, ...E].filter((r) => !s.deny.includes(r)), []);
  for (const r of ["Read(*.key)", "Read(~/.aws/**)"]) assert.ok(s.deny.includes(r), `secret file rule missing: ${r}`);
  const allowed = new Set([...B, ...C, ...D, ...E, ...EXTRA]);
  assert.deepEqual(s.deny.filter((r) => !allowed.has(r) && !(/^(Read|Edit|Write)\(.*\)$/.test(r) && SECRET.test(r))), []);
});

test("2. the loose commit -n glob is gone; a -n inside the -m text is not refused", () => {
  const s = load();
  for (const r of ["Bash(git *commit * -n*)", "Bash(git *push -*f *)", "Bash(git *push *+*)"]) {
    assert.ok(![...s.deny, ...s.ask].includes(r), `still listed: ${r}`);
  }
  assert.equal(refused(s, 'git commit -m "fix the -n flag"'), false);
});

test("3. the 15 ask rules are asks and their commands are not refused", () => {
  const s = load();
  assert.deepEqual(ASK.filter((r) => !s.ask.includes(r)), []);
  for (const c of ["rm -rf ~/Downloads/x", "gcloud iam service-accounts list", "gh pr merge 5 --admin --squash",
    "gcloud projects delete x", "bin/release prod",
    "gcloud projects remove-iam-policy-binding p --member=x --role=y", "git push origin main",
    "git push -u origin claude/fix-pdf main"]) {
    assert.equal(refused(s, c), false, `refused: ${c}`);
    assert.equal(asked(s, c), true, `not asked: ${c}`);
  }
});

test("4. force-push, hook bypass, secret prints and mass kill are refused", () => {
  const s = load();
  for (const c of ["git push --force origin x", "git -C ../wt push -f origin x", "git commit --no-verify -m x",
    "printenv", "gh auth token", "pkill node", "killall node", "security find-generic-password -s x -w", "git push origin +main"]) {
    assert.equal(refused(s, c), true, `not refused: ${c}`);
  }
});

test("5. everyday commands are neither refused nor asked", () => {
  const s = load();
  for (const c of ["git status", "git commit -m x", "git push -u origin claude/x", "bin/check --fast",
    "git push origin c++-fix", "git push -u origin claude/fix-pdf"]) {
    assert.equal(refused(s, c) || asked(s, c), false, `guarded: ${c}`);
  }
});
