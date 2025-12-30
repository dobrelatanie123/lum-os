## Usługa OpenRouter — przewodnik implementacji (Astro + React + TypeScript + Bun)

> Fragment kontekstu stacku (dla uzasadnienia decyzji projektowych):
>
> - "Frontend - Astro z React dla komponentów interaktywnych"; "TypeScript 5"; "Tailwind 4"; "Shadcn/ui".
> - "Backend - Supabase jako kompleksowe rozwiązanie backendowe".
> - "AI - Komunikacja z modelami przez usługę Openrouter.ai".
>
> Cytaty pochodzą z `opisy/tech-stack.md` i determinują kierunek integracji z API OpenRouter w architekturze serwerowej (Astro endpoints) z klientem (React) oraz z mechanizmami bezpieczeństwa i zarządzania kluczami.

---

### 1. Opis usługi

Usługa OpenRouter zapewnia jednolitą warstwę do komunikacji z API OpenRouter w celu wykonywania czatów LLM (synchronicznych i strumieniowych), z naciskiem na:
- konfigurację modelu i parametrów wykonania,
- wsparcie dla ustrukturyzowanych odpowiedzi `response_format` (JSON Schema),
- bezpieczne przekazywanie komunikatów (system/user),
- odporność na błędy (retry, timeouts, klasyfikacja błędów),
- logowanie i metryki, zgodne z wymaganiami CI/CD i hostingu.

Warstwa jest przeznaczona do użycia w serwerowych endpointach Astro (np. `src/pages/api/*.ts`) i może wystawiać strumień do klienta React. Klucz API jest przechowywany wyłącznie po stronie serwera (np. w `.env`), nigdy w kliencie.

---

### 2. Opis konstruktora

Przykładowa klasa: `OpenRouterService` (TypeScript), odpowiedzialna za konfigurację i wykonywanie żądań.

```ts
export type OpenRouterParams = {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
};

export type RetryPolicy = {
  maxAttempts: number;       // np. 3
  baseDelayMs: number;       // np. 250
  maxDelayMs: number;        // np. 2000
  jitter?: boolean;          // zalecane: true
  retryOnHttp?: number[];    // np. [408, 429, 500, 502, 503, 504]
};

export type OpenRouterServiceOptions = {
  apiKey: string;            // wymagane (z env)
  baseURL?: string;          // domyślnie 'https://openrouter.ai/api/v1'
  defaultModel?: string;     // np. 'anthropic/claude-3.5-sonnet'
  defaultParams?: OpenRouterParams;
  requestTimeoutMs?: number; // np. 30000
  retry?: RetryPolicy;       // polityka retry
  enableLogging?: boolean;   // bezpieczne logi (bez PII)
};

export class OpenRouterService {
  constructor(private readonly options: OpenRouterServiceOptions) {}
}
```

Konstruktor przyjmuje opcje, waliduje je i przygotowuje domyślną konfigurację, w tym nagłówki autoryzacji, timeout i retry.

---

### 3. Publiczne metody i pola

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type JsonSchemaResponseFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;         // nazwa schematu
    strict: true;         // WYMAGANE: strict=true wymusza ustrukturyzowaną odpowiedź
    schema: object;       // obiekt JSON Schema (Draft-07+)
  };
};

export type ChatRequest = {
  model?: string;
  messages: ChatMessage[];
  response_format?: JsonSchemaResponseFormat; // opcjonalne
  params?: OpenRouterParams;                  // nadpisanie domyślnych parametrów
  stream?: boolean;                           // true = SSE/stream
  metadata?: Record<string, string | number | boolean>;
};

export type ChatResponse = {
  id: string;
  model: string;
  content: string;           // scalone treści asystenta (tryb non-stream)
  raw: unknown;              // surowa odpowiedź OpenRouter
};

export class OpenRouterService {
  // ...ctor

  // 3.1. Wywołanie synchroniczne (non-stream)
  async chatCompletion(request: ChatRequest): Promise<ChatResponse> { /* ... */ }

  // 3.2. Wywołanie strumieniowe (SSE)
  async streamChatCompletion(request: ChatRequest): Promise<ReadableStream> { /* ... */ }

  // 3.3. Walidacja odpowiedzi względem JSON Schema (gdy strict=true)
  validateJsonSchemaResponse<T>(content: string, schema: object): T { /* ... */ }

  // 3.4. Pomocnicze budowanie wiadomości (system + user)
  buildMessages(system: string, user: string): ChatMessage[] { /* ... */ }

