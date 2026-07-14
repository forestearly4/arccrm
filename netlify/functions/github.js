/**
 * Shared GitHub file writer utility
 */
const GITHUB_API = "https://api.github.com";

async function writeGitHubFile(path, data) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO   || "forestearly4/arccrm";
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token) throw new Error("Missing GITHUB_TOKEN");

  const fileUrl = `${GITHUB_API}/repos/${repo}/contents/${path}`;
  let sha;
  try {
    const existing = await fetch(`${fileUrl}?ref=${branch}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (existing.ok) sha = (await existing.json()).sha;
  } catch (_) {}

  const content = Buffer.from(
    JSON.stringify({ ...data, updated_at: new Date().toISOString() }, null, 2)
  ).toString("base64");

  const res = await fetch(fileUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message: `arccrm: update ${path}`, content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub write ${res.status}: ${await res.text()}`);
  return res.json();
}

async function readGitHubFile(path) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO   || "forestearly4/arccrm";
  const branch = process.env.GITHUB_BRANCH || "main";
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const { content } = await res.json();
  return JSON.parse(Buffer.from(content, "base64").toString("utf8"));
}

module.exports = { writeGitHubFile, readGitHubFile };
