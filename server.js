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
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
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

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n  ⬡  PRISM API proxy  →  http://localhost:${PORT}/api/chat`);
  console.log(`  ⬡  API key: ${process.env.ANTHROPIC_API_KEY ? "✓ loaded" : "✗ MISSING — add to .env.local"}\n`);
});
