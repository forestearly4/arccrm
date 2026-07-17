/**
 * arcCRM — Quote Signature Handler
 * GET  /sign?q=QUOTE_ID  → serves the signature page HTML
 * POST /sign             → saves the signature to GitHub quotes store
 */
const { readGitHubFile, writeGitHubFile } = require("./github");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(status, body, headers = {}) {
  return { statusCode: status, headers: { ...CORS, ...headers }, body };
}

function respondJSON(status, body) {
  return respond(status, JSON.stringify(body), { "Content-Type": "application/json" });
}

// ── POST: save signature ────────────────────────────────────────────
async function saveSignature(quoteId, signerName, signerEmail) {
  const data = await readGitHubFile("quotes.json");
  const quotes = data?.quotes || [];
  const idx = quotes.findIndex(q => q.id === quoteId);
  if (idx < 0) throw new Error("Quote not found");
  const q = quotes[idx];
  if (!["sent", "awaiting_signature"].includes(q.status)) {
    throw new Error("Quote is not awaiting a signature");
  }
  quotes[idx] = {
    ...q,
    status: "signed",
    signature: {
      name: signerName,
      email: signerEmail || q.customerEmail,
      signedAt: new Date().toISOString(),
      ip: "recorded",
    },
    updatedAt: new Date().toISOString(),
  };
  await writeGitHubFile("quotes.json", { quotes });

  // ── Trigger post-sign automation (non-blocking) ──
  // Fire and forget — don't let automation failures block the success page
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "http://localhost:8888";
  fetch(`${siteUrl}/.netlify/functions/post-sign-automation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId }),
  }).then(r => r.json()).then(d => {
    console.log("Post-sign automation:", JSON.stringify(d));
  }).catch(err => {
    console.error("Post-sign automation failed:", err.message);
  });

  return quotes[idx];
}

// ── Signature page HTML ─────────────────────────────────────────────
function signaturePage(q, error = null, success = false) {
  const currency = q.currency || "USD";
  const fmt = v => "$" + parseFloat(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const lineRows = (q.lineItems || []).map(li =>
    `<tr><td>${li.productName || li.productId || "—"}</td><td>${li.sku || "—"}</td><td style="text-align:center">${li.qty}</td><td style="text-align:right">${currency} ${fmt(li.unitPrice)}</td><td style="text-align:right;font-weight:600">${currency} ${fmt(li.qty * li.unitPrice * (1 - (li.disc || 0) / 100))}</td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign Quote ${q.number}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=DM+Mono:wght@400&family=Dancing+Script:wght@600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Outfit',sans-serif;background:#f4f4f0;color:#111;min-height:100vh;padding:32px 16px;}
.wrap{max-width:680px;margin:0 auto;}
.logo{font-size:28px;font-weight:600;color:#c8a96e;margin-bottom:4px;}
.tagline{font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;}
.card{background:#fff;border-radius:12px;padding:28px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
.card-title{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#888;margin-bottom:16px;}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;margin-bottom:8px;}
.meta-item label{font-size:11px;color:#888;display:block;margin-bottom:3px;}
.meta-item span{font-size:14px;font-weight:500;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;background:#f8f8f6;border-bottom:1px solid #eee;}
td{padding:9px 10px;border-bottom:1px solid #f0f0f0;}
.totals{display:flex;justify-content:flex-end;}
.totals-box{min-width:220px;}
.total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:#555;}
.total-row.grand{font-weight:700;font-size:16px;color:#111;border-top:2px solid #eee;margin-top:4px;padding-top:10px;}
.sig-box{border:2px dashed #ddd;border-radius:8px;padding:20px;text-align:center;margin-bottom:16px;}
.sig-preview{font-family:'Dancing Script',cursive;font-size:36px;color:#1a1a1a;min-height:52px;line-height:1.4;padding:4px 0;}
input.sig-input{width:100%;border:none;border-bottom:2px solid #c8a96e;padding:10px 4px;font-size:18px;font-family:'Outfit',sans-serif;outline:none;background:transparent;text-align:center;color:#111;}
input.sig-input::placeholder{color:#bbb;}
.legal{font-size:11px;color:#888;line-height:1.7;margin-top:12px;}
.btn{display:block;width:100%;padding:14px;background:#c8a96e;color:#1a1200;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;transition:background 0.15s;}
.btn:hover{background:#e8c98d;}
.btn:disabled{opacity:0.5;cursor:not-allowed;}
.error{background:#fff0f0;border:1px solid #f8b4b4;border-radius:6px;padding:10px 14px;color:#c53030;font-size:13px;margin-bottom:16px;}
.success{background:#f0fff4;border:1px solid #9ae6b4;border-radius:12px;padding:32px;text-align:center;}
.success-icon{font-size:48px;margin-bottom:12px;}
.success-title{font-size:22px;font-weight:600;color:#276749;margin-bottom:8px;}
.success-sub{font-size:14px;color:#555;line-height:1.6;}
.sig-display{font-family:'Dancing Script',cursive;font-size:42px;color:#1a1a1a;margin:12px 0;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">Cask &amp; Stream</div>
  <div class="tagline">Cast at dawn. Sip at dusk.</div>

  ${success ? `
  <div class="success">
    <div class="success-icon">✅</div>
    <div class="success-title">Quote Signed!</div>
    <div class="sig-display">${q.signature?.name || ""}</div>
    <div class="success-sub">
      Thank you, <strong>${q.signature?.name || q.customerName}</strong>.<br>
      Quote <strong>${q.number}</strong> has been signed on ${new Date(q.signature?.signedAt || Date.now()).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.<br><br>
      Our team will be in touch shortly to confirm your order.
    </div>
  </div>
  ` : `
  <div class="card">
    <div class="card-title">Quote Details</div>
    <div class="meta-grid">
      <div class="meta-item"><label>Quote Number</label><span>${q.number}</span></div>
      <div class="meta-item"><label>Date</label><span>${new Date(q.createdAt).toLocaleDateString()}</span></div>
      <div class="meta-item"><label>Prepared For</label><span>${q.customerName}</span></div>
      ${q.expiry ? `<div class="meta-item"><label>Valid Until</label><span>${new Date(q.expiry).toLocaleDateString()}</span></div>` : ""}
    </div>
  </div>

  <div class="card">
    <div class="card-title">Line Items</div>
    <table>
      <thead><tr><th>Product</th><th>SKU</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${lineRows || `<tr><td colspan="5" style="color:#888;padding:20px;text-align:center">No line items</td></tr>`}</tbody>
    </table>
    <div class="totals" style="margin-top:16px">
      <div class="totals-box">
        <div class="total-row"><span>Subtotal</span><span>${currency} ${fmt(q.subtotal)}</span></div>
        ${q.tax ? `<div class="total-row"><span>Tax (${q.tax}%)</span><span>${currency} ${fmt((q.subtotal || 0) * q.tax / 100)}</span></div>` : ""}
        <div class="total-row grand"><span>Total</span><span style="color:#c8a96e">${currency} ${fmt(q.total)}</span></div>
      </div>
    </div>
  </div>

  ${q.notes ? `<div class="card"><div class="card-title">Notes &amp; Terms</div><div style="font-size:13px;color:#555;line-height:1.7">${q.notes}</div></div>` : ""}

  <div class="card">
    <div class="card-title">Electronic Signature</div>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/.netlify/functions/sign" id="sig-form">
      <input type="hidden" name="quoteId" value="${q.id}">
      <div class="sig-box">
        <div style="font-size:12px;color:#888;margin-bottom:12px">Type your full name below — it will appear as your signature</div>
        <div class="sig-preview" id="sig-preview">&nbsp;</div>
        <input class="sig-input" type="text" name="signerName" id="sig-input" placeholder="Type your full name here" autocomplete="name" required oninput="document.getElementById('sig-preview').textContent=this.value||' '">
      </div>
      <input type="email" name="signerEmail" value="${q.customerEmail || ""}" style="display:none">
      <div class="legal">
        By typing your name above and clicking "Sign &amp; Confirm Order", you agree that this constitutes your legal electronic signature and confirms your acceptance of Quote <strong>${q.number}</strong> for <strong>${currency} ${fmt(q.total)}</strong>. This agreement is legally binding under the Electronic Signatures in Global and National Commerce Act (E-SIGN) and equivalent state laws.
      </div>
      <button class="btn" type="submit" id="sig-btn" style="margin-top:20px" disabled>Sign &amp; Confirm Order</button>
    </form>
    <script>
      const inp=document.getElementById('sig-input');
      const btn=document.getElementById('sig-btn');
      inp.addEventListener('input',()=>{btn.disabled=inp.value.trim().length<3;});
      document.getElementById('sig-form').addEventListener('submit',()=>{btn.disabled=true;btn.textContent='Saving…';});
    </script>
  </div>
  `}
</div>
</body>
</html>`;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  // ── GET: render signature page ──────────────────────────────────
  if (event.httpMethod === "GET") {
    const quoteId = event.queryStringParameters?.q;
    if (!quoteId) return respond(400, "<h2>Missing quote ID</h2>", { "Content-Type": "text/html" });

    try {
      const data = await readGitHubFile("quotes.json");
      const q = (data?.quotes || []).find(x => x.id === quoteId);
      if (!q) return respond(404, "<h2>Quote not found</h2>", { "Content-Type": "text/html" });

      const alreadySigned = q.status === "signed";
      return respond(200, signaturePage(q, null, alreadySigned), { "Content-Type": "text/html" });
    } catch (err) {
      return respond(500, `<h2>Error: ${err.message}</h2>`, { "Content-Type": "text/html" });
    }
  }

  // ── POST: save signature ────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let quoteId, signerName, signerEmail;

    // Handle form POST (application/x-www-form-urlencoded)
    const contentType = event.headers?.["content-type"] || "";
    if (contentType.includes("application/json")) {
      const body = JSON.parse(event.body || "{}");
      quoteId = body.quoteId; signerName = body.signerName; signerEmail = body.signerEmail;
    } else {
      // URL-encoded form
      const params = new URLSearchParams(event.body || "");
      quoteId = params.get("quoteId"); signerName = params.get("signerName"); signerEmail = params.get("signerEmail");
    }

    if (!quoteId || !signerName?.trim()) {
      // Re-render page with error
      try {
        const data = await readGitHubFile("quotes.json");
        const q = (data?.quotes || []).find(x => x.id === quoteId);
        if (q) return respond(400, signaturePage(q, "Please type your full name to sign."), { "Content-Type": "text/html" });
      } catch (_) {}
      return respondJSON(400, { error: "Missing quoteId or signerName" });
    }

    try {
      const signed = await saveSignature(quoteId, signerName.trim(), signerEmail);
      // Redirect to success view
      return respond(200, signaturePage(signed, null, true), { "Content-Type": "text/html" });
    } catch (err) {
      try {
        const data = await readGitHubFile("quotes.json");
        const q = (data?.quotes || []).find(x => x.id === quoteId);
        if (q) return respond(400, signaturePage(q, err.message), { "Content-Type": "text/html" });
      } catch (_) {}
      return respondJSON(500, { error: err.message });
    }
  }

  return respondJSON(405, { error: "Method not allowed" });
};
