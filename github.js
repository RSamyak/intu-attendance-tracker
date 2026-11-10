// A private GitHub repo as two files, through GitHub's contents API.

export class RemoteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const encode = (text) => btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(""));
const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

export function createRemote({ repo, token }, request = fetch) {
  async function api(path, { missing = false, ...init } = {}) {
    const response = await request(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (response.status === 404 && missing) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new RemoteError(response.status, body.message ?? response.statusText);
    return body;
  }

  return {
    // Confirms the token can see the repo.  A missing file is a different question.
    probe: () => api(""),
    // The file's text and blob sha, or null when the repo has no such file.
    async read(path) {
      const body = await api(`/contents/${path}`, { missing: true });
      return body && { sha: body.sha, text: decode(body.content) };
    },
    // Creates the file, or replaces it when `sha` is its current sha.  Returns the new sha.
    // `author` is { name, email }.  It is both author and committer, so the history names that person
    // rather than the account that owns the token.
    async write(path, text, message, sha, author) {
      const payload = { message, content: encode(text), ...(sha && { sha }), ...(author && { author, committer: author }) };
      return (await api(`/contents/${path}`, { method: "PUT", body: JSON.stringify(payload) })).content.sha;
    },
  };
}
