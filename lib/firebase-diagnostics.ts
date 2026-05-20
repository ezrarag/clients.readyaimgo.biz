type FirebaseTokenDiagnostics = {
  aud?: string
  iss?: string
  sub?: string
  uid?: string
  email?: string
  authTime?: number
  iat?: number
  exp?: number
  decodeError?: string
}

function readEnv(name: string) {
  return process.env[name]
}

function firebaseErrorSummary(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) }
  }

  const record = error as {
    code?: unknown
    message?: unknown
    errorInfo?: { code?: unknown; message?: unknown }
  }

  return {
    code:
      typeof record.code === "string"
        ? record.code
        : typeof record.errorInfo?.code === "string"
          ? record.errorInfo.code
          : undefined,
    message:
      typeof record.message === "string"
        ? record.message
        : typeof record.errorInfo?.message === "string"
          ? record.errorInfo.message
          : String(error),
  }
}

export function getFirebaseAdminDiagnostics() {
  const privateKey = readEnv("FIREBASE_PRIVATE_KEY") ?? ""
  const projectId = readEnv("FIREBASE_PROJECT_ID") ?? ""
  const clientEmail = readEnv("FIREBASE_CLIENT_EMAIL") ?? ""

  return {
    adminProjectId: projectId || null,
    hasAdminProjectId: Boolean(projectId),
    hasClientEmail: Boolean(clientEmail),
    clientEmailProject:
      clientEmail.match(/@([^.]*)\.iam\.gserviceaccount\.com$/)?.[1] ?? null,
    hasPrivateKey: Boolean(privateKey),
    privateKeyLength: privateKey.length,
    privateKeyHasBegin: privateKey.includes("BEGIN PRIVATE KEY"),
    privateKeyHasEscapedNewlines: privateKey.includes("\\n"),
    privateKeyHasRealNewlines: privateKey.includes("\n"),
    publicFirebaseProjectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID") ?? null,
    publicFirebaseAuthDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") ?? null,
  }
}

export function decodeFirebaseIdTokenForDiagnostics(
  idToken: string | null
): FirebaseTokenDiagnostics | null {
  if (!idToken) return null

  try {
    const payload = idToken.split(".")[1]
    if (!payload) return { decodeError: "Token does not contain a JWT payload." }

    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      )
    ) as Record<string, unknown>

    return {
      aud: typeof decoded.aud === "string" ? decoded.aud : undefined,
      iss: typeof decoded.iss === "string" ? decoded.iss : undefined,
      sub: typeof decoded.sub === "string" ? decoded.sub : undefined,
      uid: typeof decoded.user_id === "string" ? decoded.user_id : undefined,
      email: typeof decoded.email === "string" ? decoded.email : undefined,
      authTime: typeof decoded.auth_time === "number" ? decoded.auth_time : undefined,
      iat: typeof decoded.iat === "number" ? decoded.iat : undefined,
      exp: typeof decoded.exp === "number" ? decoded.exp : undefined,
    }
  } catch (error) {
    return {
      decodeError: error instanceof Error ? error.message : "Unable to decode token.",
    }
  }
}

export function buildFirebaseAuthFailureDiagnostics(
  idToken: string | null,
  error: unknown
) {
  return {
    admin: getFirebaseAdminDiagnostics(),
    token: decodeFirebaseIdTokenForDiagnostics(idToken),
    error: firebaseErrorSummary(error),
  }
}

