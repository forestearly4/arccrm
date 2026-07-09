/**
 * arcCRM API Proxy — Netlify Edge Function (Deno)
 * Runs at CDN edge with unrestricted outbound fetch.
 * Proxies: Katana MRP, ClickUp, Dropbox (metadata + file upload)
 */

const ALLOWED_HOSTS = [
  "open-api.katanamrp.com",
  "api.clickup.com",
  "api.dropboxapi.com",
  "content.dropboxapi.com",
];

function isAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let envelope;
  try {
    envelope = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { url, method = "GET", headers = {}, body: upstreamBody } = envelope;

  if (!url) return json(400, { error: "Missing url" });
  if (!isAllowed(url)) return json(403, { error: "Host not permitted: " + url });

  // Build body — base64 string = binary upload, object = JSON
  let bodyContent;
  if (upstreamBody !== undefined && upstreamBody !== null) {
    if (typeof upstreamBody === "string") {
      const binary = atob(upstreamBody);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      bodyContent = bytes.buffer;
    } else {
      bodyContent = JSON.stringify(upstreamBody);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: bodyContent,
    });
  } catch (err) {
    return json(502, { error: "Upstream fetch failed: " + err.message });
  }

  const text = await upstreamRes.text();

  return new Response(text, {
    status: upstreamRes.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
