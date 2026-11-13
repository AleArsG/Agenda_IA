"use client";
import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent, StudySession, AgentResponse, EventType } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const iso = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const at = (n: number, h: number, m = 0) => `${ymd(addDays(new Date(), n))}T${pad(h)}:${pad(m)}`;
const hhmm = (s: string) => s.slice(11, 16);
const STORAGE_KEY = "agenda-ia:v1";

type Kind = EventType | "study";
const STYLE: Record<Kind, { label: string; cls: string }> = {
  class: { label: "Clase", cls: "bg-sky-100 text-sky-900 border-sky-500" },
  assessment: { label: "Prueba", cls: "bg-rose-100 text-rose-900 border-rose-500" },
  task: { label: "Tarea", cls: "bg-amber-100 text-amber-900 border-amber-500" },
  birthday: { label: "Cumpleaños", cls: "bg-pink-100 text-pink-900 border-pink-500" },
  general: { label: "Evento", cls: "bg-emerald-100 text-emerald-900 border-emerald-500" },
  study: { label: "Estudio", cls: "bg-violet-100 text-violet-900 border-violet-500" },
};
const ACADEMIC: EventType[] = ["class", "assessment", "task"];

const seed = (): CalendarEvent[] => []; // la agenda comienza totalmente vacía

type Item = { id: string; title: string; start: string; kind: Kind };
type Msg = { role: "user" | "assistant"; content: string };
type Mode = null | "del" | "mv";

