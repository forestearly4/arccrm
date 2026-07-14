/**
 * arcCRM Sync — Katana only
 * Pulls: inventory levels per SKU + sales order statuses
 * Writes: katana-data.json to GitHub
 * Runs: @hourly + on-demand GET
 */
const { writeGitHubFile } = require("./github");

const KATANA = "https://api.katanamrp.com/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function respond(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function katanaGet(path, key) {
  const r = await fetch(KATANA + path, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`Katana ${r.status} ${path}: ${r.statusText}`);
  return r.json();
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const key = process.env.KATANA_API_KEY;
  if (!key) return respond(500, { error: "Missing KATANA_API_KEY" });

  console.log("Katana sync started", new Date().toISOString());

  try {
    // Fetch inventory levels and sales orders in parallel
    const [invRes, soRes] = await Promise.all([
      katanaGet("/products?limit=500", key),
      katanaGet("/sales_orders?limit=500", key),
    ]);

    // Extract only what we need — inventory levels per SKU
    const rawProducts = invRes.data || invRes || [];
    const inventory = rawProducts.map(p => ({
      id:         p.id,
      sku:        p.sku,
      name:       p.name,
      in_stock:   p.in_stock ?? p.stock_quantity ?? 0,
      committed:  p.committed_stock ?? 0,
      expected:   p.expected_stock ?? 0,
      unit:       p.unit_of_measure || "",
    }));

    // Extract sales order statuses
    const rawOrders = soRes.data || soRes || [];
    const sales_orders = rawOrders.map(o => ({
      id:             o.id,
      order_number:   o.order_number,
      customer_id:    o.customer_id || o.contact?.id,
      customer_name:  o.customer_name || o.contact?.name || "",
      status:         o.status,
      total:          o.total_price || o.total || 0,
      created_at:     o.created_at,
      delivery_date:  o.delivery_date,
      notes:          o.notes,
    }));

    const data = { inventory, sales_orders };
    await writeGitHubFile("katana-data.json", data);

    console.log(`Synced ${inventory.length} SKUs, ${sales_orders.length} orders`);
    return respond(200, {
      success: true,
      synced_at: new Date().toISOString(),
      counts: { inventory: inventory.length, sales_orders: sales_orders.length },
    });
  } catch (err) {
    console.error("Sync failed:", err.message);
    return respond(500, { success: false, error: err.message });
  }
};
