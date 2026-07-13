/**
 * arcCRM Sync Function
 * Runs @hourly (scheduled) AND on-demand via GET /.netlify/functions/sync
 *
 * Calls Katana REST API directly — no CORS issues server-side.
 * Writes katana-data.json to GitHub repo.
 * arcCRM reads that static file — zero browser CORS issues ever.
 */

const KATANA_BASE = "https://api.katanamrp.com/v1";
const GITHUB_API  = "https://api.github.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function katanaGet(path, apiKey) {
  const r = await fetch(KATANA_BASE + path, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) throw new Error(`Katana ${r.status} on ${path}: ${r.statusText}`);
  return r.json();
}

async function writeToGitHub(data) {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO   || "forestearly4/arccrm";
  const branch = process.env.GITHUB_BRANCH || "main";
  const path   = "katana-data.json";

  if (!token) throw new Error("Missing GITHUB_TOKEN env var");

  const fileUrl = `${GITHUB_API}/repos/${repo}/contents/${path}`;

  // Get existing SHA so GitHub lets us update
  let sha;
  try {
    const existing = await fetch(`${fileUrl}?ref=${branch}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (existing.ok) sha = (await existing.json()).sha;
  } catch (_) {}

  const content = Buffer.from(
    JSON.stringify({ ...data, synced_at: new Date().toISOString() }, null, 2)
  ).toString("base64");

  const res = await fetch(fileUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `sync: Katana data ${new Date().toISOString()}`,
      content,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub write ${res.status}: ${err}`);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const apiKey = process.env.KATANA_API_KEY;
  if (!apiKey) return respond(500, { error: "Missing KATANA_API_KEY env var" });

  console.log("arcCRM Katana sync started", new Date().toISOString());

  try {
    // Fetch all four data sets in parallel
    const [cust, so, mo, prod] = await Promise.all([
      katanaGet("/customers?limit=500", apiKey),
      katanaGet("/sales_orders?limit=500", apiKey),
      katanaGet("/manufacturing_orders?limit=500", apiKey),
      katanaGet("/products?limit=500", apiKey),
    ]);

    const data = {
      customers:             cust.data || cust || [],
      sales_orders:          so.data   || so   || [],
      manufacturing_orders:  mo.data   || mo   || [],
      products:              prod.data || prod || [],
    };

    const counts = {
      customers:            data.customers.length,
      sales_orders:         data.sales_orders.length,
      manufacturing_orders: data.manufacturing_orders.length,
      products:             data.products.length,
    };

    console.log("Fetched:", counts);

    await writeToGitHub(data);
    console.log("Written to GitHub");

    return respond(200, { success: true, synced_at: new Date().toISOString(), counts });
  } catch (err) {
    console.error("Sync failed:", err.message);
    return respond(500, { success: false, error: err.message });
  }
};
