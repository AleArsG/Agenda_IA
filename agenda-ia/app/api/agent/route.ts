import { NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import type { AgentAction, AgentResponse } from "@/lib/types";

/* ---------- Configuración y límites (OWASP A04/A05) ---------- */
const MAX_MESSAGE = 1000;
const MAX_HISTORY = 8;
const MAX_STATE_BYTES = 150_000;
const RATE_LIMIT = 20; // peticiones por minuto por IP
const env = process.env;

type Provider = "deepseek" | "openai" | "anthropic";
function pickProvider(): Provider | null {
  const forced = env.AI_PROVIDER as Provider | undefined;
  if (forced && ["deepseek", "openai", "anthropic"].includes(forced)) return forced;
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}
const OPENAI_COMPATIBLE = {
  deepseek: { url: "https://api.deepseek.com/chat/completions", key: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL ?? "deepseek-chat" },
  openai: { url: "https://api.openai.com/v1/chat/completions", key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? "gpt-4o-mini" },
};

const out = (reply: string, status = 200, actions: AgentAction[] = []) =>
  NextResponse.json({ reply, actions } satisfies AgentResponse, { status });

/* ---------- Limitación de tasa en memoria (OWASP A04) ---------- */
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_LIMIT;
}

/* ---------- Sanitización de lo que devuelve la IA (OWASP A03/A08) ---------- */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["class", "assessment", "task", "birthday", "general"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[<>]/g, "").trim().slice(0, max) : "");
const num = (v: unknown, min: number, max: number, def: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v) ? v.slice(0, 16) : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanEvent(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || !TYPES.includes(raw.type)) return null;
  const start = iso(raw.start);
  if (!start) return null;
  const end = iso(raw.end);
  const title = str(raw.title, 120) || "Sin título";
  const base = { type: raw.type, title, start, ...(end ? { end } : {}), notes: str(raw.notes, 500) };
  switch (raw.type) {
    case "class": {
      const days = Array.isArray(raw.recurrence?.daysOfWeek)
        ? [...new Set((raw.recurrence.daysOfWeek as unknown[]).filter((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))] : [];
      const until = typeof raw.recurrence?.until === "string" && DAY.test(raw.recurrence.until) ? raw.recurrence.until : undefined;
      return { ...base, subject: str(raw.subject, 100) || title, room: str(raw.room, 100), professor: str(raw.professor, 100),
        ...(days.length ? { recurrence: { daysOfWeek: days, ...(until ? { until } : {}) } } : {}) };
    }
    case "assessment": {
      const contents = (Array.isArray(raw.contents) ? raw.contents : []).slice(0, 30).map((c: unknown, i: number) => ({
        id: `c-${Date.now().toString(36)}-${i}`, topic: str(typeof c === "string" ? c : (c as { topic?: unknown })?.topic, 120), done: false,
      })).filter((c: { topic: string }) => c.topic);
      return { ...base, subject: str(raw.subject, 100) || title, weightPct: num(raw.weightPct, 0, 100, 0), contents,
        prepStartDate: typeof raw.prepStartDate === "string" && DAY.test(raw.prepStartDate) ? raw.prepStartDate : start.slice(0, 10) };
    }
    case "task":
      return { ...base, description: str(raw.description, 500), status: ["pending", "in_progress", "done"].includes(raw.status) ? raw.status : "pending" };
    case "birthday":
      return { ...base, person: str(raw.person, 100) || title, reminderDaysBefore: num(raw.reminderDaysBefore, 0, 30, 1) };
    default:
      return { ...base, location: str(raw.location, 120) };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanActions(raw: any): AgentAction[] {
  if (!Array.isArray(raw)) return [];
  const res: AgentAction[] = [];
  for (const a of raw.slice(0, 40)) {
    if (a?.kind === "create_event") {
      const event = cleanEvent(a.event);
      if (event) res.push({ kind: "create_event", event } as unknown as AgentAction);
    } else if (a?.kind === "propose_study_sessions" && Array.isArray(a.sessions)) {
      const sessions = a.sessions.slice(0, 60).flatMap((s: Record<string, unknown>) => {
        const start = iso(s?.start), end = iso(s?.end);
        if (!start || !end || end <= start) return [];
        const ids = (Array.isArray(s.contentIds) ? s.contentIds : []).slice(0, 30).map((x: unknown) => str(x, 64)).filter(Boolean);
        return [{ assessmentId: str(s.assessmentId, 64), contentIds: ids, start, end }];
      });
      if (sessions.length) res.push({ kind: "propose_study_sessions", sessions });
    }
  }
  return res;
}

export async function POST(req: Request) {
  /* Verificación de origen: solo peticiones desde este mismo sitio (OWASP A01) */
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  try {
    if (origin && host && new URL(origin).host !== host) return out("Origen no permitido.", 403);
  } catch {
    return out("Solicitud no válida.", 400);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (limited(ip)) return out("Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.", 429);

  /* Validación estricta de la entrada (OWASP A03) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return out("Solicitud no válida.", 400); }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) return out(`El mensaje debe tener entre 1 y ${MAX_MESSAGE} caracteres.`, 400);
  const state = {
    events: Array.isArray(body?.state?.events) ? body.state.events : [],
    studySessions: Array.isArray(body?.state?.studySessions) ? body.state.studySessions : [],
  };
  const stateJson = JSON.stringify(state);
  if (stateJson.length > MAX_STATE_BYTES) return out("La agenda es demasiado grande para analizarla.", 413);
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter((m: { role?: string; content?: unknown }) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (history.length && history[0].role !== "user") history.shift();

  const provider = pickProvider();
  if (!provider) return out("El agente no está configurado: crea .env.local con una clave (ver README) y reinicia el servidor.");

  const system = buildSystemPrompt(new Date().toISOString(), stateJson);
  const turns = [...history, { role: "user", content: message }];
  const signal = AbortSignal.timeout(30_000);

  try {
    let text = "";
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", max_tokens: 1500, system, messages: turns }),
      });
      if (!res.ok) return out(`El servicio de IA respondió con error ${res.status}. Revisa tu clave, saldo o modelo.`, 502);
      const data = await res.json();
      text = (data.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    } else {
      const p = OPENAI_COMPATIBLE[provider];
      const res = await fetch(p.url, {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${p.key ?? ""}` },
        body: JSON.stringify({ model: p.model, max_tokens: 1500, response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, ...turns] }),
      });
      if (!res.ok) return out(`El servicio de IA respondió con error ${res.status}. Revisa tu clave, saldo o modelo.`, 502);
      const data = await res.json();
      text = data.choices?.[0]?.message?.content ?? "";
    }
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      return out(str(parsed.reply, 2000) || "Listo.", 200, cleanActions(parsed.actions));
    } catch {
      return out(str(text, 2000) || "El agente no devolvió una respuesta válida.");
    }
  } catch {
    return out("No pude contactar al servicio de IA. Inténtalo más tarde.", 504);
  }
}
