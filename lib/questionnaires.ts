export type QuestionType = "short" | "long" | "choice" | "multi" | "scale"

export interface Question {
  id: string
  order: number
  type: QuestionType
  text: string
  required: boolean
  options: string[] | null
  scaleMin: number | null
  scaleMax: number | null
  scaleLabels: { min: string; max: string } | null
  placeholder: string | null
}

export interface QuestionnaireDoc {
  id: string
  title: string
  description: string | null
  status: "draft" | "active" | "closed"
  createdByUid: string
  createdAt: string
  clientLabel: string | null
  questions: Question[]
  completedAt: string | null
  completedByUid: string | null
}

export interface Answer {
  questionId: string
  questionText: string
  type: QuestionType
  value: string | string[] | number | null
}

export interface QuestionnaireResponse {
  id: string
  questionnaireId: string
  workspaceId: string
  submittedByUid: string
  submittedAt: string
  answers: Answer[]
}

function toIso(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null
  return toIso(value)
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readStringOrNull(value: unknown): string | null {
  const text = readString(value).trim()
  return text ? text : null
}

function readQuestionType(value: unknown): QuestionType {
  return value === "long" ||
    value === "choice" ||
    value === "multi" ||
    value === "scale" ||
    value === "short"
    ? value
    : "short"
}

function readStatus(value: unknown): QuestionnaireDoc["status"] {
  return value === "active" || value === "closed" || value === "draft" ? value : "draft"
}

function normalizeOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const options = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  )
  return options.length ? options : null
}

function normalizeScaleLabels(value: unknown): { min: string; max: string } | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const min = readString(data.min).trim()
  const max = readString(data.max).trim()
  return min || max ? { min, max } : null
}

function normalizeQuestion(value: unknown, index: number): Question | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const text = readString(data.text).trim()
  if (!text) return null
  const type = readQuestionType(data.type)
  const order = typeof data.order === "number" && Number.isFinite(data.order) ? data.order : index + 1
  return {
    id: readString(data.id).trim() || `q-${index + 1}`,
    order,
    type,
    text,
    required: data.required === true,
    options: type === "choice" || type === "multi" ? normalizeOptions(data.options) : null,
    scaleMin: type === "scale" && typeof data.scaleMin === "number" ? data.scaleMin : null,
    scaleMax: type === "scale" && typeof data.scaleMax === "number" ? data.scaleMax : null,
    scaleLabels: type === "scale" ? normalizeScaleLabels(data.scaleLabels) : null,
    placeholder: readStringOrNull(data.placeholder),
  }
}

function normalizeAnswer(value: unknown): Answer | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const questionId = readString(data.questionId).trim()
  const questionText = readString(data.questionText).trim()
  const type = readQuestionType(data.type)
  if (!questionId || !questionText) return null
  const answerValue = data.value
  return {
    questionId,
    questionText,
    type,
    value:
      typeof answerValue === "string" ||
      typeof answerValue === "number" ||
      answerValue === null ||
      (Array.isArray(answerValue) && answerValue.every((item) => typeof item === "string"))
        ? answerValue
        : null,
  }
}

export function normalizeQuestionnaire(
  id: string,
  data: Record<string, unknown>
): QuestionnaireDoc {
  const questions = Array.isArray(data.questions)
    ? data.questions
        .map((question, index) => normalizeQuestion(question, index))
        .filter((question): question is Question => Boolean(question))
        .sort((a, b) => a.order - b.order)
    : []

  return {
    id,
    title: readString(data.title).trim() || "Untitled intake form",
    description: readStringOrNull(data.description),
    status: readStatus(data.status),
    createdByUid: readString(data.createdByUid),
    createdAt: toIso(data.createdAt),
    clientLabel: readStringOrNull(data.clientLabel),
    questions,
    completedAt: nullableIso(data.completedAt),
    completedByUid: readStringOrNull(data.completedByUid),
  }
}

export function normalizeResponse(
  id: string,
  data: Record<string, unknown>
): QuestionnaireResponse {
  const answers = Array.isArray(data.answers)
    ? data.answers
        .map((answer) => normalizeAnswer(answer))
        .filter((answer): answer is Answer => Boolean(answer))
    : []

  return {
    id,
    questionnaireId: readString(data.questionnaireId),
    workspaceId: readString(data.workspaceId),
    submittedByUid: readString(data.submittedByUid),
    submittedAt: toIso(data.submittedAt),
    answers,
  }
}

export function isCompleted(q: QuestionnaireDoc): boolean {
  return q.completedAt !== null
}
