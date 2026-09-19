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

// Live headlines for the Intel panel's News tab. Returned verbatim from
// NewsAPI — no AI touches this response. The "deterministic, not estimated"
// rule applies to news the same way it applies to the finance/schedule
// dossiers: real data as-fetched, never paraphrased or summarized into
// something that could quietly drift from the source.
app.get("/api/news", async (req, res) => {
  const apiKey = process.env.NEWSAPI_KEY;

  if (!apiKey) {
    console.error("❌  NEWSAPI_KEY is not set. Add it to .env.local");
    return res.status(500).json({ error: "News API key not configured. Check .env.local" });
  }

  const pageSize = Math.min(parseInt(req.query.pageSize) || 12, 20);
  const q = req.query.q;
  const domains = req.query.domains;
  const searchIn = req.query.searchIn;

  try {
    // With a q param, switch to /v2/everything (keyword search) — used by
    // the Risk tab to pull conflict/sanctions/tariff-relevant coverage
    // instead of a fixed category. Same verbatim, no-AI-touch rule either way.
    // domains/searchIn are optional narrowing params the Risk tab uses to
    // keep loose keywords like "conflict" from matching entertainment
    // coverage — NewsAPI's default search scans title+description+content,
    // so a word can match deep in unrelated body text without either.
    let url;
    if (q) {
      url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=${pageSize}`;
      if (domains) url += `&domains=${encodeURIComponent(domains)}`;
      if (searchIn) url += `&searchIn=${encodeURIComponent(searchIn)}`;
    } else {
      url = `https://newsapi.org/v2/top-headlines?country=us&category=${encodeURIComponent(req.query.category || "general")}&pageSize=${pageSize}`;
    }
    const response = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    const data = await response.json();
    res.status(response.status).json(data);
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
  console.log(`  ⬡  News: http://localhost:${PORT}/api/news`);
  console.log(`  ⬡  News key: ${process.env.NEWSAPI_KEY ? "✓ loaded" : "✗ MISSING — add NEWSAPI_KEY to .env.local"}`);
  console.log(`  ⬡  Markets: http://localhost:${PORT}/api/markets`);
  console.log(`  ⬡  Alpha Vantage key: ${process.env.ALPHA_VANTAGE_KEY ? "✓ loaded" : "✗ MISSING — add ALPHA_VANTAGE_KEY to .env.local"}\n`);
});
