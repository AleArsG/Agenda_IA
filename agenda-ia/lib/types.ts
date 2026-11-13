export type EventType = "class" | "assessment" | "task" | "birthday" | "general";
export type TaskStatus = "pending" | "in_progress" | "done";

interface BaseEvent {
  id: string;
  type: EventType;
  title: string;
  start: string; // ISO 8601 local
  end?: string;
  notes?: string;
}
export interface ClassEvent extends BaseEvent {
  type: "class"; subject: string; room: string; professor: string;
  recurrence?: { daysOfWeek: number[]; until?: string }; // 0=domingo
}
export interface AssessmentContent { id: string; topic: string; done: boolean; estimatedMinutes?: number }
export interface AssessmentEvent extends BaseEvent {
  type: "assessment"; subject: string; weightPct: number;
  contents: AssessmentContent[]; prepStartDate: string; // YYYY-MM-DD
}
export interface TaskEvent extends BaseEvent {
  type: "task"; description: string; status: TaskStatus; // start = fecha límite
}
export interface BirthdayEvent extends BaseEvent {
  type: "birthday"; person: string; reminderDaysBefore: number;
}
export interface GeneralEvent extends BaseEvent { type: "general"; location?: string }

export type CalendarEvent = ClassEvent | AssessmentEvent | TaskEvent | BirthdayEvent | GeneralEvent;

export interface StudySession {
  id: string; assessmentId: string; contentIds: string[];
  start: string; end: string; status: "suggested" | "accepted" | "completed";
}
export interface CalendarState { events: CalendarEvent[]; studySessions: StudySession[] }

export type AgentAction =
  | { kind: "create_event"; event: Omit<CalendarEvent, "id"> }
  | { kind: "propose_study_sessions"; sessions: Omit<StudySession, "id" | "status">[] };
export interface AgentResponse { reply: string; actions: AgentAction[] }
