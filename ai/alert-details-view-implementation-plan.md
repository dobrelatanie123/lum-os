# Plan implementacji widoku Szczegółowy widok alertu

## 1. Przegląd
Widok szczegółów alertu umożliwia wyświetlenie pełnych informacji dotyczących pojedynczego alertu, w tym transkrypcji, głównej tezy, uzasadnienia oraz linku do skoku ("Jump to t=..."). Widok ten jest wyświetlany po kliknięciu na alert z listy alertów i pozwala użytkownikowi na ocenę trafności alertu.

## 2. Routing widoku
Widok powinien być dostępny pod ścieżką: /alerts/{id}

## 3. Struktura komponentów
Hierarchia głównych komponentów:
- Layout (globalny szablon aplikacji)
  - AlertDetailsPage (główny komponent widoku szczegółów alertu)
    - AlertHeader (prezentacja nagłówka alertu, np. tytuł, data, czas)
    - AlertContent (wyświetlanie transkrypcji, głównej tezy oraz uzasadnienia)
    - AlertActions (sekcja akcji: ocena alertu oraz link "Jump to t=...")

## 4. Szczegóły komponentów
### AlertDetailsPage
- Opis: Główny komponent, który zarządza pobieraniem danych alertu na podstawie ID, wyświetlaniem loadera oraz dystrybucją danych do podkomponentów.
- Główne elementy: Loader, kontener na AlertHeader, AlertContent oraz AlertActions.
- Obsługiwane interakcje: Pobranie danych alertu z API (GET /api/alerts/{id}); obsługa błędów i przekierowań (np. gdy użytkownik nie jest zalogowany lub alert nie istnieje).
- Walidacja: Sprawdzenie obecności wymaganych pól (claim, verdict, reasoning, timestamp) w danych zwróconych przez API.
- Typy: AlertDetailsModel.
- Propsy: ID alertu pobierane z parametrów URL oraz przekazywane dane alertu.

### AlertHeader
- Opis: Komponent odpowiedzialny za prezentację podstawowych informacji alertu (np. tytuł, data utworzenia, skrócony opis).
- Główne elementy: Nagłówek, metadane alertu (czas, status).
- Obsługiwane interakcje: Wyłącznie wizualne, bez interakcji użytkownika.
- Walidacja: Minimalna – sprawdzenie dostępności danych.
- Typy: Fragment danych AlertDetailsModel.
- Propsy: Dane potrzebne do wyświetlenia nagłówka (np. tytuł, timestamp).

### AlertContent
- Opis: Komponent wyświetlający szczegółową treść alertu, w tym pełną transkrypcję, główną tezę oraz dokładne uzasadnienie.
- Główne elementy: Tekst transkrypcji, sekcja tezy oraz uzasadnienia.
- Obsługiwane interakcje: Przewijanie długiej treści, zaznaczanie tekstu.
- Walidacja: Weryfikacja kompletności danych (transcript, mainClaim, reasoning).
- Typy: Fragment danych AlertDetailsModel.
- Propsy: Obiekt zawierający szczegóły alertu do wyświetlenia.

### AlertActions
- Opis: Sekcja umożliwiająca użytkownikowi ocenę alertu (przyciski "helpful" / "not_helpful") oraz korzystanie z linku kierującego do momentu wideo ("Jump to t=...").
- Główne elementy: Przyciski oceny, link do skoku w odtwarzaczu.
- Obsługiwane interakcje: Kliknięcie przycisku ratingu (wywołujące PUT /api/alerts/{id}/rating) oraz kliknięcie linku do skoku.
- Walidacja: Sprawdzenie, czy rating ma wartość "helpful" lub "not_helpful"; weryfikacja poprawności timestamp przed przekazaniem do odtwarzacza.
- Typy: RatingRequest DTO, fragment AlertDetailsModel (dla timestamp).
- Propsy: ID alertu, aktualny rating, callback do aktualizacji stanu po ratingu.

## 5. Typy
- AlertDetailsModel:
  - id: string
  - podcast_id: string
  - alert_type: string
  - details: {
      claim: string,
      verdict: string,
      reasoning: string,
      sources: string[],
      timestamp: number,
      transcript?: string,
      mainClaim?: string,
      context?: string
    }
  - created_at: string
- RatingRequest DTO:
  - rating: "helpful" | "not_helpful"
  - comment?: string

## 6. Zarządzanie stanem
- Użycie hooków (useState, useEffect) do zarządzania stanem danych alertu, stanu ładowania oraz obsługi błędów.
- Stworzenie custom hooka (useAlertDetails) odpowiedzialnego za pobieranie danych alertu z API i aktualizację stanu.

## 7. Integracja API
- Pobieranie danych: GET /api/alerts/{id} z autoryzacją dodaną w nagłówku.
- Aktualizacja oceny: PUT /api/alerts/{id}/rating, wysyłane jako JSON.
- Walidacja odpowiedzi: Sprawdzanie statusu odpowiedzi, obsługa błędów (np. 401, 404).
- Aktualizacja stanu interfejsu na podstawie odpowiedzi z API.

## 8. Interakcje użytkownika
- Po wejściu na stronę /alerts/{id} użytkownik widzi loader do momentu pobrania danych.
- Po załadowaniu danych, użytkownik widzi szczegóły alertu i może wybrać ocenę alertu poprzez przyciski.
- Kliknięcie linku "Jump to t=..." powoduje przekierowanie do odtwarzacza w odpowiednim momencie wideo.

## 9. Warunki i walidacja
- Weryfikacja kompletności danych z API (obecność claim, verdict, reasoning, timestamp).
- Walidacja ratingu w AlertActions – dopuszczalne wartości: "helpful" lub "not_helpful".
- Sprawdzenie formatu timestamp przed wyświetleniem linku do skoku.

## 10. Obsługa błędów
- Wyświetlenie komunikatów o błędach, gdy pobieranie danych lub aktualizacja ratingu nie powiedzie się.
- Przekierowanie do strony logowania lub strony błędu przy kodach 401/404.
- Mechanizm retry dla błędów tymczasowych (np. problemy sieciowe).

## 11. Kroki implementacji
1. Utworzenie pliku widoku: /src/pages/alerts/[id].tsx.
2. Implementacja głównego komponentu AlertDetailsPage, wykorzystującego custom hook useAlertDetails do pobierania danych.
3. Stworzenie komponentu AlertHeader do prezentacji podstawowych informacji alertu.
4. Implementacja komponentu AlertContent do wyświetlania szczegółowych danych alertu.
5. Implementacja komponentu AlertActions z obsługą ratingu i linku "Jump to t=...".
6. Integracja z API: dodanie wywołań GET /api/alerts/{id} i PUT /api/alerts/{id}/rating z odpowiednią obsługą stanu i błędów.
7. Testowanie widoku w różnych scenariuszach (kompletność danych, obsługa błędów, interakcje użytkownika).
8. Integracja widoku z globalnym layoutem i nawigacją aplikacji.

