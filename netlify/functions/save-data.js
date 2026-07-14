/**
 * arcCRM — Save customers or products to GitHub
 * POST { type: "customers"|"products", data: [...] }
 */
const { writeGitHubFile } = require("./github");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function respond(status, body) { return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  let payload;
  try { payload = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { type, data } = payload;
  if (!type || !["customers", "products"].includes(type)) return respond(400, { error: "type must be customers or products" });
  if (!Array.isArray(data)) return respond(400, { error: "data must be an array" });

  try {
    await writeGitHubFile(`${type}.json`, { [type]: data });
    return respond(200, { success: true, count: data.length, type });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
