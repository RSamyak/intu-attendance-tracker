import test from "node:test";
import assert from "node:assert/strict";
import { createRemote, RemoteError } from "./github.js";

function github() {
  const files = new Map();
  const request = async (url, { method = "GET", body, headers }) => {
    assert.equal(headers.Authorization, "Bearer t0ken");
    const path = new URL(url).pathname.replace("/repos/o/r", "");
    const reply = (status, value) => ({ ok: status < 300, status, statusText: "", json: async () => value });
    if (path === "" && method === "GET") return reply(200, { default_branch: "main" });
    if (method === "GET" && path.startsWith("/contents/")) {
      const file = files.get(path.slice("/contents/".length));
      return file ? reply(200, file) : reply(404, { message: "Not Found" });
    }
    if (method === "PUT") {
      request.sent = JSON.parse(body);
      const sha = `s${files.size + 1}`;
      files.set(path.slice("/contents/".length), { sha, content: request.sent.content });
      return reply(201, { content: { sha } });
    }
    return reply(404, { message: "Not Found" });
  };
  return request;
}

test("a file goes up and comes back unchanged, whatever the script", async () => {
  const remote = createRemote({ repo: "o/r", token: "t0ken" }, github());
  const text = '{"name":"Phở ₹"}\n';
  assert.equal(await remote.read("attendance.json"), null);
  const sha = await remote.write("attendance.json", text, "attendance record");
  const back = await remote.read("attendance.json");
  assert.equal(back.sha, sha);
  assert.equal(back.text, text);
});

test("a named author is written as both author and committer", async () => {
  const request = github();
  const remote = createRemote({ repo: "o/r", token: "t0ken" }, request);
  const person = { name: "Asha", email: "asha@attendance.invalid" };
  await remote.write("attendance.json", "{}\n", "attendance record", "old", person);
  assert.equal(request.sent.sha, "old");
  assert.deepEqual(request.sent.author, person);
  assert.deepEqual(request.sent.committer, person);
});

test("failures carry the status", async () => {
  const remote = createRemote({ repo: "o/r", token: "t0ken" }, async () => ({ ok: false, status: 401, statusText: "", json: async () => ({ message: "Bad credentials" }) }));
  await assert.rejects(remote.probe(), (error) => error instanceof RemoteError && error.status === 401);
});
