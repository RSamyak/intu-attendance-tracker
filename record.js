// The attendance record: dates, statuses, the files, and the merge.
// No DOM, storage, or network.

/** Civil dates as YYYY-MM-DD. Weekday uses UTC so a local timezone cannot shift the day. */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

export function weekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(iso) {
  const day = weekday(iso);
  return day === 0 || day === 6;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return format(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function weekSunday(iso) {
  return addDays(iso, -weekday(iso));
}

export function weekSaturday(iso) {
  return addDays(weekSunday(iso), 6);
}

export function eachDate(start, end) {
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

export function monthEnd(iso) {
  const [y, m] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m, 0));
  return format(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

export function format(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}


/**
 * A day has two independent facts: where the person was, and whether the day was an off day.
 * Stored as one token: "office", "leave", "office+holiday", "officeStar+leave".
 * "wfh" is an explicit plan to work from home. Once a day is confirmed, that token is
 * dropped: an unmarked weekday in the record is work from home, and only the plan
 * distinguishes "wfh" from an empty day.
 */

const presenceKinds = ["home", "office", "officeStar"];
const offKinds = ["none", "leave", "holiday"];

export function parseStatus(token) {
  const state = { presence: "home", off: "none" };
  if (token == null) return state;
  if (typeof token !== "string" || token === "") return null;
  if (token === "wfh") return { presence: "home", off: "none", explicit: true };
  const parts = token.split("+");
  if (parts.length > 2) return null;
  for (const part of parts) {
    if (presenceKinds.includes(part) && part !== "home" && state.presence === "home") state.presence = part;
    else if (offKinds.includes(part) && part !== "none" && state.off === "none") state.off = part;
    else return null;
  }
  return state;
}

export function formatStatus({ presence, off, explicit = false }) {
  const parts = [];
  if (presence !== "home") parts.push(presence);
  if (off !== "none") parts.push(off);
  if (parts.length) return parts.join("+");
  return explicit ? "wfh" : null;
}

export function isStatus(token) {
  return parseStatus(token) !== null;
}


export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/* ---------- shared configuration ---------- */

export function parseStatic(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Shared configuration must be an object");
  if ("users" in raw || "days" in raw || "confirmedThrough" in raw) throw new ValidationError("Shared configuration contains user data");
  if (raw.schemaVersion !== 1) throw new ValidationError("Unsupported shared configuration schemaVersion");
  if (!Array.isArray(raw.thresholds) || raw.thresholds.length === 0) throw new ValidationError("At least one threshold is required");
  const seen = new Set();
  const thresholds = raw.thresholds.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new ValidationError(`Threshold ${index + 1} is invalid`);
    if (!isDate(entry.from)) throw new ValidationError(`Threshold date ${entry.from} is invalid`);
    if (seen.has(entry.from)) throw new ValidationError(`Duplicate threshold date ${entry.from}`);
    seen.add(entry.from);
    if (!Number.isInteger(entry.daysPerWeek) || entry.daysPerWeek <= 0) throw new ValidationError(`Threshold on ${entry.from} must be a positive whole number`);
    return { from: entry.from, daysPerWeek: entry.daysPerWeek };
  }).sort((a, b) => a.from < b.from ? -1 : 1);
  return { schemaVersion: 1, thresholds, holidays: parseHolidays(raw.holidays) };
}

export function staticDocument(config) {
  return {
    schemaVersion: 1,
    thresholds: config.thresholds.map((entry) => ({ from: entry.from, daysPerWeek: entry.daysPerWeek })),
    holidays: config.holidays.map((entry) => ({ date: entry.date, name: entry.name })),
  };
}

/** Accepts ["2026-01-26"] or [{ date, name }]; returns named holidays sorted by date. */
export function parseHolidays(raw) {
  if (!Array.isArray(raw)) throw new ValidationError("Holidays must be a list");
  const seen = new Set();
  return raw.map((entry) => {
    const item = typeof entry === "string" ? { date: entry, name: "" } : entry;
    if (!isPlainObject(item) || !isDate(item.date)) throw new ValidationError(`Holiday ${JSON.stringify(entry)} needs a valid date`);
    if (item.name !== undefined && typeof item.name !== "string") throw new ValidationError(`Holiday ${item.date} has an invalid name`);
    if (seen.has(item.date)) throw new ValidationError(`Duplicate holiday ${item.date}`);
    seen.add(item.date);
    return { date: item.date, name: (item.name ?? "").trim() };
  }).sort((a, b) => a.date < b.date ? -1 : 1);
}

/** Reads a pasted year list: a JSON array, or one "YYYY-MM-DD Name" per line. */
export function parseHolidayList(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new ValidationError("The holiday list is empty");
  if (trimmed.startsWith("[")) return parseHolidays(JSON.parse(trimmed));
  const entries = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})(?:[\s,;:\t|–-]+(.*))?$/);
    if (!match) throw new ValidationError(`Cannot read holiday line: ${line}`);
    return { date: match[1], name: match[2] ?? "" };
  });
  return parseHolidays(entries);
}

