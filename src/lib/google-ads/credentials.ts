export interface CredentialsInput {
  client_id: string
  /** Empty means "keep the one already stored". */
  client_secret: string
  customer_id: string | null
  login_customer_id: string | null
}

const CLIENT_ID = /^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/

function digits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : ''
}

/**
 * Validates the body of PUT /api/google-ads/connection. Returns the clean
 * value or a Portuguese message for the first problem found. Google Ads
 * shows account ids as 123-456-7890; they are stored as digits.
 */
export function parseCredentialsInput(
  raw: unknown,
): { ok: true; value: CredentialsInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Dados inválidos.' }
  const body = raw as Record<string, unknown>

  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : ''
  if (!CLIENT_ID.test(clientId)) {
    return { ok: false, error: 'O Client ID deve terminar em .apps.googleusercontent.com.' }
  }

  const secret = typeof body.client_secret === 'string' ? body.client_secret.trim() : ''
  if (secret && (secret.length < 10 || secret.length > 200 || /\s/.test(secret))) {
    return { ok: false, error: 'O Client Secret está em formato inválido.' }
  }

  const customer = digits(body.customer_id)
  if (customer && customer.length !== 10) {
    return { ok: false, error: 'O ID da conta do Google Ads tem 10 números (ex.: 123-456-7890).' }
  }
  const login = digits(body.login_customer_id)
  if (login && login.length !== 10) {
    return { ok: false, error: 'O ID da conta gerente (MCC) tem 10 números (ex.: 123-456-7890).' }
  }

  return {
    ok: true,
    value: {
      client_id: clientId,
      client_secret: secret,
      customer_id: customer || null,
      login_customer_id: login || null,
    },
  }
}
