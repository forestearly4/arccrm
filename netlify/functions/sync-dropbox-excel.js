/**
 * arcCRM — Dropbox Excel Auto-Sync
 * Runs @daily + on-demand GET
 * Reads /arccrm/pricing.xlsx and /arccrm/customers.xlsx from Dropbox
 * Parses them and writes products.json / customers.json to GitHub
 *
 * Dropbox paths (put your Excel files here):
 *   /arccrm/pricing.xlsx   → products
 *   /arccrm/customers.xlsx → customers
 */
const { writeGitHubFile, readGitHubFile } = require("./github");

const DBX_CONTENT = "https://content.dropboxapi.com/2";
const DBX_API = "https://api.dropboxapi.com/2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function respond(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ── Download file from Dropbox as base64 ──────────────────────────
async function dropboxDownload(path, token) {
  const r = await fetch(`${DBX_CONTENT}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Dropbox download ${r.status}: ${err}`);
  }
  return r.arrayBuffer();
}

// ── Check if file exists in Dropbox ──────────────────────────────
async function dropboxExists(path, token) {
  const r = await fetch(`${DBX_API}/files/get_metadata`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return r.ok;
}

// ── Parse GSD pricing layout (fixed columns) ──────────────────────
// Col 2=SKU, Col 3=Name, Col 5=Standard Colors price, Col 7=Woodgrain Cost
function parseGSDLayout(rows) {
  const SECTION_WORDS = ['PRACTICE FACILITY','RANGE','BAG','BALL','CLUB','SCORE','TRASH',
    'SIGN','YARDAGE','BEVERAGE','DRINK','CUSTOM','TEES','ACCESSORY','PUTTING','SAND',
    'DIVOT','RULES','STARTER','FLAG','HOLE','BENCH','SHELTER','CART','MISC','ITEMS',
    'STANDARD COLORS','WOODGRAIN','FURNITURE','PATIO','CHAIR','TABLE','SOFA',
    'CUSHION','SEATING','ROPE','POST','BARRIER','SHOE','WASTE','WATER','COOLER',
    'ICE','BAR','CLOCK','TENNIS','RESIN','HDPE','MARKER','STAKE','BRUSH'];

  function looksLikeSection(s) {
    if (!s) return true;
    const u = s.toUpperCase().trim();
    if (SECTION_WORDS.some(w => u.includes(w))) return true;
    if (u === u.toUpperCase() && !/\d/.test(u) && u.replace(/\s/g, '').length > 6) return true;
    return false;
  }
  function parsePrice(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    try { return Math.round(parseFloat(String(v).replace(/[$,\s]/g, '')) * 100) / 100; } catch { return 0; }
  }

  const results = []; let currentCategory = ''; const seen = new Set();
  for (const row of rows) {
    const col2 = String(row[2] || '').trim();
    const col3 = String(row[3] || '').trim();
    const col5 = row[5]; const col7 = row[7];
    if (!col3 && col2 && looksLikeSection(col2)) { if (col2.toLowerCase() !== 'page' && col2.toLowerCase() !== 'cat') currentCategory = col2; continue; }
    if (col2 && looksLikeSection(col2) && !parsePrice(col5)) { if (col3 && !looksLikeSection(col3)) currentCategory = col3; else if (col2.toLowerCase() !== 'page' && col2.toLowerCase() !== 'cat') currentCategory = col2; continue; }
    if (!col2 || !col3) continue;
    const price = parsePrice(col5); const cost = parsePrice(col7);
    if (price === 0 && cost === 0) continue;
    const key = col2 + '|' + col3;
    if (seen.has(key)) continue; seen.add(key);
    results.push({ id: 'p_' + Math.random().toString(36).slice(2, 10), sku: col2, name: col3, price, cost, category: currentCategory.replace(/\s+/g, ' ').trim(), unit: 'pcs', description: '', updatedAt: new Date().toISOString() });
  }
  return results;
}

// ── Parse standard layout (header row detection) ──────────────────
function parseStandardLayout(rawRows, type) {
  const skuPats = [/^sku$/i, /^item.?code$/i, /^product.?code$/i, /^part/i, /^code$/i];
  const namePats = [/^product.?name$/i, /^item.?name$/i, /^name$/i, /^title$/i];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
    const row = (rawRows[i] || []).map(c => String(c || '').trim());
    const hasSku = row.some(c => skuPats.some(p => p.test(c)));
    const hasName = row.some(c => namePats.some(p => p.test(c)));
    if ((hasSku && hasName) || (hasSku && row.filter(Boolean).length >= 2)) { headerIdx = i; break; }
  }
  const headers = (rawRows[headerIdx] || []).map(h => String(h || '').trim());
  const rows = rawRows.slice(headerIdx + 1).filter(r => r.some(c => c !== '' && c != null));

  function getCol(row, patterns) {
    const idx = headers.findIndex(h => patterns.some(p => p.test(h)));
    return idx > -1 ? String(row[idx] || '').trim() : '';
  }
  function parsePrice(v) { try { return Math.round(parseFloat(String(v || 0).replace(/[$,\s]/g, '')) * 100) / 100; } catch { return 0; } }

  if (type === 'products') {
    return rows.filter(r => getCol(r, skuPats)).map(row => ({
      id: 'p_' + Math.random().toString(36).slice(2, 10),
      sku: getCol(row, skuPats), name: getCol(row, namePats),
      price: parsePrice(getCol(row, [/standard.?colors?/i, /sell/i, /^price$/i, /msrp/i, /list/i])),
      cost: parsePrice(getCol(row, [/woodgrain/i, /^cost$/i, /purchase/i, /wholesale/i])),
      category: getCol(row, [/^cat$/i, /^category$/i, /^group$/i]),
      unit: getCol(row, [/^unit$/i, /^uom$/i]) || 'pcs',
      description: getCol(row, [/^desc/i, /^note/i]),
      updatedAt: new Date().toISOString(),
    }));
  } else {
    const emailPats = [/email/i, /mail/i];
    const phonePats = [/phone/i, /tel/i, /mobile/i];
    const compPats = [/company/i, /organization/i, /business/i, /club/i];
    return rows.filter(r => getCol(r, namePats) || getCol(r, emailPats)).map(row => {
      const name = getCol(row, namePats) || '';
      return {
        id: 'c_' + Math.random().toString(36).slice(2, 10),
        name, first: name.split(' ')[0] || '', last: name.split(' ').slice(1).join(' ') || '',
        email: getCol(row, emailPats), phone: getCol(row, phonePats),
        company: getCol(row, compPats),
        city: getCol(row, [/^city$/i, /^town$/i]),
        state: getCol(row, [/^state$/i, /^province$/i]),
        country: getCol(row, [/^country$/i]),
        type: getCol(row, [/^type$/i, /^tier$/i, /^segment$/i]),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
  }
}

// ── Main handler ──────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const dbxToken = process.env.DROPBOX_TOKEN;
  if (!dbxToken) return respond(500, { error: "Missing DROPBOX_TOKEN env var" });

  // Dynamically load XLSX parser
  let XLSX;
  try { XLSX = require('xlsx'); } catch {
    // Install it inline — Netlify functions support npm deps via package.json
    return respond(500, { error: "xlsx package not available — add 'xlsx' to netlify/functions/package.json" });
  }

  const results = { products: null, customers: null, errors: [] };
  const PRICING_PATH = process.env.DROPBOX_PRICING_PATH || '/arccrm/pricing.xlsx';
  const CUSTOMERS_PATH = process.env.DROPBOX_CUSTOMERS_PATH || '/arccrm/customers.xlsx';

  // ── Sync pricing ──────────────────────────────────────────────
  try {
    if (await dropboxExists(PRICING_PATH, dbxToken)) {
      const buf = await dropboxDownload(PRICING_PATH, dbxToken);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // Detect GSD layout vs standard
      const skuLike = /^[A-Z]{1,4}[\d\-\/\s][A-Z0-9\-\s]{0,12}$/i;
      let gsdCount = 0;
      for (let i = 0; i < Math.min(rawRows.length, 50); i++) {
        const r = rawRows[i]; const c2 = String(r[2] || '').trim(); const c5 = r[5];
        if (c2 && skuLike.test(c2) && typeof c5 === 'number' && c5 > 0) gsdCount++;
      }
      const products = gsdCount >= 3 ? parseGSDLayout(rawRows) : parseStandardLayout(rawRows, 'products');

      // Preserve existing product images
      const existing = await readGitHubFile('products.json');
      const existingProds = existing?.products || [];
      products.forEach(p => {
        const ex = existingProds.find(e => e.sku === p.sku);
        if (ex?.imageUrl) p.imageUrl = ex.imageUrl;
        if (ex?.id) p.id = ex.id; // preserve IDs for quote linkage
      });

      await writeGitHubFile('products.json', { products });
      results.products = products.length;
    } else {
      results.products = `skipped (${PRICING_PATH} not found in Dropbox)`;
    }
  } catch (e) { results.errors.push('products: ' + e.message); }

  // ── Sync customers ────────────────────────────────────────────
  try {
    if (await dropboxExists(CUSTOMERS_PATH, dbxToken)) {
      const buf = await dropboxDownload(CUSTOMERS_PATH, dbxToken);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const newCustomers = parseStandardLayout(rawRows, 'customers');

      // Merge with existing (preserve ownership, notes, etc.)
      const existing = await readGitHubFile('customers.json');
      const existingCusts = existing?.customers || [];
      newCustomers.forEach(nc => {
        const ex = existingCusts.find(e => e.email && e.email.toLowerCase() === nc.email?.toLowerCase());
        if (ex) { nc.id = ex.id; nc.notes = ex.notes; nc.source = ex.source; }
      });
      const unchanged = existingCusts.filter(e => !newCustomers.find(nc => nc.email?.toLowerCase() === e.email?.toLowerCase()));
      const merged = [...newCustomers, ...unchanged];

      await writeGitHubFile('customers.json', { customers: merged });
      results.customers = merged.length;
    } else {
      results.customers = `skipped (${CUSTOMERS_PATH} not found in Dropbox)`;
    }
  } catch (e) { results.errors.push('customers: ' + e.message); }

  return respond(200, {
    success: results.errors.length === 0,
    synced_at: new Date().toISOString(),
    results,
  });
};