/** Adds or renames one holiday. */
export function upsertHoliday(config, date, name) {
  if (!isDate(date)) throw new ValidationError(`Holiday date ${date} is invalid`);
  const others = config.holidays.filter((entry) => entry.date !== date);
  return parseStatic(staticDocument({ ...config, holidays: [...others, { date, name: String(name ?? "") }] }));
}

export function removeHoliday(config, date) {
  if (!config.holidays.some((entry) => entry.date === date)) throw new ValidationError(`No holiday on ${date}`);
  return parseStatic(staticDocument({ ...config, holidays: config.holidays.filter((entry) => entry.date !== date) }));
}

/** Replaces one calendar year's holidays; other years are untouched. */
export function replaceHolidayYear(config, year, holidays) {
  const prefix = `${year}-`;
  const stray = holidays.find((entry) => !entry.date.startsWith(prefix));
  if (stray) throw new ValidationError(`${stray.date} is outside ${year}`);
  const kept = config.holidays.filter((entry) => !entry.date.startsWith(prefix));
  return parseStatic(staticDocument({ ...config, holidays: [...kept, ...holidays] }));
}

/* ---------- user document ---------- */

const USER_FIELDS = ["schemaVersion", "id", "name", "countOfficeStar", "countPlanned", "confirmedThrough", "days", "notes"];
const NOTE_KEYS = {
  days: (key) => isDate(key),
  weeks: (key) => isDate(key) && weekday(key) === 0,
  months: (key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key),
};

export function parseUser(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("User document must be an object");
  if ("thresholds" in raw || "holidays" in raw) throw new ValidationError("User document contains shared configuration");
  if (raw.schemaVersion !== 1) throw new ValidationError("Unsupported user schemaVersion");
  if (!Number.isInteger(raw.id) || raw.id < 1) throw new ValidationError("User id must be a positive integer");
  if (typeof raw.name !== "string") throw new ValidationError("Name must be text");
  if (raw.confirmedThrough !== null && !isDate(raw.confirmedThrough)) throw new ValidationError("confirmedThrough must be a date or null");
  if (!isPlainObject(raw.days)) throw new ValidationError("days must be an object");
  const days = {};
  for (const [iso, token] of Object.entries(raw.days)) {
    if (!isDate(iso)) throw new ValidationError(`Day ${iso} is not a valid date`);
    const state = parseStatus(token);
    if (state === null) throw new ValidationError(`Unknown status ${token} on ${iso}`);
    const canonical = formatStatus(state);
    if (canonical) days[iso] = canonical;
  }
  const preserved = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!USER_FIELDS.includes(key)) preserved[key] = value;
  }
  return {
    ...preserved,
    schemaVersion: 1,
    id: raw.id,
    name: raw.name.trim(),
    countOfficeStar: raw.countOfficeStar === true,
    countPlanned: raw.countPlanned === true,
    confirmedThrough: raw.confirmedThrough,
    days,
    notes: parseNotes(raw.notes),
  };
}

export function parseNotes(raw) {
  const notes = emptyNotes();
  if (raw === undefined) return notes;
  if (!isPlainObject(raw)) throw new ValidationError("notes must be an object");
  for (const scope of Object.keys(raw)) {
    if (!(scope in NOTE_KEYS)) throw new ValidationError(`Unknown note scope ${scope}`);
    if (!isPlainObject(raw[scope])) throw new ValidationError(`notes.${scope} must be an object`);
    for (const [key, text] of Object.entries(raw[scope])) {
      if (!NOTE_KEYS[scope](key)) throw new ValidationError(`Note key ${key} is not valid for ${scope}`);
      if (typeof text !== "string") throw new ValidationError(`Note on ${key} must be text`);
      if (text.trim()) notes[scope][key] = text.trim();
    }
  }
  return notes;
}

export function emptyNotes() {
  return { days: {}, weeks: {}, months: {} };
}

