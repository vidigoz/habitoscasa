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

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildStoryPrompt(recentTitles = []) {
  const epocas = [
    "en un reino mágico medieval", "en un pueblo de la selva tropical", "en una aldea entre montañas nevadas",
    "en un fondo marino encantado", "en un bosque donde los árboles hablan", "en un desierto lleno de oasis secretos",
    "en una ciudad de nubes en el cielo", "en una isla donde los animales son los gobernantes",
    "en un jardín gigante donde los insectos son del tamaño de personas", "en una estrella muy lejana habitada por criaturas de luz",
    "en un tren mágico que viaja por países imaginarios", "en una cueva llena de cristales brillantes",
  ];

  const protagonistas = [
    "un pequeño dragón que no puede escupir fuego", "una tortuga muy curiosa y aventurera",
    "un ratón inventor lleno de ideas", "una rana que quiere aprender a volar",
    "un oso pequeño con miedo a la oscuridad", "una mariposa que acaba de salir del capullo",
    "un pulpo que colecciona objetos brillantes", "una ardilla muy despistada pero muy bondadosa",
    "un elefante bebé que tiene una memoria terrible", "una luciérnaga cuya luz se apagó",
    "un pingüino que vive en el trópico", "un gatito callejero que busca su lugar en el mundo",
    "una semilla que tiene miedo de crecer", "un conejito que siempre llega tarde a todo",
    "un pez que sueña con conocer la tierra firme",
  ];

  const compañeros = [
    "su mejor amigo, un caracol muy sabio", "una lechuza anciana que habla en acertijos",
    "tres hermanos muy diferentes entre sí", "un espejo mágico que solo dice la verdad",
    "un mapa que aparece y desaparece", "una piedra parlante que conoce todos los secretos del bosque",
    "un grupo de estrellas que bajan a ayudar de noche", "un viejo árbol que ha visto mil historias",
  ];

  const tramas = [
    "descubre que su mayor debilidad es en realidad su mayor fortaleza",
    "debe devolver algo que encontró aunque le cueste mucho esfuerzo",
    "aprende que pedir ayuda no es señal de debilidad sino de valentía",
    "tiene que elegir entre lo fácil y lo correcto",
    "ayuda a alguien que antes fue su rival y descubren que son muy parecidos",
    "comete un error y debe encontrar la manera de repararlo",
    "descubre un secreto que lo cambia todo y debe decidir qué hacer con él",
    "aprende que la paciencia tiene su recompensa cuando todos los demás se rindieron",
    "intenta ser alguien que no es y descubre el valor de ser auténtico",
    "une a un grupo que estaba dividido por un malentendido",
    "cuida de alguien más pequeño y aprende tanto como enseña",
    "supera un miedo gracias a la amistad y la confianza",
  ];

  const lecciones = [
    "la verdadera valentía es seguir adelante aunque tengas miedo",
    "la bondad regresa siempre a quien la da",
    "ser diferente es una fortaleza, no un defecto",
    "los errores son parte de aprender, lo importante es no rendirse",
    "la amistad verdadera se demuestra en los momentos difíciles",
    "escuchar a los demás nos hace más sabios",
    "la honestidad, aunque difícil, siempre es el mejor camino",
    "trabajar en equipo logra lo que nadie puede solo",
    "el valor de las cosas no está en su apariencia sino en lo que son por dentro",
    "respetar la naturaleza y a los demás es cuidar nuestro propio hogar",
  ];

  const tonos = [
    "con momentos de humor suave y mucha ternura",
    "con un misterio pequeño que se va resolviendo poco a poco",
    "con una aventura llena de sorpresas y giros inesperados",
    "con momentos emotivos que invitan a reflexionar",
    "con suspenso infantil: intriga sin miedo real",
  ];

  const epoca = pick(epocas);
  const protagonista = pick(protagonistas);
  const companero = pick(compañeros);
  const trama = pick(tramas);
  const leccion = pick(lecciones);
  const tono = pick(tonos);

  const avoidLine = recentTitles.length
    ? `\nIMPORTANTE: Estos son los últimos cuentos generados — evita repetir personajes, escenarios o tramas similares: ${recentTitles.map(t => `"${t}"`).join(", ")}.`
    : "";

  return `Escribe un cuento infantil original en español con estas características específicas:

- Escenario: ${epoca}
- Protagonista: ${protagonista}
- Acompañante o personaje secundario: ${companero}
- Trama central: el protagonista ${trama}
- Tono: ${tono}
- Moraleja: ${leccion}

Requisitos generales:
- Es un cuento PARA NIÑOS de 4 a 10 años — sin temas de adultos, violencia, romance ni suspenso oscuro
- Longitud: entre 800 y 1000 palabras
- Estructura: introducción, desarrollo, clímax y moraleja explícita al final
- Incluye diálogos para darle vida
- Lenguaje claro, cálido e imaginativo${avoidLine}

Después del cuento, crea exactamente 3 preguntas de comprensión de opción múltiple para niños.
Cada pregunta tiene 3 opciones y solo una es correcta.

Responde ÚNICAMENTE con un objeto JSON con este formato exacto (sin markdown, sin bloques de código):
{
  "title": "El título del cuento",
  "content": "El texto completo del cuento...",
  "questions": [
    { "q": "¿Pregunta 1?", "options": ["opción a", "opción b", "opción c"], "answer": 0 },
    { "q": "¿Pregunta 2?", "options": ["opción a", "opción b", "opción c"], "answer": 1 },
    { "q": "¿Pregunta 3?", "options": ["opción a", "opción b", "opción c"], "answer": 2 }
  ]
}
El campo "answer" es el índice (0, 1 o 2) de la opción correcta.`;
}

async function generateStory(api_key, recentTitles = []) {
  if (!api_key) throw new Error("API key requerida");

  const prompt = buildStoryPrompt(recentTitles);

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
      const story = await generateStory(body.api_key, body.recent_titles || []);
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