  // 3.5. Pomocnicze budowanie response_format
  buildResponseFormat(name: string, schema: object): JsonSchemaResponseFormat { /* ... */ }
}
```

Wybrane detale funkcjonalne:
- `chatCompletion` — wykonuje żądanie `POST /chat/completions` do OpenRouter, łączy odpowiedzi w jeden `content`, respektuje `response_format` i parametry modelu.
- `streamChatCompletion` — uruchamia strumień (SSE / `text/event-stream`) i zwraca `ReadableStream`, który można dalej przekazać do klienta (np. `return new Response(stream)` w handlerze Astro).
- `validateJsonSchemaResponse` — w trybie `strict` weryfikuje, czy model zwrócił poprawny JSON zgodny ze schematem. W razie niezgodności rzuca kontrolowany błąd walidacji.
- `buildMessages` — wygodne tworzenie listy komunikatów.
- `buildResponseFormat` — gwarantuje poprawną strukturę `{ type: 'json_schema', json_schema: { name, strict: true, schema } }`.

---

### 4. Prywatne metody i pola

Proponowane elementy wewnętrzne klasy:

```ts
class OpenRouterService {
  private readonly baseURL: string;
  private readonly defaultModel?: string;
  private readonly defaultParams: OpenRouterParams;
  private readonly retry: RetryPolicy;
  private readonly requestTimeoutMs: number;
  private readonly enableLogging: boolean;

  private buildHeaders(): Headers { /* ustawia Authorization: Bearer, X-Title, Content-Type */ }
  private async doRequest<T>(path: string, body: unknown, stream?: boolean): Promise<T | ReadableStream> { /* fetch + timeout */ }
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> { /* exponential backoff + jitter */ }
  private classifyError(e: unknown): { code: string; retryable: boolean; http?: number } { /* sieć/HTTP/parsowanie */ }
  private redact(obj: unknown): unknown { /* usuń PII/klucz */ }
}
```

Cele:
- hermetyzacja szczegółów transportu (nagłówki, timeouty, retry),
- bezpieczne logowanie (bez PII i bez kluczy),
- czytelne mapowanie błędów do kodów domenowych (np. `ERR_RATE_LIMIT`, `ERR_SCHEMA_VALIDATION`).

---

### 5. Przykłady kluczowych elementów OpenRouter (1–5)

1) Komunikat systemowy (konfiguracja ról i kontekstu)

```ts
const systemMessage = {
  role: 'system',
  content: 'Jesteś pomocnym asystentem. Odpowiadaj krótko i rzeczowo.'
} as const;
```

2) Komunikat użytkownika (wejście końcowego użytkownika)

```ts
const userMessage = {
  role: 'user',
  content: 'Wypisz trzy najważniejsze zalety TypeScript.'
} as const;
```

3) Ustrukturyzowane odpowiedzi — response_format (JSON Schema, strict)

```ts
const benefitsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['benefits'],
  properties: {
    benefits: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string', minLength: 3 }
    }
  }
} as const;

const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'typescript_benefits',
    strict: true,
    schema: benefitsSchema
  }
} as const;
```

4) Nazwa modelu (zgodna z katalogiem OpenRouter)

```ts
// Przykłady identyfikatorów; dobierz do potrzeb i dostępności w OpenRouter:
const modelId = 'anthropic/claude-3.5-sonnet';
// alternatywy: 'openai/gpt-4o-mini', 'google/gemini-1.5-pro', 'meta-llama/llama-3.1-70b-instruct'
```

5) Parametry modelu (kontrola stylu i długości odpowiedzi)

```ts
const params = {
  temperature: 0.2,
  max_tokens: 300,
  top_p: 0.95,
  frequency_penalty: 0,
  presence_penalty: 0,
  seed: 42
} satisfies OpenRouterParams;
```

Łączenie elementów w wywołaniu synchronicznym:

```ts
const svc = new OpenRouterService({
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultModel: modelId,
  defaultParams: { temperature: 0.3 },
  retry: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2000, jitter: true, retryOnHttp: [408,429,500,502,503,504] },
  requestTimeoutMs: 30000,
  enableLogging: true
});

const res = await svc.chatCompletion({
  model: modelId,
  messages: [systemMessage, userMessage],
  response_format: responseFormat,
  params
});

