// Browser client: talks to a local proxy server in spark-world/vlm-server (recommended)
// so your OpenAI key never ships to the browser.

export async function requestVlmDecision({ endpoint, model, prompt, imageBase64, context, messages }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, imageBase64, context, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VLM request failed (${res.status}): ${text || res.statusText}`);
  }
  return await res.json();
}


