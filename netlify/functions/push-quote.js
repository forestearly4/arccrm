/**
 * arcCRM — Push approved quote to Katana as sales order
 */
const KATANA = "https://api.katanamrp.com/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function respond(status, body) { return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  const key = process.env.KATANA_API_KEY;
  if (!key) return respond(500, { error: "Missing KATANA_API_KEY" });

  let payload;
  try { payload = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { quote_number, customer_name, customer_email, notes, line_items } = payload;

  // Build Katana sales order payload
  const orderPayload = {
    notes: `Quote ${quote_number || ""}\nCustomer: ${customer_name || ""}\n${notes || ""}`.trim(),
    sales_order_rows: (line_items || []).filter(li => li.sku || li.product_name).map(li => ({
      variant_id:  li.variant_id  || li.product_id || undefined,
      sku:         li.sku         || undefined,
      quantity:    li.qty         || 1,
      unit_price:  li.unit_price  || 0,
      discount:    li.discount    || 0,
    })),
  };

  // Try to match customer by email if provided
  if (customer_email) {
    try {
      const custRes = await fetch(`${KATANA}/customers?limit=500`, { headers: { Authorization: `Bearer ${key}` } });
      if (custRes.ok) {
        const customers = await custRes.json();
        const list = customers.data || customers || [];
        const match = list.find(c => c.email?.toLowerCase() === customer_email.toLowerCase());
        if (match) orderPayload.customer_id = match.id;
      }
    } catch (_) {}
  }

  try {
    const r = await fetch(`${KATANA}/sales_orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
    });
    const data = await r.json();
    if (!r.ok) return respond(r.status, { error: data.error || data.message || `Katana ${r.status}` });
    return respond(200, { success: true, order: data });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