// Jeśli strict=true, można dodatkowo zatwierdzić zgodność JSON
const parsed = svc.validateJsonSchemaResponse<{ benefits: string[] }>(res.content, benefitsSchema);
```

Strumieniowanie (SSE) z Astro endpointu:

```ts
// src/pages/api/chat.ts
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const { prompt } = await request.json();

  const svc = new OpenRouterService({ apiKey: process.env.OPENROUTER_API_KEY! });

  const messages = svc.buildMessages(
    'Jesteś asystentem, który odpowiada zdaniami do 10 słów.',
    String(prompt ?? '')
  );

  const stream = await svc.streamChatCompletion({
    messages,
    model: 'openai/gpt-4o-mini',
    params: { temperature: 0.5 },
    stream: true
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
};
```

---

### 6. Obsługa błędów

Potencjalne scenariusze i reakcje (numeracja):

1) Brak/nieprawidłowy klucz API (401/403):
- odpowiedź: przerwij żądanie, zwróć 401 do klienta (bez detali), zaloguj bez PII.

2) Limit zapytań (429):
- odpowiedź: retry z backoff (polityka `retry`), zwróć 429 do klienta z komunikatem „spróbuj ponownie”.

3) Błędy 5xx upstream (500/502/503/504):
- odpowiedź: retry z backoff, loguj klasy błędów, po wyczerpaniu prób — 502/503 do klienta.

4) Przekroczony timeout (sieć/serwer):
- odpowiedź: przerwij fetch (AbortController), spróbuj ponownie (gdy retryable), finalnie 504.

5) Nieobsługiwany model/nieprawidłowa nazwa modelu (400/404):
- odpowiedź: waliduj model po stronie serwera (lista dozwolonych), komunikat „Model niedostępny”.

6) Niezgodność z JSON Schema (strict=true):
- odpowiedź: rzuć kontrolowany `ERR_SCHEMA_VALIDATION` z informacją co nie przeszło, nie ujawniaj treści prywatnych.

7) Błąd parsowania JSON (nie-strict lub strumień):
- odpowiedź: bezpieczne parsowanie i fallback (np. zwróć surową treść w `raw`), raportuj metrykę.

8) Zbyt duża paczka (413):
- odpowiedź: komunikat o skróceniu wejścia, opcjonalny chunking/kompresja promptów.

9) Błąd SSE (połączenie przerwane, niepełny strumień):
- odpowiedź: zamknij strumień, zaproponuj retry z resume (jeśli obsługiwane), loguj zdarzenie.

10) Moderacja/zablokowana treść (418/400 specyficzne):
- odpowiedź: mapuj do `ERR_CONTENT_BLOCKED`, prezentuj neutralny komunikat użytkownikowi.

---

### 7. Kwestie bezpieczeństwa

- Klucz `OPENROUTER_API_KEY` trzymamy tylko po stronie serwera (plik `.env`, nie eksportować do klienckiego bundla).
- Walidacja wejścia: ogranicz długość promptu, whitelistuj modele, filtruj nagłówki.
- Rate limiting (Redis/Supabase/Edge): chroni przed nadużyciami; mapuj 429.
- Logowanie bez PII: redaguj dane, nie zapisuj treści promptów w surowej formie (opcjonalnie skróty/hashe).
- Timeouts + circuit breaker: ogranicz czas oczekiwania i przerywaj lawinę błędów upstream.
- Audyt i least-privilege: ogranicz dostęp do zmiennych środowiskowych (CI/CD, DO droplet/secret).

---

### 8. Plan wdrożenia krok po kroku (Astro + Bun + TS)

1) Zmienne środowiskowe

```bash
# .env (serwer)
OPENROUTER_API_KEY="sk-or-..."
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1" # opcjonalnie
```

2) Zależności (Bun)

```bash
bun add zod
```

3) Implementacja usługi

- Ścieżka sugerowana: `astro/src/lib/openrouter.service.ts`.
- Zaimplementuj `OpenRouterService` zgodnie z sekcjami 2–4 (fetch, retry, SSE, walidacja schema, logowanie, redakcja logów).

Szkic krytycznych fragmentów:

```ts
const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

private async doRequest<T>(path: string, body: unknown, stream = false): Promise<T | ReadableStream> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
  try {
    const res = await fetch(`${this.baseURL ?? DEFAULT_BASE}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (stream) return res.body as ReadableStream;
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error('Upstream error'), { http: res.status, json });
    return json as T;
  } finally {
    clearTimeout(to);
  }
}
```

4) Endpoint Astro (synchroniczny i/lub SSE)

- Utwórz `src/pages/api/chat.ts` (jak w przykładach w sekcji 5).
- W wariancie synchronicznym zwracaj `application/json`, w strumieniowym `text/event-stream`.

5) Integracja w React (klient)

- Wywołuj endpoint Astro przez `fetch` (POST), w strumieniowym czytaj `ReadableStream` i aktualizuj UI.
- Nie przekazuj klucza API do klienta.

6) Walidacja JSON Schema (strict)

- Gdy korzystasz z `response_format`, po stronie serwera wywołaj `validateJsonSchemaResponse` i przekaż użytkownikowi już sprawdzony JSON.

7) Monitoring i retry

- Zbieraj metryki: czas odpowiedzi, współczynnik błędów, liczba retry.
- Ustal rozsądne limity: `maxAttempts=3`, `timeout=30s`.

8) Testy (Vitest)

- Dodaj testy jednostkowe: parsowanie strumienia, walidacja schema, klasyfikacja błędów, retry na 429/5xx.

9) CI/CD i sekret

- W GitHub Actions ustaw secret `OPENROUTER_API_KEY`.
- Na DigitalOcean skonfiguruj zmienne środowiskowe instancji.

---

#### Załącznik: Minimalny kontrakt żądania do OpenRouter (referencyjny)

```ts
// Body /chat/completions (uogólniony, zgodny z większością modeli w OpenRouter)
{
  model: string,                    // np. 'anthropic/claude-3.5-sonnet'
  messages: { role: 'system'|'user'|'assistant', content: string }[],
  response_format?: {
    type: 'json_schema',
    json_schema: { name: string, strict: true, schema: object }
  },
  temperature?: number,
  max_tokens?: number,
  top_p?: number,
  frequency_penalty?: number,
  presence_penalty?: number,
  seed?: number,
  stream?: boolean
}
```

Przewodnik pokrywa: strukturę klasy, publiczne/prywatne API, przykłady elementów (system/user/response_format/model/parametry), obsługę błędów, bezpieczeństwo oraz praktyczne kroki wdrożenia zgodne z Astro + React + TS + Bun i z usługą OpenRouter.