export function userDocument(user) {
  const preserved = {};
  for (const [key, value] of Object.entries(user)) {
    if (!USER_FIELDS.includes(key)) preserved[key] = value;
  }
  return {
    ...preserved,
    schemaVersion: 1,
    id: user.id,
    name: user.name,
    countOfficeStar: user.countOfficeStar,
    countPlanned: user.countPlanned,
    confirmedThrough: user.confirmedThrough,
    days: sorted(user.days),
    notes: { days: sorted(user.notes.days), weeks: sorted(user.notes.weeks), months: sorted(user.notes.months) },
  };
}

export function createUser(id, name = "") {
  return parseUser({ schemaVersion: 1, id, name, countOfficeStar: false, countPlanned: false, confirmedThrough: null, days: {}, notes: emptyNotes() });
}

export function usersDocument(list) {
  return { schemaVersion: 1, users: list.map(userDocument) };
}

export function parseUsers(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Attendance file must be an object");
  if (raw.schemaVersion !== 1) throw new ValidationError("Unsupported attendance file schemaVersion");
  if (!Array.isArray(raw.users) || raw.users.length === 0) throw new ValidationError("Attendance file needs at least one user");
  const seen = new Set();
  return raw.users.map((entry) => {
    const parsed = parseUser(entry);
    if (seen.has(parsed.id)) throw new ValidationError(`Duplicate user ${parsed.id}`);
    seen.add(parsed.id);
    return parsed;
  });
}

/* ---------- edits ---------- */

export function setDay(user, iso, token) {
  if (!isDate(iso)) throw new ValidationError(`Day ${iso} is not a valid date`);
  const state = parseStatus(token);
  if (state === null) throw new ValidationError(`Unknown status ${token}`);
  const days = { ...user.days };
  const canonical = formatStatus(state);
  if (canonical === null) delete days[iso];
  else days[iso] = canonical;
  return { ...user, days };
}

export function setNote(user, scope, key, text) {
  if (!(scope in NOTE_KEYS)) throw new ValidationError(`Unknown note scope ${scope}`);
  if (!NOTE_KEYS[scope](key)) throw new ValidationError(`Note key ${key} is not valid for ${scope}`);
  if (typeof text !== "string") throw new ValidationError("A note must be text");
  const map = { ...user.notes[scope] };
  if (text.trim()) map[key] = text.trim();
  else delete map[key];
  return { ...user, notes: { ...user.notes, [scope]: map } };
}

export function confirmThrough(user, iso, today) {
  if (!isDate(iso) || !isDate(today)) throw new ValidationError("Confirmation requires valid dates");
  if (iso > today) throw new ValidationError("A future date cannot be confirmed");
  if (user.confirmedThrough && iso <= user.confirmedThrough) throw new ValidationError("Confirmation must move forward");
  const days = { ...user.days };
  for (const date of Object.keys(days)) {
    if (date <= iso && days[date] === "wfh") delete days[date];
  }
  return { ...user, confirmedThrough: iso, days };
}

export function reopenThrough(user, iso) {
  if (iso !== null && !isDate(iso)) throw new ValidationError("Reopen requires a date or null");
  if (!user.confirmedThrough) throw new ValidationError("Nothing is confirmed");
  if (iso !== null && iso >= user.confirmedThrough) throw new ValidationError("Reopen must move backward");
  return { ...user, confirmedThrough: iso };
}

export function unconfirmedPastDates(user, today) {
  if (!user.confirmedThrough) return null;
  const start = addDays(user.confirmedThrough, 1);
  const yesterday = addDays(today, -1);
  if (start > yesterday) return [];
  return eachDate(start, yesterday);
}

/* ---------- helpers ---------- */

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sorted(map) {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a < b ? -1 : 1));
}


export function thresholdFor(staticConfig, iso) {
  let current = null;
  for (const entry of staticConfig.thresholds) {
    if (entry.from <= iso) current = entry.daysPerWeek;
  }
  if (current == null) throw new Error(`No threshold is in force on ${iso}`);
  return current;
}

export function dayFacts(staticConfig, user, iso) {
  const token = user.days[iso] ?? null;
  const { presence, off } = parseStatus(token);
  const weekend = isWeekend(iso);
  const shared = staticConfig.holidays.find((entry) => entry.date === iso) ?? null;
  const holiday = shared !== null || off === "holiday";
  const onLeave = off === "leave";
  const confirmed = Boolean(user.confirmedThrough) && compare(iso, user.confirmedThrough) <= 0;
  const counted = presence === "office" || (presence === "officeStar" && user.countOfficeStar);
  return {
    date: iso,
    status: token,
    presence,
    off,
    weekend,
    holiday,
    holidayName: shared ? shared.name : null,
    onLeave,
    eligible: !weekend && !holiday && !onLeave,
    counted,
    confirmed,
  };
}

