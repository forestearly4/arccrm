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
    // Fetch materials and inventory in parallel
    const [matRes, soRes, invRes] = await Promise.all([
      katanaGet("/materials?limit=500", key),
      katanaGet("/sales_orders?limit=500", key),
      katanaGet("/inventory?limit=2000", key),
    ]);

    // Build a variant_id → inventory map
    const rawInventory = invRes.data || invRes || [];
    const invMap = {};
    for (const inv of rawInventory) {
      if (!invMap[inv.variant_id]) invMap[inv.variant_id] = inv;
    }

    // Extract materials — name + calculated stock only
    const rawMaterials = matRes.data || matRes || [];
    const inventory = rawMaterials
      .filter(m => !m.archived_at && !m.deleted_at)
      .map(m => {
        // Get first variant's inventory record
        const variantId = m.variants?.[0]?.id;
        const inv = variantId ? invMap[variantId] : null;
        const inStock    = parseFloat(inv?.quantity_in_stock    || 0);
        const committed  = parseFloat(inv?.quantity_committed   || 0);
        const expected   = parseFloat(inv?.quantity_expected    || 0);
        // Calculated stock = in stock - committed + expected (matches Katana UI)
        const calculated = Math.round((inStock - committed + expected) * 1000) / 1000;
        return {
          id:         m.id,
          name:       m.name,
          category:   m.category_name || "",
          uom:        m.uom || "",
          in_stock:   Math.round(inStock * 1000) / 1000,
          calculated: calculated,
        };
      })
      // Only include materials with a name containing "plastic" or any stock activity
      // (show all — user can search/filter in the UI)
      .filter(m => m.name)
      .sort((a, b) => a.name.localeCompare(b.name));

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
