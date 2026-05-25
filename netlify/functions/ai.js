// netlify/functions/ai.js
// Proxy for AI providers (OpenAI / Anthropic Claude)
// API key is supplied per-request by the client (stored in user's localStorage)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(data) {
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, ...data }),
  };
}
function err(msg, code = 400) {
  return {
    statusCode: code,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: msg }),
  };
}

async function generateStory(api_key) {
  if (!api_key) throw new Error("API key requerida");

  const prompt = `Escribe una fábula infantil original en español.
Requisitos:
- Tema: animales, naturaleza o fantasía con valores positivos
- Longitud: entre 800 y 1000 palabras (suficiente para 4-5 minutos de lectura)
- Estructura: introducción, desarrollo, clímax y moraleja explícita al final
- Tono: cálido, imaginativo, apropiado para niños de 4 a 10 años
- Incluye diálogos para hacerlo más vivo
- La moraleja debe ser una lección de vida clara y positiva

Después del cuento, crea exactamente 3 preguntas de opción múltiple sobre el cuento para niños.
Cada pregunta tiene 3 opciones (a, b, c) y solo una es correcta.

Responde ÚNICAMENTE con un objeto JSON con este formato exacto (sin markdown, sin bloques de código):
{
  "title": "El título del cuento",
  "content": "El texto completo del cuento...",
  "questions": [
    {
      "q": "¿Pregunta 1?",
      "options": ["opción a", "opción b", "opción c"],
      "answer": 0
    },
    {
      "q": "¿Pregunta 2?",
      "options": ["opción a", "opción b", "opción c"],
      "answer": 1
    },
    {
      "q": "¿Pregunta 3?",
      "options": ["opción a", "opción b", "opción c"],
      "answer": 2
    }
  ]
}
El campo "answer" es el índice (0, 1 o 2) de la opción correcta.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Error generando cuento");
  const text = data.content[0].text.trim();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("Respuesta con formato inesperado");
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return err("POST only", 405);

  let body;
  try { body = JSON.parse(event.body); } catch { return err("Invalid JSON"); }

  // ── STORY GENERATION ─────────────────────────────────────
  if (body.action === "generate_story") {
    try {
      const story = await generateStory(body.api_key);
      return ok({ story });
    } catch (e) {
      return err(e.message, 500);
    }
  }

  const { provider, api_key, messages, system } = body;

  if (!provider || !api_key) return err("provider y api_key son requeridos");
  if (!messages || !Array.isArray(messages)) return err("messages debe ser un array");

  // ── OPENAI ────────────────────────────────────────────────
  if (provider === "openai") {
    const payload = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system || "" },
        ...messages,
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${api_key}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) return err(data.error?.message || "OpenAI error", res.status);
    return ok({ reply: data.choices[0].message.content });
  }

  // ── ANTHROPIC CLAUDE ──────────────────────────────────────
  if (provider === "claude") {
    const payload = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: system || "",
      messages,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) return err(data.error?.message || "Claude error", res.status);
    return ok({ reply: data.content[0].text });
  }

  // ── GEMINI ────────────────────────────────────────────────
  if (provider === "gemini") {
    const fullMessages = system
      ? [{ role: "user", parts: [{ text: system }] }, { role: "model", parts: [{ text: "Entendido, actuaré como asistente de Hábitos Kids." }] }, ...messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))]
      : messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: fullMessages }),
      }
    );

    const data = await res.json();
    if (!res.ok) return err(data.error?.message || "Gemini error", res.status);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return err("Respuesta vacía de Gemini");
    return ok({ reply: text });
  }

  return err(`Proveedor no soportado: ${provider}`);
};
