# API Endpoint Implementation Plan: Podcasty, Transkrypcje, Alerty

## 1. Przegląd punktu końcowego
Plan wdrożenia skupia się na zapewnieniu kompleksowych endpointów dla podstawowych funkcjonalności aplikacji, tj. zarządzania podcastami, obsługi transkrypcji oraz alertów. W związku z wykorzystaniem Supabase Auth, logika związana z uwierzytelnianiem użytkowników jest obsługiwana przez Supabase, co eliminuje potrzebę tworzenia dedykowanych endpointów do zarządzania użytkownikami.

## 2. Szczegóły żądania
Dla każdej z głównych funkcjonalności przewidziane są odpowiednie endpointy:

### Podcasty
- **Metody:** GET, POST, PUT, DELETE
- **URL:** `/api/podcasts`
- **Parametry:**
  - *Wymagane:* dla POST/PUT: `title` (string), `description` (string, opcjonalne), `publishedAt` (ISO date, opcjonalne)
  - *Opcjonalne:* tagi, kategorie
- **Request Body (POST przykładowo):**
```json
{
  "title": "Nazwa podcastu",
  "description": "Opis podcastu",
  "publishedAt": "2023-10-01T12:00:00Z"
}
```

### Transkrypcje
- **Metody:** GET, POST, PUT, DELETE
- **URL:** `/api/transcriptions`
- **Parametry:**
  - *Wymagane:* `podcastId` (string), `content` (string)
  - *Opcjonalne:* język, znaczniki czasu
- **Request Body (POST przykładowo):**
```json
{
  "podcastId": "uuid-podcastu",
  "content": "Pełna treść transkrypcji",
  "language": "pl"
}
```

### Alerty
- **Metody:** GET, POST, PUT
- **URL:** `/api/alerts`
- **Parametry:**
  - *Wymagane:* `message` (string), `type` (string, np. "error", "warning", "info")
  - *Opcjonalne:* `resolved` (boolean)
- **Request Body (POST przykładowo):**
```json
{
  "message": "Powiadomienie o problemie",
  "type": "warning"
}
```

## 3. Wykorzystywane typy
- **DTO:**
  - `PodcastDTO` (dla tworzenia/aktualizacji podcastów)
  - `TranscriptionDTO` (dla operacji na transkrypcjach)
  - `AlertDTO` (dla obsługi alertów)
- **Command Model:**
  - `CreatePodcastCommand`, `UpdatePodcastCommand`
  - `CreateTranscriptionCommand`, `UpdateTranscriptionCommand`
  - `CreateAlertCommand`, `UpdateAlertCommand`

Definicje typów znajdą się w odpowiednich plikach, np. `astro/src/types.ts` oraz `astro/src/db/database.types.ts`.

## 4. Szczegóły odpowiedzi
Odpowiedzi dla wszystkich operacji będą zawierały właściwe kody stanu HTTP:
- **200:** Sukces w operacjach odczytu/aktualizacji
- **201:** Sukces przy tworzeniu zasobu
- **400:** Błędne dane wejściowe
- **401:** Nieautoryzowany dostęp
- **404:** Nie znaleziono zasobu
- **500:** Błąd po stronie serwera

Przykładowa odpowiedź sukcesu dla utworzenia podcastu:
```json
{
  "id": "uuid",
  "title": "Nazwa podcastu",
  "description": "Opis podcastu",
  "publishedAt": "2023-10-01T12:00:00Z"
}
```

## 5. Przepływ danych
1. Odbiór żądania wraz z weryfikacją tokena Supabase Auth.
2. Walidacja danych wejściowych według ustalonych reguł.
3. Przekazanie danych do warstwy serwisowej, gdzie realizowana jest logika biznesowa.
4. Interakcja z bazą danych – operacje CRUD dla odpowiednich zasobów.
5. Zwrócenie odpowiedzi i przekazanie ewentualnych komunikatów o błędach.

## 6. Względy bezpieczeństwa
- Weryfikacja tokena JWT za pomocą Supabase Auth.
- Sanitizacja i walidacja danych wejściowych, aby zabezpieczyć się przed SQL Injection i innymi zagrożeniami.
- Ograniczenie liczby prób zapytań, szczególnie w operacjach modyfikujących dane.

## 7. Obsługa błędów
- Zbieranie szczegółowych informacji o błędach i ich logowanie.
- Stosowanie standardowych kodów odpowiedzi (400, 401, 404, 500) z klarownymi komunikatami.
- W momencie krytycznych błędów, informowanie użytkownika o problemie z jednoczesnym logowaniem incydentu do systemu alertowania.

## 8. Rozważania dotyczące wydajności
- Optymalizacja zapytań SQL oraz stosowanie indeksów na polach wykorzystywanych w filtracji i sortowaniu.
- Wprowadzenie mechanizmów cache’owania tam, gdzie to możliwe.
- Monitorowanie obciążenia systemu i skalowanie w razie konieczności.

## 9. Etapy wdrożenia
1. **Dokumentacja:** Uzupełnienie i aktualizacja dokumentacji API dla nowych endpointów (np. Swagger, Postman).
2. **Implementacja walidacji:** Utworzenie i integracja mechanizmu walidacji danych wejściowych.
3. **Budowa warstwy serwisowej:** Implementacja logiki biznesowej dla podcastów, transkrypcji i alertów.
4. **Integracja z bazą danych:** Implementacja operacji CRUD oraz optymalizacja zapytań.
5. **Wdrożenie autoryzacji:** Konfiguracja weryfikacji tokenów za pomocą Supabase Auth.
6. **Testowanie:** Przeprowadzenie testów jednostkowych i integracyjnych.
7. **Wdrożenie na środowisko testowe:** Monitorowanie wydajności i wdrażanie ewentualnych poprawek.
