import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createUser, parseUsers, reconcile, starterUsers, userDocument, usersDocument } from "./record.js";

const sample = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)));
const blank = () => starterUsers();
const day = (token, extra = {}) => users([{ ...person(), days: { "2026-10-05": token }, ...extra }]);
const person = (over = {}) => userDocument({ ...createUser(1), name: "Asha", ...over });
const users = (list) => parseUsers({ schemaVersion: 1, users: list });

const shared = (holidays = [], thresholds = [{ from: "2023-09-01", daysPerWeek: 2 }]) => ({
  schemaVersion: 1,
  thresholds,
  holidays,
});

test("the shipped example round-trips, and the blank starter is a fresh user", () => {
  const parsed = parseUsers(sample);
  assert.equal(JSON.stringify(usersDocument(parseUsers(usersDocument(parsed)))), JSON.stringify(usersDocument(parsed)));
  assert.deepEqual(userDocument(starterUsers()[0]), userDocument(createUser(1)));
});

test("an unknown field on a user survives a save", () => {
  const parsed = parseUsers({ schemaVersion: 1, users: [{ ...person(), nickname: "Ace" }] });
  assert.equal(usersDocument(parsed).users[0].nickname, "Ace");
});

test("a device with the record and a repo still on the starter keeps the record", () => {
  const local = day("office");
  const result = reconcile({ localUsers: local, remoteUsers: blank(), baseUsers: blank(), localShared: shared(), remoteShared: shared(), baseShared: shared() });
  assert.equal(result.users[0].days["2026-10-05"], "office");
  assert.equal(result.writeUsers, true);
  assert.equal(result.writeShared, false);
  assert.deepEqual(result.notices, []);
});

test("a fresh device takes the repo and does not write the blank user back", () => {
  const remote = day("office");
  const result = reconcile({ localUsers: blank(), remoteUsers: remote, baseUsers: blank(), localShared: shared(), remoteShared: shared(), baseShared: shared() });
  assert.equal(result.users[0].days["2026-10-05"], "office");
  assert.equal(result.writeUsers, false);
  assert.deepEqual(result.notices, []);
});

test("days changed on different dates both stay, and the same date keeps the repo", () => {
  const base = day("office");
  const local = users([{ ...person(), days: { "2026-10-05": "leave", "2026-10-06": "office" } }]);
  const remote = users([{ ...person(), days: { "2026-10-05": "officeStar", "2026-10-07": "wfh" } }]);
  const result = reconcile({ localUsers: local, remoteUsers: remote, baseUsers: base, localShared: shared(), remoteShared: shared(), baseShared: shared() });
  assert.deepEqual(result.users[0].days, { "2026-10-05": "officeStar", "2026-10-06": "office", "2026-10-07": "wfh" });
  assert.equal(result.writeUsers, true);
  assert.equal(result.notices.length, 1);
});

test("a note added here and a confirmation moved only on the repo both stay", () => {
  const base = day("office", { confirmedThrough: "2026-10-01", notes: { days: {}, weeks: {}, months: {} } });
  const local = day("office", { confirmedThrough: "2026-10-01", notes: { days: { "2026-10-05": "In for the review" }, weeks: {}, months: {} } });
  const remote = day("office", { confirmedThrough: "2026-10-08", notes: { days: {}, weeks: {}, months: {} } });
  const result = reconcile({ localUsers: local, remoteUsers: remote, baseUsers: base, localShared: shared(), remoteShared: shared(), baseShared: shared() });
  assert.equal(result.users[0].notes.days["2026-10-05"], "In for the review");
  assert.equal(result.users[0].confirmedThrough, "2026-10-08");
  assert.deepEqual(result.notices, []);
});

test("a holiday added here is kept, and a holiday both sides renamed keeps the repo", () => {
  const base = shared([{ date: "2026-10-02", name: "Gandhi Jayanti" }]);
  const local = shared([{ date: "2026-10-02", name: "Gandhi Jayanti holiday" }, { date: "2026-10-14", name: "Local holiday" }]);
  const remote = shared([{ date: "2026-10-02", name: "Gandhi Jayanti, observed" }]);
  const result = reconcile({ localUsers: blank(), remoteUsers: blank(), baseUsers: blank(), localShared: local, remoteShared: remote, baseShared: base });
  assert.deepEqual(result.shared.holidays, [
    { date: "2026-10-02", name: "Gandhi Jayanti, observed" },
    { date: "2026-10-14", name: "Local holiday" },
  ]);
  assert.equal(result.writeShared, true);
  assert.equal(result.notices.length, 1);
});

test("a missing shared file is written only once this device has edits", () => {
  const base = shared();
  const quiet = reconcile({ localUsers: blank(), remoteUsers: blank(), baseUsers: blank(), localShared: base, remoteShared: null, baseShared: base });
  const edited = reconcile({ localUsers: blank(), remoteUsers: blank(), baseUsers: blank(), localShared: shared([], [{ from: "2023-09-01", daysPerWeek: 3 }]), remoteShared: null, baseShared: base });
  assert.equal(quiet.writeShared, false);
  assert.equal(edited.writeShared, true);
});
