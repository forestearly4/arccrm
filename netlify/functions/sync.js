/**
 * arcCRM Sync Function
 * Runs on a schedule (@hourly) AND on-demand via GET /.netlify/functions/sync
 * 
 * Flow:
 * 1. Calls Anthropic API with Katana MCP server attached
 * 2. Claude fetches customers, sales orders, mfg orders, products from Katana
 * 3. Writes katana-data.json to GitHub repo
 * 4. arcCRM reads that static JSON file — zero CORS issues
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GITHUB_API = "https://api.github.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Ask Claude to fetch all Katana data via MCP
async function fetchKatanaData() {
  const mcpToken = process.env.KATANA_MCP_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) throw new Error("Missing ANTHROPIC_API_KEY");
  if (!mcpToken) throw new Error("Missing KATANA_MCP_TOKEN");

  const prompt = `Use the Katana MCP tools to fetch the following data and return it as a single JSON object with these exact keys:
- customers: array from /customers?limit=200
- sales_orders: array from /sales_orders?limit=200  
- manufacturing_orders: array from /manufacturing_orders?limit=200
- products: array from /products?limit=200

Return ONLY the raw JSON object with those 4 keys. No explanation, no markdown, no code fences. Just the JSON.`;

  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 16000,
      mcp_servers: [
        {
          type: "url",
          url: "https://mcp.katanamrp.com",
          name: "katana",
          authorization_token: mcpToken,
        },
      ],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();

  // Extract text content from response
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content in Claude response");

  // Parse the JSON Claude returned
  let katanaData;
  try {
    // Strip any accidental markdown fences
    const cleaned = textBlock.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    katanaData = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Failed to parse Claude JSON response: " + textBlock.text.slice(0, 200));
  }

  return katanaData;
}

// Write JSON file to GitHub repo
async function writeToGitHub(data) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "forestearly4/arccrm";
  const branch = process.env.GITHUB_BRANCH || "main";
  const path = "katana-data.json";

  if (!token) throw new Error("Missing GITHUB_TOKEN");

  const fileUrl = `${GITHUB_API}/repos/${repo}/contents/${path}`;

  // Get current file SHA (needed for updates)
  let sha;
  try {
    const existing = await fetch(`${fileUrl}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (existing.ok) {
      const existingData = await existing.json();
      sha = existingData.sha;
    }
  } catch (e) {
    // File doesn't exist yet, that's fine
  }

  const content = Buffer.from(
    JSON.stringify({ ...data, synced_at: new Date().toISOString() })
  ).toString("base64");

  const body = {
    message: `sync: Katana data update ${new Date().toISOString()}`,
    content,
    branch,
    ...(sha ? { sha } : {}),
  };

  const writeRes = await fetch(fileUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!writeRes.ok) {
    const err = await writeRes.text();
    throw new Error(`GitHub write error ${writeRes.status}: ${err}`);
  }

  return await writeRes.json();
}

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  console.log("arcCRM sync started at", new Date().toISOString());

  try {
    console.log("Fetching Katana data via Claude MCP...");
    const katanaData = await fetchKatanaData();

    const counts = {
      customers: katanaData.customers?.length || 0,
      sales_orders: katanaData.sales_orders?.length || 0,
      manufacturing_orders: katanaData.manufacturing_orders?.length || 0,
      products: katanaData.products?.length || 0,
    };
    console.log("Fetched:", counts);

    console.log("Writing to GitHub...");
    await writeToGitHub(katanaData);
    console.log("GitHub write complete");

    return json(200, {
      success: true,
      synced_at: new Date().toISOString(),
      counts,
    });
  } catch (err) {
    console.error("Sync failed:", err.message);
    return json(500, { success: false, error: err.message });
  }
};
