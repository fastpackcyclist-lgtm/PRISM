// server.js — Local API proxy for development
// Mirrors api/chat.js (the Vercel Edge Function) so local dev and production behave identically.
// Start with: node server.js
// Or use: npm run dev (runs this + Vite together via concurrently)

import express from "express";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Load .env.local if present
try {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
} catch {
  // dotenv optional — env vars may already be set in the shell
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// Allow Vite dev server to hit this proxy
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/api/chat", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("❌  ANTHROPIC_API_KEY is not set. Add it to .env.local");
    return res.status(500).json({ error: "API key not configured. Check .env.local" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model:      req.body.model      || "claude-sonnet-4-6",
        max_tokens: req.body.max_tokens || 1000,
        messages:   req.body.messages,
        ...(req.body.system ? { system: req.body.system } : {}),
      }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).json({ error: "Proxy error", detail: err.message });
  }
});

// Embeddings for the memory archive's semantic search. Anthropic has no
// embeddings endpoint, so this proxies Voyage AI the same way /api/chat
// proxies Anthropic — key stays server-side, never reaches the client.
app.post("/api/embed", async (req, res) => {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    console.error("❌  VOYAGE_API_KEY is not set. Add it to .env.local");
    return res.status(500).json({ error: "Embedding API key not configured. Check .env.local" });
  }

  const input = req.body.input;
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return res.status(400).json({ error: "Missing 'input' (string or array of strings)" });
  }

  try {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input,
        model: req.body.model || "voyage-3",
        input_type: req.body.input_type || "document",
      }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Embed proxy error:", err.message);
    res.status(500).json({ error: "Proxy error", detail: err.message });
  }
});

// Live headlines for the Intel panel's News and Risk tabs. Returned verbatim
// from the source — no AI touches this response. The "deterministic, not
// estimated" rule applies to news the same way it applies to the
// finance/schedule dossiers: real data as-fetched, never paraphrased or
// summarized into something that could quietly drift from the source.
//
// Source: previously NewsAPI.org, which is what narviai.com's own news
// system ran into first — its free tier explicitly forbids non-localhost/
// production use. Swapped 2026-09-24 to Hacker News Algolia for both tabs,
// same pattern already proven on narviai.com — free, keyless, ToS-clean:
//   - General (no q param): front-page-quality stories only (points>40).
//   - Risk tab (q param present): keyword search instead of a points floor
//     — geopolitical/sanctions/tariff coverage is real but rarer on HN, so
//     requiring points>40 there would return almost nothing.
// GDELT's DOC API was tried first (a better conceptual fit for geopolitical
// monitoring) but its host is unreachable from this environment — DNS
// resolves, the connection itself times out. Worth revisiting from a
// different host; HN keyword search is the reliable fallback for now.
// Response shape kept identical ({ articles: [{ title, url, source:{name},
// publishedAt }] }) so the frontend needed zero changes.
app.get("/api/news", async (req, res) => {
  const pageSize = Math.min(parseInt(req.query.pageSize) || 12, 20);
  const q = req.query.q;

  try {
    let articles;

    if (q) {
      // Risk tab — HN Algolia keyword search. q arrives as an OR-joined,
      // quoted-phrase list (the same shape it was always sent in, built for
      // NewsAPI's boolean query syntax) — Algolia's query param has no OR
      // operator and no exact-phrase quoting, so passing the raw string
      // through matches nothing. Split it into individual terms instead,
      // run each as its own search, then merge/dedupe/sort by recency —
      // real multi-topic coverage without needing boolean support Algolia
      // doesn't have.
      const terms = q
        .split(/\s+OR\s+/i)
        .map((t) => t.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      const results = await Promise.all(
        terms.map((term) =>
          fetch(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}&tags=story&hitsPerPage=${pageSize}`)
            .then((r) => r.json())
            .then((d) => d.hits || [])
            .catch(() => [])
        )
      );
      const seen = new Set();
      articles = results
        .flat()
        .filter((h) => (seen.has(h.objectID) ? false : (seen.add(h.objectID), true)))
        .sort((a, b) => b.created_at_i - a.created_at_i)
        .slice(0, pageSize)
        .map((h) => ({
          title: h.title,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          source: { name: "Hacker News" },
          publishedAt: h.created_at,
        }));
    } else {
      // General tab — Hacker News Algolia, front-page-quality only.
      const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E40&hitsPerPage=${pageSize}`;
      const response = await fetch(url);
      const data = await response.json();
      articles = (data.hits || []).map((h) => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: { name: "Hacker News" },
        publishedAt: h.created_at,
      }));
    }

    res.json({ articles });
  } catch (err) {
    console.error("News proxy error:", err.message);
    res.status(500).json({ error: "Proxy error", detail: err.message });
  }
});

// Market snapshot for the Intel panel's Markets tab. Alpha Vantage's free
// tier caps at 25 requests/day and gates true realtime/15-min-delayed US
// data behind a paid plan — so this is deliberately a small, fixed
// watchlist (one call per symbol) rather than anything resembling a live
// ticker, and the client only calls this once per session, not on a poll.
// "latestTradingDay" is returned as-is so the UI can label it honestly
// (last close, not live) instead of implying something Alpha Vantage's
// free tier doesn't actually provide.
const MARKET_WATCHLIST = ["SPY", "QQQ", "DIA"];

app.get("/api/markets", async (req, res) => {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;

  if (!apiKey) {
    console.error("❌  ALPHA_VANTAGE_KEY is not set. Add it to .env.local");
    return res.status(500).json({ error: "Market data API key not configured. Check .env.local" });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const quotes = [];
    // Sequential, not Promise.all — Alpha Vantage's free tier also caps at
    // 1 request/second, separately from the 25/day cap. Firing the
    // watchlist in parallel trips that burst limit and most of it comes
    // back as an error instead of data. Learned this the first time it ran.
    for (let i = 0; i < MARKET_WATCHLIST.length; i++) {
      const symbol = MARKET_WATCHLIST[i];
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      const q = data["Global Quote"];
      quotes.push(
        !q || !q["05. price"]
          ? { symbol, error: data["Note"] || data["Information"] || "No data returned" }
          : {
              symbol,
              price: parseFloat(q["05. price"]),
              change: parseFloat(q["09. change"]),
              changePercent: q["10. change percent"],
              latestTradingDay: q["07. latest trading day"],
            }
      );
      if (i < MARKET_WATCHLIST.length - 1) await sleep(1100);
    }
    res.json({ quotes });
  } catch (err) {
    console.error("Markets proxy error:", err.message);
    res.status(500).json({ error: "Proxy error", detail: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n  ⬡  PRISM API proxy  →  http://localhost:${PORT}/api/chat`);
  console.log(`  ⬡  API key: ${process.env.ANTHROPIC_API_KEY ? "✓ loaded" : "✗ MISSING — add to .env.local"}`);
  console.log(`  ⬡  Embeddings: http://localhost:${PORT}/api/embed`);
  console.log(`  ⬡  Voyage key: ${process.env.VOYAGE_API_KEY ? "✓ loaded" : "✗ MISSING — add VOYAGE_API_KEY to .env.local"}`);
  console.log(`  ⬡  News: http://localhost:${PORT}/api/news (Hacker News Algolia — keyless, no key needed)`);
  console.log(`  ⬡  Markets: http://localhost:${PORT}/api/markets`);
  console.log(`  ⬡  Alpha Vantage key: ${process.env.ALPHA_VANTAGE_KEY ? "✓ loaded" : "✗ MISSING — add ALPHA_VANTAGE_KEY to .env.local"}\n`);
});
