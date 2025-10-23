# Plan implementacji widoku Lista alertów

## 1. Przegląd
Widok listy alertów umożliwia wyświetlenie wszystkich alertów wygenerowanych przez system analizy podcastów. Użytkownik może przeglądać alerty, filtrować je oraz przechodzić do szczegółowych widoków. Widok ten jest głównym punktem nawigacyjnym aplikacji.

## 2. Routing widoku
Widok powinien być dostępny pod ścieżką: /alerts

## 3. Struktura komponentów
Hierarchia głównych komponentów:
- Layout (globalny szablon aplikacji)
  - AlertListPage (główny komponent widoku listy alertów)
    - AlertListHeader (nagłówek z filtrowaniem i sortowaniem)
    - AlertCardList (lista kart alertów)
      - AlertCard (pojedyncza karta alertu)
    - Pagination (paginacja)

## 4. Szczegóły komponentów

### AlertListPage
- Opis: Główny komponent zarządzający pobieraniem listy alertów, filtrowaniem oraz paginacją.
- Główne elementy: Header z filtrowaniem, lista kart alertów, paginacja.
- Obsługiwane interakcje: Pobieranie danych z API (GET /api/alerts), obsługa filtrowania, zmiany stron.
- Walidacja: Sprawdzenie poprawności parametrów paginacji i filtrów.
- Typy: AlertListResponseDTO, AlertListQueryDTO.
- Propsy: Query parameters z URL (page, limit, search, filters).

### AlertListHeader
- Opis: Komponent odpowiedzialny za wyświetlanie tytułu strony, liczby alertów oraz opcji filtrowania.
- Główne elementy: Tytuł, licznik alertów, pole wyszukiwania, filtry (typ alertu, status).
- Obsługiwane interakcje: Wyszukiwanie tekstu, wybór filtrów, resetowanie filtrów.
- Walidacja: Walidacja inputów wyszukiwania.
- Typy: AlertListQueryDTO.
- Propsy: Aktualne filtry, callback do aktualizacji filtrów, liczba alertów.

### AlertCardList
- Opis: Kontener dla listy kart alertów z obsługą stanów loading/empty/error.
- Główne elementy: Grid/lista kart alertów, skeleton loading, empty state, error state.
- Obsługiwane interakcje: Kliknięcie na kartę alertu (navigacja do szczegółów).
- Walidacja: Sprawdzenie czy dane alertów są kompletne.
- Typy: AlertDTO[].
- Propsy: Lista alertów, stan loading, stan error.

### AlertCard
- Opis: Pojedyncza karta przedstawiająca skrócone informacje o alercie.
- Główne elementy: Claim (skrócony), verdict badge, timestamp, typ alertu, data utworzenia.
- Obsługiwane interakcje: Kliknięcie całej karty przekierowuje do /alerts/{id}.
- Walidacja: Sprawdzenie dostępności wymaganych pól alertu.
- Typy: AlertDTO.
- Propsy: Dane pojedynczego alertu.

### Pagination
- Opis: Komponent obsługujący nawigację między stronami listy alertów.
- Główne elementy: Przyciski poprzednia/następna, numery stron, informacja o aktualnej stronie.
- Obsługiwane interakcje: Kliknięcie przycisków nawigacji, wybór konkretnej strony.
- Walidacja: Sprawdzenie granic paginacji (nie można iść poza pierwszą/ostatnią stronę).
- Typy: PaginationDTO.
- Propsy: Aktualna strona, liczba stron, callback do zmiany strony.

## 5. Typy
- AlertListResponseDTO:
  - alerts: AlertDTO[]
  - pagination: PaginationDTO
- AlertListQueryDTO:
  - page?: number
  - limit?: number
  - search?: string
  - alert_type?: string
  - podcast_id?: string
- AlertCardDTO (simplified from AlertDTO):
  - id: string
  - alert_type: string
  - details: {
      claim: string (skrócony do ~100 znaków),
      verdict: string,
      timestamp: number
    }
  - created_at: string

## 6. Zarządzanie stanem
- Użycie custom hooka (useAlertList) do zarządzania stanem listy alertów, filtrów, paginacji.
- Stan lokalny dla filtrów, wyszukiwania i aktualnej strony.
- Debounced search dla lepszej wydajności.
- URL state management - filtry i paginacja odzwierciedlone w URL.

## 7. Integracja API
- Pobieranie danych: GET /api/alerts z query parameters (page, limit, search, filters).
- Obsługa cachowania wyników dla lepszej wydajności.
- Retry mechanizm dla failed requests.
- Optimistic updates dla lepszego UX.

## 8. Interakcje użytkownika
- Kliknięcie na kartę alertu → nawigacja do /alerts/{id}.
- Wyszukiwanie → filtrowanie alertów po claim/content.
- Wybór filtrów → filtrowanie po typie alertu, statusie.
- Zmiana strony → ładowanie nowych alertów.
- Sortowanie → możliwość sortowania po dacie, typie, werdykcie.

## 9. Warunki i walidacja
- Sprawdzenie autoryzacji użytkownika.
- Walidacja parametrów wyszukiwania i filtrów.
- Ograniczenie długości query search (max 100 znaków).
- Walidacja zakresu paginacji.

## 10. Obsługa błędów
- Error boundary dla całego widoku.
- Graceful degradation przy błędach API.
- Retry button dla failed requests.
- Toast notifications dla błędów.
- Fallback UI dla empty states.

## 11. Funkcjonalności dodatkowe
- Bulk actions (opcjonalnie) - oznaczanie wielu alertów jako przeczytane.
- Export alertów do CSV/PDF (opcjonalnie).
- Real-time updates przy nowych alertach (WebSocket/SSE).
- Bookmarking/favorites alerts.

## 12. Responsive design
- Mobile-first approach.
- Card layout dostosowany do małych ekranów.
- Hamburger menu dla filtrów na mobile.
- Touch-friendly interactions.
- Infinite scroll jako alternatywa dla paginacji na mobile.

## 13. Performance optimizations
- Virtual scrolling dla długich list.
- Image lazy loading (jeśli będą obrazy).
- Memoization komponentów AlertCard.
- Debounced search.
- Request deduplication.

## 14. Kroki implementacji
1. Utworzenie pliku widoku: /src/pages/alerts/index.astro.
2. Implementacja custom hooka useAlertList do zarządzania stanem.
3. Stworzenie komponentu AlertListPage jako głównego kontenera.
4. Implementacja komponentu AlertListHeader z filtrowaniem i wyszukiwaniem.
5. Stworzenie komponentu AlertCard do wyświetlania pojedynczego alertu.
6. Implementacja komponentu AlertCardList z obsługą stanów.
7. Dodanie komponentu Pagination.
8. Integracja z API GET /api/alerts.
9. Dodanie URL state management dla filtrów i paginacji.
10. Implementacja responsive design i mobile optimizations.
11. Testowanie widoku w różnych scenariuszach.
12. Dodanie loading states, error handling oraz empty states.

