import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── API Keys ────────────────────────────────────────────────────────────────
const OPENAI_API_KEY = "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";
const GEMINI_API_KEY = "AIzaSyDnG_fSjtDFeqlP9t-Jj1_PfMjko5uCuL0";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// ── Clients ─────────────────────────────────────────────────────────────────
function getClient(model) {
  if (model.startsWith("gemini")) {
    return new OpenAI({ apiKey: GEMINI_API_KEY, baseURL: GEMINI_BASE_URL });
  }
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

// ── Asset library file ──────────────────────────────────────────────────────
const ASSET_LIBRARY_FILE = join(__dirname, "vlm-server", "asset-library.json");

// ── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// ── POST /vlm/decision ──────────────────────────────────────────────────────
app.post("/vlm/decision", async (req, res) => {
  try {
    const { model, prompt, imageBase64, context, messages: reqMessages, max_tokens } = req.body;
    const client = getClient(model);

    let messages = reqMessages;
    if (!messages) {
      const userContent = imageBase64
        ? [
            { type: "text", text: `Context:\n${JSON.stringify(context || {})}` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ]
        : `Context:\n${JSON.stringify(context || {})}`;
      messages = [
        { role: "system", content: prompt || "You are an AI agent. Output JSON only." },
        { role: "user", content: userContent },
      ];
    }

    const maxTok = max_tokens || 16384;
    const params = { model, messages, temperature: 0.3 };
    if (model.startsWith("gemini")) {
      params.max_tokens = maxTok;
    } else {
      params.max_completion_tokens = maxTok;
    }

    const response = await client.chat.completions.create(params);
    const text = response.choices?.[0]?.message?.content || "";
    res.json({ raw: text });
  } catch (err) {
    console.error("[/vlm/decision]", err.message);
    res.status(500).json({ detail: err.message });
  }
});

// ── POST /vlm/generate-image ────────────────────────────────────────────────
app.post("/vlm/generate-image", async (req, res) => {
  try {
    const { prompt, size = "1024x1024", quality = "medium" } = req.body;
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const fullPrompt = `Seamless tileable texture for 3D rendering, top-down flat view, no perspective: ${prompt}`;

    let lastError = null;
    for (const modelName of ["gpt-image-1-mini", "gpt-image-1"]) {
      try {
        const response = await client.images.generate({ model: modelName, prompt: fullPrompt, size, quality, n: 1 });
        const b64 = response.data?.[0]?.b64_json;
        if (b64) return res.json({ b64, dataUrl: `data:image/png;base64,${b64}`, model: modelName });
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }

    const hash = createHash("sha256").update(fullPrompt).digest("hex");
    const h = parseInt(hash.slice(0, 8), 16);
    const hue = h % 360;
    const hue2 = (hue + 34) % 360;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},22%,42%)'/><stop offset='100%' stop-color='hsl(${hue2},24%,55%)'/></linearGradient>
<pattern id='p' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='none'/><path d='M0 31 L31 0' stroke='rgba(255,255,255,0.14)' stroke-width='1'/></pattern></defs>
<rect width='512' height='512' fill='url(#g)'/><rect width='512' height='512' fill='url(#p)'/></svg>`;
    res.json({ b64: null, dataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), fallback: true, error: lastError });
  } catch (err) {
    console.error("[/vlm/generate-image]", err.message);
    res.status(500).json({ detail: err.message });
  }
});

// ── GET /vlm/asset-library ──────────────────────────────────────────────────
app.get("/vlm/asset-library", (req, res) => {
  try {
    if (existsSync(ASSET_LIBRARY_FILE)) {
      const data = JSON.parse(readFileSync(ASSET_LIBRARY_FILE, "utf-8"));
      if (Array.isArray(data)) return res.json({ assets: data });
    }
  } catch (err) {
    console.error("[asset-library] read failed:", err.message);
  }
  res.json({ assets: [] });
});

// ── POST /vlm/asset-library ─────────────────────────────────────────────────
app.post("/vlm/asset-library", (req, res) => {
  try {
    const { assets } = req.body;
    writeFileSync(ASSET_LIBRARY_FILE, JSON.stringify(assets), "utf-8");
    res.json({ ok: true, count: assets?.length || 0 });
  } catch (err) {
    console.error("[asset-library] write failed:", err.message);
    res.status(500).json({ detail: err.message });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`DimSim VLM server running on http://127.0.0.1:${PORT}`);
});