export default function AgendaApp() {
  const [events, setEvents] = useState<CalendarEvent[]>(seed);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"month" | "week" | "today">("week");
  const [filter, setFilter] = useState<"all" | "academic" | "personal">("all");
  const [mode, setMode] = useState<Mode>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hola, soy tu Tutor. Tu agenda está vacía. Cuéntame tus horarios en texto libre, por ejemplo: «Tengo Programación lunes y miércoles de 9 a 11 en la sala 204» o «El próximo martes tengo prueba de Bases de Datos sobre índices y SQL normalizado»." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", type: "general" as EventType, date: ymd(new Date()), time: "10:00" });

  // Persistencia local (localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const s = JSON.parse(raw); setEvents(s.events ?? seed()); setSessions(s.sessions ?? []); }
    } catch { /* datos corruptos: se usan los de ejemplo */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify({ events, sessions }));
  }, [events, sessions, loaded]);

  const items: Item[] = useMemo(() => {
    const base: Item[] = events
      .filter((e) => filter === "all" || (filter === "academic") === ACADEMIC.includes(e.type))
      .map((e) => ({ id: e.id, title: e.title, start: e.start, kind: e.type }));
    const study: Item[] = filter === "personal" ? [] : sessions.map((s) => ({
      id: s.id, kind: "study" as const, start: s.start,
      title: `Estudio: ${events.find((e) => e.id === s.assessmentId)?.title ?? ""}${s.status === "suggested" ? " (sugerido)" : ""}`,
    }));
    return [...base, ...study].sort((a, b) => a.start.localeCompare(b.start));
  }, [events, sessions, filter]);

  const alerts = useMemo(() => {
    const now = new Date(), out: string[] = [], today = ymd(now);
    events.forEach((e) => {
      const hrs = (+new Date(e.start) - +now) / 36e5;
      if (e.type !== "birthday" && hrs > 0 && hrs <= 6) out.push(`⏰ ${e.title} a las ${hhmm(e.start)}`);
      if (e.type === "assessment" && e.prepStartDate <= today && hrs > 0) {
        const pend = e.contents.filter((c) => !c.done).map((c) => c.topic);
        out.push(`📚 Te quedan ${Math.ceil(hrs / 24)} días para tu prueba de ${e.subject}. Contenidos pendientes: ${pend.join(", ") || "todo listo"}`);
      }
      if (e.type === "birthday" && hrs > -24 && hrs <= 24 * 7) out.push(`🎂 Cumpleaños de ${e.person}: ${e.start.slice(0, 10)}`);
    });
    return out;
  }, [events]);

  const send = async (text: string) => {
    text = text.trim().slice(0, 1000);
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: "user", content: text }]); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, state: { events, studySessions: sessions }, history: msgs.slice(1) }),
      });
      const data: AgentResponse = await res.json();
      data.actions?.forEach((a) => {
        if (a.kind === "create_event") setEvents((p) => [...p, { ...a.event, id: crypto.randomUUID() } as CalendarEvent]);
        if (a.kind === "propose_study_sessions")
          setSessions((p) => [...p, ...a.sessions.map((s) => ({ ...s, id: crypto.randomUUID(), status: "suggested" as const }))]);
      });
      setMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Error de conexión con el agente." }]);
    }
    setBusy(false);
  };

  const remove = (id: string) => {
    setEvents((p) => p.filter((e) => e.id !== id));
    setSessions((p) => p.filter((s) => s.id !== id));
  };
  const startEdit = (id: string) => {
    const ev = events.find((e) => e.id === id), se = sessions.find((s) => s.id === id);
    const start = ev?.start ?? se?.start;
    if (!start) return;
    setForm({ title: ev?.title ?? "Estudio", type: ev?.type ?? "general", date: start.slice(0, 10), time: hhmm(start) });
    setEditId(id); setMode(null);
  };
  const cancelEdit = () => { setEditId(null); setForm((f) => ({ ...f, title: "" })); };

  const saveForm = () => {
    if (!form.title.trim()) return;
    const start = `${form.date}T${form.time}`;
    if (editId) {
      setEvents((p) => p.map((e) => {
        if (e.id !== editId) return e;
        const shift = e.end ? +new Date(e.end) - +new Date(e.start) : 0;
        return { ...e, title: form.title, start, ...(e.end ? { end: iso(new Date(+new Date(start) + shift)) } : {}) };
      }));
      setSessions((p) => p.map((s) => s.id !== editId ? s : { ...s, start, end: iso(new Date(+new Date(start) + (+new Date(s.end) - +new Date(s.start)))) }));
      cancelEdit(); return;
    }
    const base = { id: crypto.randomUUID(), title: form.title, start };
    const byType: Record<EventType, CalendarEvent> = {
      class: { ...base, type: "class", subject: form.title, room: "", professor: "" },
      assessment: { ...base, type: "assessment", subject: form.title, weightPct: 0, contents: [], prepStartDate: form.date },
      task: { ...base, type: "task", description: "", status: "pending" },
      birthday: { ...base, type: "birthday", person: form.title, reminderDaysBefore: 1 },
      general: { ...base, type: "general" },
    };
    setEvents((p) => [...p, byType[form.type]]);
    setForm({ ...form, title: "" });
  };

  const chip = (it: Item) => (
    <div key={it.id} className={`relative rounded border-l-4 px-1.5 py-0.5 text-xs ${STYLE[it.kind].cls}`}>
      <b>{hhmm(it.start) !== "00:00" ? hhmm(it.start) : ""}</b> {it.title}
      {mode && (
        <button
          aria-label={mode === "del" ? "Eliminar" : "Reagendar"}
          onClick={() => (mode === "del" ? remove(it.id) : startEdit(it.id))}
          className={`absolute -right-1 -top-2 z-10 h-6 w-6 rounded-full text-xs text-white ${mode === "del" ? "bg-rose-600" : "bg-indigo-600"}`}
        >
          {mode === "del" ? "✕" : "✎"}
        </button>
      )}
    </div>
  );
  const dayItems = (d: Date): Item[] => {
    const key = ymd(d);
    const rec: Item[] = filter === "personal" ? [] : events.flatMap((e) =>
      e.type === "class" && e.recurrence && Array.isArray(e.recurrence.daysOfWeek) && key > e.start.slice(0, 10) &&
      (!e.recurrence.until || key <= e.recurrence.until) && e.recurrence.daysOfWeek.includes(d.getDay())
        ? [{ id: e.id, title: e.title, start: `${key}T${hhmm(e.start)}`, kind: "class" as const }] : []);
    return [...items.filter((i) => i.start.startsWith(key)), ...rec].sort((a, b) => a.start.localeCompare(b.start));
  };
  const today = new Date();
  const weekStart = addDays(today, -((today.getDay() + 6) % 7));
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const gridStart = addDays(monthStart, -((monthStart.getDay() + 6) % 7));
  const toggle = (m: Exclude<Mode, null>) => setMode((cur) => (cur === m ? null : m));
  const btn = "rounded border bg-white px-3 py-1";

  return (
    <div className="grid min-h-screen gap-4 bg-stone-50 p-4 text-stone-900 lg:grid-cols-[1fr_340px]">
      <main className="min-w-0 space-y-4">
        <h1 className="text-xl font-semibold">Agenda inteligente</h1>
        <section className="rounded-lg border border-stone-300 bg-white p-3">
          <h2 className="mb-2 font-semibold">Alertas</h2>
          {alerts.length ? <ul className="space-y-1 text-sm">{alerts.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p className="text-sm text-stone-500">{events.length === 0 ? "Tu agenda está vacía. Pídele al Tutor que cargue tus horarios y pruebas." : "Sin urgencias. Buen momento para adelantar estudio."}</p>}
        </section>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(["month", "week", "today"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`${btn} ${view === v ? "!bg-stone-900 text-white" : ""}`}>{{ month: "Mes", week: "Semana", today: "Hoy" }[v]}</button>
          ))}
          <span className="mx-2 h-4 w-px bg-stone-300" />
          {(["all", "academic", "personal"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`${btn} ${filter === f ? "!bg-indigo-600 text-white" : ""}`}>{{ all: "Todo", academic: "Solo académico", personal: "Personal" }[f]}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 text-xs">
          {Object.values(STYLE).map((s) => <span key={s.label} className={`rounded border-l-4 px-2 py-0.5 ${s.cls}`}>{s.label}</span>)}
        </div>

        {view === "week" && (
          <div className="grid gap-2 overflow-x-auto md:grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => (
              <div key={+d} className={`min-h-32 min-w-[110px] space-y-1.5 rounded border bg-white p-1.5 ${ymd(d) === ymd(today) ? "ring-2 ring-indigo-500" : ""}`}>
                <div className="text-xs font-semibold">{d.toLocaleDateString("es", { weekday: "short", day: "numeric" })}</div>
                {dayItems(d).map(chip)}
              </div>
            ))}
          </div>
        )}
        {view === "month" && (
          <div className="grid grid-cols-7 gap-1 overflow-x-auto">
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => (
              <div key={+d} className={`min-h-20 min-w-[84px] space-y-1.5 rounded border bg-white p-1 ${d.getMonth() !== today.getMonth() ? "opacity-40" : ""}`}>
                <div className="text-xs">{d.getDate()}</div>
                {dayItems(d).map(chip)}
              </div>
            ))}
          </div>
        )}
        {view === "today" && (
          <ol className="space-y-2 border-l-2 border-stone-300 pl-4">
            {dayItems(today).length === 0 && <p className="text-sm text-stone-500">Nada para hoy. Pídele al agente un bloque de estudio.</p>}
            {dayItems(today).map((it) => <li key={it.id}>{chip(it)}</li>)}
          </ol>
        )}

        {sessions.some((s) => s.status === "suggested") && (
          <button className="rounded bg-violet-600 px-3 py-1 text-sm text-white" onClick={() => setSessions((p) => p.map((s) => ({ ...s, status: "accepted" })))}>
            Aceptar todos los bloques sugeridos
          </button>
        )}

        <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3 text-sm">
          <input className="rounded border px-2 py-1" maxLength={120} placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="rounded border px-2 py-1 disabled:opacity-50" disabled={!!editId} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>
            {(Object.keys(STYLE) as Kind[]).filter((k) => k !== "study").map((k) => <option key={k} value={k}>{STYLE[k].label}</option>)}
          </select>
          <input type="date" className="rounded border px-2 py-1" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input type="time" className="rounded border px-2 py-1" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          <button onClick={saveForm} className="rounded bg-stone-900 px-3 py-1 text-white">{editId ? "Guardar cambios" : "Agregar"}</button>
          {editId && <button onClick={cancelEdit} className={btn}>Cancelar</button>}
          <button onClick={() => toggle("mv")} className={`${btn} ${mode === "mv" ? "ring-2 ring-indigo-500" : ""}`}>Reagendar</button>
          <button onClick={() => toggle("del")} className={`${btn} ${mode === "del" ? "ring-2 ring-rose-500" : ""}`}>Eliminar</button>
          <button onClick={() => { if (confirm("¿Restablecer los datos de ejemplo?")) { setEvents(seed()); setSessions([]); } }} className={`${btn} ml-auto`}>Restablecer</button>
        </section>
        <p className="text-xs text-stone-500">Tus datos se guardan solo en este navegador. Lo que escribes al Tutor se envía al proveedor de IA para responderte; no escribas datos sensibles.</p>
        {mode && <p className="text-xs text-stone-500">{mode === "del" ? "Toca la ✕ de un evento para eliminarlo." : "Toca el ✎ de un evento para reagendarlo."}</p>}
      </main>

      <aside className="flex h-[80vh] flex-col rounded-lg border border-stone-300 bg-white lg:sticky lg:top-4">
        <h2 className="border-b p-3 font-semibold">Tutor</h2>
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          {msgs.map((m, i) => <p key={i} className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 ${m.role === "user" ? "ml-auto bg-indigo-600 text-white" : "bg-stone-100"}`}>{m.content}</p>)}
          {busy && <p className="text-stone-500">Pensando…</p>}
        </div>
        <div className="flex flex-wrap gap-1 px-3 text-xs">
          {["Quiero cargar mi horario de clases", "¿Qué tengo que estudiar hoy?", "Planifica mis bloques de estudio"].map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border px-2 py-0.5">{q}</button>)}
        </div>
        <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="min-w-0 flex-1 rounded border px-2 py-1" value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="Escribe al Tutor…" />
          <button className="rounded bg-indigo-600 px-3 text-white">Enviar</button>
        </form>
      </aside>
    </div>
  );
}
