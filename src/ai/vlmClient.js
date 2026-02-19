// Browser client: talks to the SimStudio VLM backend server
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


