# Hamisha

*Hamisha* (Kiswahili: "move", "transfer") moves Google Drive files to the account that should own them, every night, without anyone clicking anything.

## The problem

Google Workspace won't transfer ownership of a file to an account outside the organisation. If you create work for another business from a Workspace account, that business's files stay owned by your employer.

## How it works

A copy is owned by whoever makes it. Hamisha runs as the account that should own the files, as an Apps Script project, and once a day it:

1. Walks one root folder (plus any extra files or folders you list).
2. Copies every file owned by the old account, if nobody has edited it for 2 days, into the same folder. Files still being worked on wait for a later run.
3. For folders owned by the old account, creates a twin folder with the same name and puts the contents there.
4. Marks each original: renamed `[MOVED] …`, and Google Docs get a first line linking to the new copy, so old links still lead somewhere.
5. Mirrors link sharing. Named people with access are listed in the log for re-sharing.
6. Writes every action to a log sheet (old link → new link) and emails a short digest when anything moved.

### Clean-up (same code, run as the old owner)

Only an owner can delete a file, so the same project, deployed under the **old** account, does the clean-up. Who runs it decides the job. Each day it reads the log and trashes an original only when every check passes:

- the original is still the old owner's, marked `[MOVED]`, and not on the skip list;
- the grace period (3 days) since the copy was made has passed;
- the copy exists, isn't trashed, and the old owner doesn't own it;
- name and file type match, and nobody edited the original after it was copied;
- the content matches: Docs text, Sheets values, file size for uploads.

Emptied `[MOVED]` folders are trashed the same way. Every decision goes back into the log (*trashed*, *waiting*, or *kept: reason*). It uses the trash, not permanent deletion, so Drive keeps everything for 30 days. Set `cleanup: false` to verify and report without trashing.

Long runs pause before Apps Script's 6-minute cap and resume a minute later, skipping folders already finished in the same pass.

## Setup

```bash
cp src/Settings.example.js src/Settings.js     # fill in oldOwner and rootId
cp .clasp.json.example .clasp.sweep.json      # scriptId of a project owned by the NEW owner
cp .clasp.json.example .clasp.cleanup.json    # scriptId of a project owned by the OLD owner
clasp login --user new-owner && clasp login --user old-owner   # one named login per account
npm run deploy                                 # local gate, then clasp push to both
```

Then open each project in the Apps Script editor as its owner, run `setup()` once and approve the permissions. That installs the daily trigger and runs straight away.

`Settings.js` and `.clasp.json` are git-ignored: folder ids and accounts never reach the repo.

## Settings

| Key | Default | Meaning |
|---|---|---|
| `oldOwner` | — (required) | Account whose files should change hands |
| `rootId` | — (required) | Folder owned by the new owner; everything under it is swept |
| `extraIds` | `[]` | Files or folders outside the root to sweep into a parking folder |
| `skipIds` | `[]` | Ids never touched |
| `idleDays` | `2` | Days without edits before a file is moved |
| `runHour` | `2` | Hour of the daily run (project time zone) |
| `digest` | `true` | Email a summary when files move or are trashed |
| `logId` | — | Log sheet id; required for the clean-up role |
| `graceDays` | `3` | Days a marked original is kept after its copy is made |
| `cleanup` | `true` | `false` = verify and report only |

## Development

```bash
npm test        # node:test with in-memory Apps Script mocks, no network
bin/check       # tests, syntax, no secrets, author headers — the same gate CI runs
```

No dependencies. Node 22 or later.

## Limits

- Comments, suggestions and version history stay with the original; the copy starts fresh.
- Copies get new links. The marked originals point to them until the clean-up trashes them.
- Named sharing (specific people) is not copied automatically; the log lists who to re-share with.

Author: Vincent Wachira. MIT licence.