/**
 * Current method: the Sunday–Saturday week that contains `iso` plus the three weeks before it.
 * `view.today` splits counted days into done (on or before today) and planned (after today);
 * `view.countPlanned` adds planned days to the count (the sheet's "Planned" switch); the default counts done days only.
 */
export function rolling(staticConfig, user, iso, view = {}) {
  const end = weekSaturday(iso);
  const start = weekSunday(addDays(end, -21));
  return summarize(staticConfig, user, start, end, "rolling", view);
}

/** Legacy method: the calendar month that contains `iso`. */
export function month(staticConfig, user, iso, view = {}) {
  return summarize(staticConfig, user, monthStart(iso), monthEnd(iso), "month", view);
}

export function expectedFor(eligible, daysPerWeek, formula) {
  return formula === "month"
    ? ceilDiv(eligible * daysPerWeek, 5)
    : roundDivHalfAway(eligible * daysPerWeek, 5);
}

export function summarize(staticConfig, user, start, end, formula, view) {
  const facts = eachDate(start, end).map((iso) => dayFacts(staticConfig, user, iso));
  const eligible = facts.filter((day) => day.eligible).length;
  const isDone = (day) => view.today == null || day.date <= view.today;
  const confirmedCounted = facts.filter((day) => day.counted && day.confirmed).length;
  const doneCounted = facts.filter((day) => day.counted && isDone(day)).length;
  const plannedCounted = facts.filter((day) => day.counted && !isDone(day)).length;
  const counted = view.countPlanned ? doneCounted + plannedCounted : doneCounted;
  const daysPerWeek = thresholdFor(staticConfig, end);
  const expected = expectedFor(eligible, daysPerWeek, formula);
  const needed = Math.max(0, expected - counted);
  return {
    formula,
    start,
    end,
    daysPerWeek,
    eligible,
    counted,
    confirmedCounted,
    doneCounted,
    plannedCounted,
    expected,
    needed,
    perWeek: expected === 0 ? null : roundDivHalfAway(daysPerWeek * counted * 10, expected) / 10,
  };
}

export function roundDivHalfAway(numerator, denominator) {
  const negative = numerator < 0;
  const n = Math.abs(numerator);
  const q = Math.floor(n / denominator);
  const remainder = n % denominator;
  const rounded = remainder * 2 >= denominator ? q + 1 : q;
  return negative ? -rounded : rounded;
}

export function ceilDiv(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator);
}

/* ---------- the known starting record, and the merge ---------- */

const STARTER = {
  schemaVersion: 1,
  users: [{
    schemaVersion: 1,
    id: 1,
    name: "",
    countOfficeStar: false,
    countPlanned: false,
    confirmedThrough: null,
    days: {},
    notes: { days: {}, weeks: {}, months: {} },
  }],
};

/** The blank attendance file a new repo and a new browser both start from. */
export function starterUsers() {
  return parseUsers(STARTER);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (map, key) => map != null && Object.hasOwn(map, key);

function mergeLeaf(base, local, remote) {
  if (same(local, remote)) return { value: local, conflict: false };
  if (same(local, base)) return { value: remote, conflict: false };
  if (same(remote, base)) return { value: local, conflict: false };
  return { value: remote, conflict: true };
}

/** Keys added on one side stay.  A key both sides changed keeps the repo's value. */
function mergeMap(base, local, remote, label, notices) {
  base ??= {};
  local ??= {};
  remote ??= {};
  const out = {};
  let conflicts = 0;
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = has(base, key);
    const l = has(local, key);
    const r = has(remote, key);
    if (l && r && same(local[key], remote[key])) out[key] = local[key];
    else if (l && r) {
      if (b && same(base[key], local[key])) out[key] = remote[key];
      else if (b && same(base[key], remote[key])) out[key] = local[key];
      else {
        out[key] = remote[key];
        conflicts += 1;
      }
    } else if (l && !r) {
      if (!b) out[key] = local[key];
      else if (!same(base[key], local[key])) conflicts += 1;
    } else if (!l && r) {
      if (!b) out[key] = remote[key];
      else if (!same(base[key], remote[key])) {
        out[key] = remote[key];
        conflicts += 1;
      }
    }
  }
  if (conflicts) notices.push(`${label}: kept the repo's copy for ${conflicts} ${conflicts === 1 ? "entry" : "entries"}`);
  return out;
}

