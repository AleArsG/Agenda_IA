# Agenda IA

Agenda inteligente y planificador de estudio con un agente de IA integrado (Next.js 14, React, TypeScript, Tailwind CSS).

## Funciones
- La agenda parte **vacía**: se carga conversando con el Tutor (p. ej. «Tengo Programación lunes y miércoles de 9 a 11»).
- Tipos de evento: clases, pruebas (con contenidos y fecha de inicio de preparación), tareas, cumpleaños y eventos generales.
- Vistas mensual, semanal y de hoy; color por tipo; filtros «Solo académico» y «Personal».
- Agregar, reagendar y eliminar eventos. Los datos se guardan en el navegador (localStorage).
- Widget de alertas: eventos próximos, recordatorios de preparación y cumpleaños de los próximos 7 días.
- Tutor (IA): planifica bloques de estudio, responde preguntas sobre tu agenda y crea eventos a partir de texto libre.

## Requisitos
Node.js 18.17 o superior y una clave de API de DeepSeek, OpenAI o Anthropic (solo para el agente; el resto funciona sin ella).

## Puesta en marcha
```bash
npm install
cp .env.example .env.local   # edita y pega tu clave (DEEPSEEK_API_KEY, OPENAI_API_KEY o ANTHROPIC_API_KEY)
npm run dev                  # http://localhost:3000
```
Para producción: `npm run build && npm start`. Puedes desplegarlo en Vercel añadiendo tu clave en Environment Variables.

## Estructura
```
app/            layout, página y API (app/api/agent/route.ts)
components/     AgendaApp.tsx (dashboard, calendario y chat)
lib/types.ts    modelos: CalendarEvent, AssessmentContent, StudySession, AgentAction…
lib/system-prompt.ts   prompt del agente
demo/index.html demo estática sin dependencias (agente con reglas locales)
```

## Cómo funciona el agente
El navegador envía el mensaje y el estado del calendario a `/api/agent`. El servidor (donde vive la clave) arma el system prompt con la fecha actual y el JSON del calendario, llama al modelo y devuelve `{ reply, actions }`. Las acciones (`create_event`, `propose_study_sessions`) se aplican al estado; los bloques de estudio quedan como «sugeridos» hasta que los aceptas.

## Seguridad
La clave nunca se envía al navegador y `.env.local` está en `.gitignore`. La API valida entradas, limita peticiones, comprueba el origen y sanea lo que devuelve la IA. Detalle por categoría OWASP en [SECURITY.md](SECURITY.md).

## Mejoras posibles
Base de datos (Prisma + SQLite/Postgres), autenticación, edición completa de contenidos de pruebas, notificaciones push y vista de horario recurrente.

## Demo estática
Abre `demo/index.html` en el navegador, o publícala con GitHub Pages (Settings → Pages → carpeta `/demo`).

## Licencia
MIT
