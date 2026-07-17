/**
 * arcCRM — Post-Signature Automation
 * Called by sign.js after a quote is signed
 *
 * Does three things in parallel:
 *   1. Sends email notification to the salesperson via Office 365
 *   2. Creates a Katana Manufacturing Order
 *   3. Creates a ClickUp task in the Production space
 *
 * Env vars required:
 *   SMTP_USER              — Office 365 email
 *   SMTP_PASS              — Office 365 password / app password
 *   SMTP_FROM              — Sender display (e.g. "arcCRM <you@domain.com>")
 *   KATANA_API_KEY         — Katana API key
 *   CLICKUP_API_KEY        — ClickUp API key
 *   CLICKUP_PRODUCTION_LIST_ID — ClickUp list ID for production tasks
 *                              (get from ClickUp URL when viewing the list)
 */

const { readGitHubFile } = require("./github");
const { sendEmail } = require("./send-email");

const KATANA  = "https://api.katanamrp.com/v1";
const CU      = "https://api.clickup.com/api/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ── Build email HTML ─────────────────────────────────────────────
function buildEmailHtml(q) {
  const currency = q.currency || "USD";
  const fmt = v => "$" + parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const lineRows = (q.lineItems || []).map(li =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${li.productName || li.productId || "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${li.sku || "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${li.mainColor || "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${li.trimColor || "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${li.logoType || "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${li.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${currency} ${fmt(li.unitPrice)}</td>
    </tr>`
  ).join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f0;margin:0;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <div style="background:#1a1e24;padding:24px 32px;display:flex;align-items:center;gap:12px">
      <div>
        <div style="font-size:22px;font-weight:700;color:#c8a96e">arcCRM</div>
        <div style="font-size:12px;color:#555d6b;letter-spacing:2px;text-transform:uppercase">Quote Signed</div>
      </div>
    </div>
    <div style="padding:32px">
      <div style="background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:18px;font-weight:700;color:#276749;margin-bottom:4px">✅ Quote ${q.number} has been signed!</div>
        <div style="font-size:14px;color:#555">
          <strong>${q.customerName}</strong> signed on ${new Date(q.signature?.signedAt || Date.now()).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Customer</td><td style="padding:6px 0;font-weight:600">${q.customerName}</td></tr>
        <tr><td style="padding:6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Email</td><td style="padding:6px 0">${q.customerEmail}</td></tr>
        <tr><td style="padding:6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Quote #</td><td style="padding:6px 0;font-family:monospace">${q.number}</td></tr>
        <tr><td style="padding:6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Total</td><td style="padding:6px 0;font-weight:700;font-size:18px;color:#c8a96e">${currency} ${fmt(q.total)}</td></tr>
        <tr><td style="padding:6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Signed by</td><td style="padding:6px 0">${q.signature?.name} &lt;${q.signature?.email || q.customerEmail}&gt;</td></tr>
      </table>

      <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Line Items</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
        <thead>
          <tr style="background:#f8f8f6">
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Product</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">SKU</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Main Color</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Trim Color</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Logo</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666">Price</th>
          </tr>
        </thead>
        <tbody>${lineRows || `<tr><td colspan="7" style="padding:20px;text-align:center;color:#888">No line items</td></tr>`}</tbody>
      </table>

      ${q.notes ? `<div style="background:#f8f8f6;border-radius:8px;padding:16px;font-size:13px;color:#555;margin-bottom:24px"><strong>Notes:</strong> ${q.notes}</div>` : ""}

      <div style="background:#fff8e6;border:1px solid #f0d080;border-radius:8px;padding:14px 16px;font-size:13px;color:#7a5a00">
        <strong>Next steps:</strong> A Katana manufacturing order and ClickUp production task have been created automatically.
        Log into arcCRM to view the signed quote and push to production.
      </div>
    </div>
    <div style="background:#f8f8f6;padding:16px 32px;font-size:12px;color:#888;text-align:center">
      arcCRM · Cask &amp; Stream · Golf Sign and Design
    </div>
  </div>
</body>
</html>`;
}

// ── Create Katana Manufacturing Order ───────────────────────────
async function createKatanaMO(q) {
  const key = process.env.KATANA_API_KEY;
  if (!key) throw new Error("Missing KATANA_API_KEY");

  const lineItemText = (q.lineItems || []).map(li =>
    `${li.productName || li.sku || "—"} | ${li.mainColor ? "Main: " + li.mainColor : ""} ${li.trimColor ? "Trim: " + li.trimColor : ""} ${li.logoType ? "Logo: " + li.logoType : ""} | Qty: ${li.qty}`
  ).join("\n");

  const payload = {
    notes: [
      `SIGNED QUOTE: ${q.number}`,
      `Customer: ${q.customerName} <${q.customerEmail}>`,
      `Signed: ${new Date(q.signature?.signedAt || Date.now()).toLocaleString()}`,
      `Signed by: ${q.signature?.name}`,
      `Total: ${q.currency || "USD"} $${parseFloat(q.total || 0).toFixed(2)}`,
      "",
      "LINE ITEMS:",
      lineItemText,
      q.notes ? "\nNOTES:\n" + q.notes : "",
    ].filter(Boolean).join("\n").trim(),
    status: "not_started",
  };

  // Try to match customer in Katana
  try {
    const cr = await fetch(`${KATANA}/customers?limit=500`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (cr.ok) {
      const customers = await cr.json();
      const list = customers.data || customers || [];
      const match = list.find(c =>
        c.email?.toLowerCase() === q.customerEmail?.toLowerCase() ||
        c.name?.toLowerCase() === q.customerName?.toLowerCase()
      );
      if (match) payload.customer_id = match.id;
    }
  } catch (_) {}

  const r = await fetch(`${KATANA}/manufacturing_orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Katana MO ${r.status}: ${data.error || data.message || JSON.stringify(data)}`);
  return data;
}

// ── Create ClickUp Production Task ──────────────────────────────
async function createClickUpTask(q) {
  const key    = process.env.CLICKUP_API_KEY;
  const listId = process.env.CLICKUP_PRODUCTION_LIST_ID;
  if (!key)    throw new Error("Missing CLICKUP_API_KEY");
  if (!listId) throw new Error("Missing CLICKUP_PRODUCTION_LIST_ID env var");

  const lineItemText = (q.lineItems || []).map(li =>
    `• ${li.productName || li.sku || "—"} | Main: ${li.mainColor || "—"} | Trim: ${li.trimColor || "—"} | Logo: ${li.logoType || "—"} | Qty: ${li.qty} | $${parseFloat(li.unitPrice || 0).toFixed(2)}`
  ).join("\n");

  const description = [
    `**SIGNED QUOTE: ${q.number}**`,
    `Customer: ${q.customerName} (${q.customerEmail})`,
    `Signed: ${new Date(q.signature?.signedAt || Date.now()).toLocaleString()}`,
    `Total: ${q.currency || "USD"} $${parseFloat(q.total || 0).toFixed(2)}`,
    "",
    "**LINE ITEMS:**",
    lineItemText,
    q.notes ? "\n**Notes:** " + q.notes : "",
  ].filter(Boolean).join("\n");

  const taskPayload = {
    name: `PRODUCTION: ${q.number} — ${q.customerName}`,
    description,
    status: "open",
    priority: 2, // high
    tags: ["signed-quote", "production"],
  };

  const r = await fetch(`${CU}/list/${listId}/task`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(taskPayload),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${data.err || JSON.stringify(data)}`);
  return data;
}

// ── Main handler ─────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  let payload;
  try { payload = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { quoteId } = payload;
  if (!quoteId) return respond(400, { error: "Missing quoteId" });

  // Load the signed quote from GitHub
  let q;
  try {
    const data = await readGitHubFile("quotes.json");
    q = (data?.quotes || []).find(x => x.id === quoteId);
    if (!q) return respond(404, { error: "Quote not found" });
    if (q.status !== "signed") return respond(400, { error: "Quote is not signed" });
  } catch (err) {
    return respond(500, { error: "Failed to load quote: " + err.message });
  }

  const results = { email: null, katana_mo: null, clickup_task: null, errors: [] };

  // Run all three in parallel
  const [emailResult, katanaResult, clickupResult] = await Promise.allSettled([

    // 1. Email notification to salesperson
    (async () => {
      const salespersonEmail = q.createdByEmail || process.env.SMTP_USER;
      if (!salespersonEmail) throw new Error("No salesperson email on quote");
      await sendEmail({
        to: salespersonEmail,
        subject: `✅ Quote ${q.number} signed by ${q.customerName}`,
        html: buildEmailHtml(q),
        text: `Quote ${q.number} has been signed by ${q.customerName}. Total: ${q.currency || "USD"} $${parseFloat(q.total || 0).toFixed(2)}`,
      });
      return { sent_to: salespersonEmail };
    })(),

    // 2. Katana Manufacturing Order
    createKatanaMO(q),

    // 3. ClickUp Production Task
    createClickUpTask(q),

  ]);

  if (emailResult.status === "fulfilled")  results.email       = emailResult.value;
  else { results.errors.push("Email: "   + emailResult.reason?.message);  console.error("Email failed:", emailResult.reason); }

  if (katanaResult.status === "fulfilled") results.katana_mo   = { id: katanaResult.value.id, number: katanaResult.value.order_number };
  else { results.errors.push("Katana: "  + katanaResult.reason?.message); console.error("Katana failed:", katanaResult.reason); }

  if (clickupResult.status === "fulfilled") results.clickup_task = { id: clickupResult.value.id, url: clickupResult.value.url };
  else { results.errors.push("ClickUp: " + clickupResult.reason?.message); console.error("ClickUp failed:", clickupResult.reason); }

  console.log("Post-sign automation results:", JSON.stringify(results));
  return respond(200, { success: results.errors.length === 0, results });
};
