/**
 * arcCRM — Update Product in Katana (used for price list updates and full updates)
 */
const KATANA_BASE = "https://api.katanamrp.com/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function respond(status, body) { return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });
  const apiKey = process.env.KATANA_API_KEY;
  if (!apiKey) return respond(500, { error: "Missing KATANA_API_KEY" });
  let payload;
  try { payload = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }
  const { id, ...updateData } = payload;
  if (!id) return respond(400, { error: "Product ID required" });
  try {
    const r = await fetch(`${KATANA_BASE}/products/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });
    const data = await r.json();
    if (!r.ok) return respond(r.status, { error: data.error || data.message || `Katana ${r.status}` });
    return respond(200, data);
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