function extras(user) {
  const out = {};
  for (const [key, value] of Object.entries(user)) if (!USER_FIELDS.includes(key)) out[key] = value;
  return out;
}

function mergeUser(base, local, remote, name, notices) {
  const days = mergeMap(base.days, local.days, remote.days, `${name}: days`, notices);
  const notes = {
    days: mergeMap(base.notes.days, local.notes.days, remote.notes.days, `${name}: day notes`, notices),
    weeks: mergeMap(base.notes.weeks, local.notes.weeks, remote.notes.weeks, `${name}: week notes`, notices),
    months: mergeMap(base.notes.months, local.notes.months, remote.notes.months, `${name}: month notes`, notices),
  };
  const scalars = {};
  let settings = false;
  for (const field of ["name", "countOfficeStar", "countPlanned", "confirmedThrough"]) {
    const merged = mergeLeaf(base[field], local[field], remote[field]);
    scalars[field] = merged.value;
    settings ||= merged.conflict;
  }
  if (settings) notices.push(`${name}: kept the repo's settings`);
  const preserved = mergeMap(extras(base), extras(local), extras(remote), `${name}: other fields`, notices);
  return parseUser({ schemaVersion: 1, id: local.id, ...preserved, ...scalars, days, notes });
}

function mergeUsers(baseList, localList, remoteList, notices) {
  const base = new Map(baseList.map((user) => [user.id, user]));
  const local = new Map(localList.map((user) => [user.id, user]));
  const remote = new Map(remoteList.map((user) => [user.id, user]));
  const out = [];
  for (const id of [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort((a, b) => a - b)) {
    const b = base.get(id) ?? null;
    const l = local.get(id) ?? null;
    const r = remote.get(id) ?? null;
    const name = l?.name || r?.name || b?.name || `User ${id}`;
    if (l && r) {
      out.push(mergeUser(b ?? createUser(id), l, r, name, notices));
    } else if (l && !r) {
      if (!b) out.push(l);
      else if (same(userDocument(b), userDocument(l))) notices.push(`${name} was removed on the repo`);
      else notices.push(`${name} differed, and the repo's removal was kept`);
    } else if (!l && r) {
      if (!b) out.push(r);
      else if (same(userDocument(b), userDocument(r))) notices.push(`${name} was removed on this device`);
      else {
        notices.push(`${name} was removed here and changed on the repo, so the repo's copy was kept`);
        out.push(r);
      }
    }
  }
  return out.length ? out : (remoteList.length ? remoteList : localList);
}

function column(list, key, value) {
  return Object.fromEntries(list.map((entry) => [entry[key], entry[value]]));
}

function mergeShared(base, local, remote, notices) {
  const thresholds = mergeMap(column(base.thresholds, "from", "daysPerWeek"), column(local.thresholds, "from", "daysPerWeek"), column(remote.thresholds, "from", "daysPerWeek"), "Thresholds", notices);
  const holidays = mergeMap(column(base.holidays, "date", "name"), column(local.holidays, "date", "name"), column(remote.holidays, "date", "name"), "Holidays", notices);
  return parseStatic({
    schemaVersion: 1,
    thresholds: Object.entries(thresholds).map(([from, daysPerWeek]) => ({ from, daysPerWeek })),
    holidays: Object.entries(holidays).map(([date, name]) => ({ date, name })),
  });
}

/**
 * Three documents: what this device last synced, what it holds now, and what the repo holds now.
 * A missing repo file is `null`.  Where both sides changed the same thing, the repo wins.
 * `writeUsers` and `writeShared` say whether the merged result differs from the repo.
 */
export function reconcile({ localUsers, remoteUsers, baseUsers, localShared, remoteShared, baseShared }) {
  const notices = [];
  const users = remoteUsers ? mergeUsers(baseUsers, localUsers, remoteUsers, notices) : localUsers;
  const shared = remoteShared ? mergeShared(baseShared, localShared, remoteShared, notices) : localShared;
  return {
    users,
    shared,
    notices,
    writeUsers: !remoteUsers || !same(usersDocument(users), usersDocument(remoteUsers)),
    writeShared: remoteShared ? !same(staticDocument(shared), staticDocument(remoteShared)) : !same(staticDocument(shared), staticDocument(baseShared)),
  };
}


