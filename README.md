# Attendance

A weekly office-attendance quota, kept in the browser.  Live at [rsamyak.github.io/intu-attendance-tracker](https://rsamyak.github.io/intu-attendance-tracker/).

Save downloads every user.  Load reads that file back.  `sample.json` is a short example.  Shared holidays and the quota start inside the page.  Edits stay in this browser until exported or synced.  With no repo connected, the page makes no network calls.

## Sync

The record lives in a private repo made from [intu-attendance-tracker-template-data](https://github.com/RSamyak/intu-attendance-tracker-template-data).  Use the template and choose Private.  A fork of the public repo cannot be made private.

1. Make a fine-grained token for that one repo, with Contents read and write.
2. Open Admin, Sync.  Paste `owner/repo` and the token, then Connect.  Pasting a share link into either field fills both.
3. The first sync merges this browser with the repo.  The blank files shipped in the template are the base.  Where both sides changed the same day, note, or setting, the repo's copy is kept, and the page says so.
4. Later edits are sent a few seconds after you stop.  The header reads Local only, Synced, To send, Offline, or Sync failed.

`attendance.json` is every user, the same file Save downloads.  `shared.json` is the thresholds and holidays.  It is written once they differ from the copy built into the page.

Share link sends the repo and the token to another device.  The token sits after `#`, so it is not sent to a server.  On iPhone, open the link in Safari and add it to the Home Screen.  The icon keeps the link.  Name on commits is the label on those commits.

Disconnect leaves the record on this device.  Reset clears it here, and a connected repo is fetched again afterwards.

## Files

- `index.html`: the page.
- `record.js`: the record and the merge, with no DOM, storage, or network.
- `github.js`: the private repo, through GitHub's contents API.

## Test

```sh
node --test
```
