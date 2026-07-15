/**
 * arcCRM — Push signed/approved quote to Katana as sales order
 * Since products are managed locally (not in Katana), we send
 * a detailed notes-based order and try to match the customer by email.
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

  const { quote_number, customer_name, customer_email, notes, line_items, total, currency } = payload;

  // Build a detailed line-item summary for the notes field
  const lineItemText = (line_items || []).map(li =>
    `• ${li.product_name || li.sku || '—'} (SKU: ${li.sku || '—'}) | ` +
    `${li.mainColor ? 'Main: ' + li.mainColor + ' ' : ''}` +
    `${li.trimColor ? 'Trim: ' + li.trimColor + ' ' : ''}` +
    `${li.logoType ? 'Logo: ' + li.logoType + ' ' : ''}` +
    `Qty: ${li.qty} × $${parseFloat(li.unit_price || 0).toFixed(2)}` +
    `${li.discount ? ' (' + li.discount + '% disc)' : ''}`
  ).join('\n');

  const orderNotes = [
    `Quote ${quote_number || ''}`,
    `Customer: ${customer_name || ''} ${customer_email ? '<' + customer_email + '>' : ''}`,
    `Currency: ${currency || 'USD'} | Total: $${parseFloat(total || 0).toFixed(2)}`,
    '',
    'LINE ITEMS:',
    lineItemText,
    notes ? '\nNOTES:\n' + notes : '',
  ].filter(Boolean).join('\n').trim();

  // Build order payload — notes-based since products aren't in Katana
  const orderPayload = {
    notes: orderNotes,
    delivery_date: null,
  };

  // Try to match Katana customer by email
  if (customer_email) {
    try {
      const custRes = await fetch(`${KATANA}/customers?limit=500`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (custRes.ok) {
        const customers = await custRes.json();
        const list = customers.data || customers || [];
        const match = list.find(c =>
          c.email?.toLowerCase() === customer_email.toLowerCase() ||
          c.name?.toLowerCase() === (customer_name || '').toLowerCase()
        );
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
    if (!r.ok) {
      // Log the full error for debugging
      console.error("Katana error:", JSON.stringify(data));
      return respond(r.status, {
        error: data.error || data.message || data.detail || JSON.stringify(data) || `Katana ${r.status}`
      });
    }
    return respond(200, { success: true, order: data });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
