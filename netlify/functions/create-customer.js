/**
 * arcCRM — Create Customer via Katana MCP
 * Called when user submits the New Customer form.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

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

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const mcpToken = process.env.KATANA_MCP_TOKEN;
  if (!anthropicKey) return json(500, { error: "Missing ANTHROPIC_API_KEY" });
  if (!mcpToken) return json(500, { error: "Missing KATANA_MCP_TOKEN" });

  const prompt = `Create a new customer in Katana with the following data using the Katana MCP tool. 
After creating it, return ONLY the created customer object as raw JSON (no markdown, no explanation):

${JSON.stringify(payload, null, 2)}`;

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "mcp-client-2025-04-04",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4000,
        mcp_servers: [{
          type: "url",
          url: "https://mcp.katanamrp.com",
          name: "katana",
          authorization_token: mcpToken,
        }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return json(502, { error: `Anthropic error ${res.status}: ${err}` });
    }

    const data = await res.json();
    const textBlock = data.content?.find(b => b.type === "text");
    if (!textBlock) return json(502, { error: "No response from Claude" });

    const cleaned = textBlock.text.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
    let customer;
    try { customer = JSON.parse(cleaned); }
    catch { return json(502, { error: "Could not parse customer response: " + cleaned.slice(0,200) }); }

    return json(200, customer);
  } catch (err) {
    return json(500, { error: err.message });
  }
};
