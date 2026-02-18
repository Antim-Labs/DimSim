import os
import json
import base64
import hashlib
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore

# ── API Keys ──────────────────────────────────────────────────────────────────
OPENAI_API_KEY = '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'
GEMINI_API_KEY = 'AIzaSyDnG_fSjtDFeqlP9t-Jj1_PfMjko5uCuL0'

# ── Gemini uses an OpenAI-compatible endpoint ─────────────────────────────────
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _get_client(model: str):
    """Return the right OpenAI-compatible client for the requested model."""
    if model.startswith("gemini"):
        return OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE_URL), model
    # Default: OpenAI
    return OpenAI(api_key=OPENAI_API_KEY), model


class VlmRequest(BaseModel):
    model: str
    prompt: str = ""
    imageBase64: str = ""
    context: Optional[Dict[str, Any]] = None
    messages: Optional[List[Dict[str, Any]]] = None
    max_tokens: Optional[int] = None  # Override default max_completion_tokens (default: 500)


class ImageGenRequest(BaseModel):
    prompt: str
    size: str = "1024x1024"  # "256x256", "512x512", "1024x1024"
    quality: str = "medium"   # "low", "medium", "high"


app = FastAPI(title="Spark World VLM Proxy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/vlm/decision")
def vlm_decision(req: VlmRequest):
    if OpenAI is None:
        raise HTTPException(status_code=500, detail="openai package not installed")

    client, resolved_model = _get_client(req.model)

    # Use provided messages or build fallback
    messages = req.messages
    if not messages:
        messages = [
            {"role": "system", "content": req.prompt or "You are an AI agent. Output JSON only."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Context:\n{req.context or {}}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{req.imageBase64}"}}
                ] if req.imageBase64 else f"Context:\n{req.context or {}}"
            },
        ]

    max_tok = req.max_tokens or 16384

    try:
        # Gemini's OpenAI-compat endpoint uses max_tokens, not max_completion_tokens
        if resolved_model.startswith("gemini"):
            response = client.chat.completions.create(
                model=resolved_model,
                messages=messages,
                max_tokens=max_tok,
                temperature=0.3,
            )
        else:
            response = client.chat.completions.create(
                model=resolved_model,
                messages=messages,
                max_completion_tokens=max_tok,
                temperature=0.3,
            )
        text = response.choices[0].message.content or ""
        return {"raw": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vlm/generate-image")
def generate_image(req: ImageGenRequest):
    """Generate an image via DALL-E and return as base64 data URL."""
    if OpenAI is None:
        raise HTTPException(status_code=500, detail="openai package not installed")

    client = OpenAI(api_key=OPENAI_API_KEY)

    # Prepend seamless texture instructions for better tiling
    full_prompt = f"Seamless tileable texture for 3D rendering, top-down flat view, no perspective: {req.prompt}"

    def _fallback_svg_data_url(prompt_text: str) -> str:
        h = int(hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:8], 16)
        hue = h % 360
        hue2 = (hue + 34) % 360
        svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'>
<defs>
  <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
    <stop offset='0%' stop-color='hsl({hue},22%,42%)'/>
    <stop offset='100%' stop-color='hsl({hue2},24%,55%)'/>
  </linearGradient>
  <pattern id='p' width='32' height='32' patternUnits='userSpaceOnUse'>
    <rect width='32' height='32' fill='none'/>
    <path d='M0 31 L31 0' stroke='rgba(255,255,255,0.14)' stroke-width='1'/>
  </pattern>
</defs>
<rect width='512' height='512' fill='url(#g)'/>
<rect width='512' height='512' fill='url(#p)'/>
</svg>"""
        return "data:image/svg+xml;charset=utf-8," + urllib.parse.quote(svg)

    last_error = None
    for model_name in ["gpt-image-1-mini", "gpt-image-1"]:
        try:
            response = client.images.generate(
                model=model_name,
                prompt=full_prompt,
                size=req.size,
                quality=req.quality,
                n=1,
            )
            image_b64 = response.data[0].b64_json
            if image_b64:
                return {"b64": image_b64, "dataUrl": f"data:image/png;base64,{image_b64}", "model": model_name}
        except Exception as e:
            last_error = str(e)
            continue

    # Never hard-fail texture generation; return deterministic fallback texture.
    fallback = _fallback_svg_data_url(full_prompt)
    return {"b64": None, "dataUrl": fallback, "fallback": True, "error": last_error}


# ── Asset library persistence (local JSON file) ──────────────────────────────
ASSET_LIBRARY_FILE = Path(__file__).parent / "asset-library.json"


class AssetLibrarySaveRequest(BaseModel):
    assets: List[Dict[str, Any]]


@app.get("/vlm/asset-library")
def get_asset_library():
    """Load persisted asset library from disk."""
    if ASSET_LIBRARY_FILE.exists():
        try:
            data = json.loads(ASSET_LIBRARY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return {"assets": data}
        except Exception as e:
            print(f"[asset-library] Failed to read: {e}")
    return {"assets": []}


@app.post("/vlm/asset-library")
def save_asset_library(req: AssetLibrarySaveRequest):
    """Persist asset library to disk."""
    try:
        ASSET_LIBRARY_FILE.write_text(
            json.dumps(req.assets, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"ok": True, "count": len(req.assets)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
