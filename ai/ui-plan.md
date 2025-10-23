# Architektura UI dla Lumos

## 1. Przegląd struktury UI

Architektura interfejsu użytkownika w projekcie Lumos opiera się na podejściu modułowym i responsywnym, dedykowanym dla przeglądarek desktopowych (Chromium, Safari). UI odpowiada za prezentację alertów, szczegółowych widoków analizy, proces uwierzytelniania, edycję konta oraz obsługę płatności. Kluczowym elementem jest zapewnienie płynnej nawigacji między widokami, czytelnych stanów operacyjnych (ładowanie, sukces, błąd) oraz łatwości dostępu, co zwiększa komfort użytkowników.

## 2. Lista widoków

1. **Ekran natywnych powiadomień**
   - Ścieżka: Overlay aktywowany w trakcie odtwarzania podcastu na YouTube
   - Główny cel: Informowanie użytkownika o wykryciu podcastu i zapytanie, czy przeprowadzić analizę
   - Kluczowe informacje: Komunikat "Analizować ten epizod w tle?" z opcjami: zawsze, tylko ten odcinek, nie teraz
   - Kluczowe komponenty: Modal/Overlay, przyciski wyboru, animacja wejścia/wyjścia
   - Względy UX/Dostępności: Czytelny kontrast, prosty przekaz, klawiaturowa obsługa przycisków, responsywność

2. **Ekran listy alertów**
   - Ścieżka: /alerts
   - Główny cel: Prezentacja listy wygenerowanych alertów dotyczących analizy podcastów
   - Kluczowe informacje: Krótkie podsumowanie każdego alertu (claim, werdykt, skrócone uzasadnienie, znacznik czasu)
   - Kluczowe komponenty: Lista kart alertów, paginacja, filtry (opcjonalnie), przyciski przejścia do szczegółów
   - Względy UX/Dostępności: Przejrzysta hierarchia informacji, intuicyjne sortowanie i filtrowanie, wsparcie dla czytników ekranu

3. **Ekran szczegółów alertu**
   - Ścieżka: /alerts/{id}
   - Główny cel: Wyświetlenie pełnych informacji o wybranym alercie, w tym transkrypcji, kontekstu, linków do źródeł oraz opcji oceny alertu
   - Kluczowe informacje: Pełny transcript, główna teza, szczegółowe uzasadnienie, znacznik czasu (link "Jump to t=...")
   - Kluczowe komponenty: Panel szczegółów, przyciski akcji (np. ocena trafności: pomocny/nie pomocny), linki, sekcja komentarzy
   - Względy UX/Dostępności: Łatwy dostęp do informacji, możliwość powiększenia tekstu, czytelna struktura, wsparcie dla klawiatury

4. **Ekran logowania i rejestracji**
   - Ścieżka: /auth (z podścieżkami np. /auth/login, /auth/register, /auth/reset)
   - Główny cel: Umożliwienie użytkownikowi logowania przy użyciu magic link oraz opcjonalnie social login (jeśli dostępny przez Supabase)
   - Kluczowe informacje: Formularze logowania, informacja o magic linku, możliwość resetu hasła
   - Kluczowe komponenty: Formularze, przyciski, komunikaty błędów, wskaźnik ładowania
   - Względy UX/Dostępności: Prosty proces, walidacja pól, komunikaty o błędach, dostępność dla użytkowników z ograniczeniami

5. **Ekran edycji konta**
   - Ścieżka: /account/edit
   - Główny cel: Pozwolenie użytkownikowi na aktualizację swoich danych, głównie zmiany hasła oraz adresu e-mail
   - Kluczowe informacje: Aktualne dane użytkownika, pola do edycji hasła, e-maila oraz opcjonalne ustawienia preferencji
   - Kluczowe komponenty: Formularz edycji, przyciski zapisu, komunikaty walidacji
   - Względy UX/Dostępności: Bezpieczeństwo danych, czytelna informacja, prosty interfejs i intuicyjna walidacja

6. **Ekran płatności**
   - Ścieżka: /payments
   - Główny cel: Integracja z Stripe Checkout, umożliwiająca zakup alertów lub dodatkowych funkcji
   - Kluczowe informacje: Informacje o modelu freemium, liczbie darmowych/płatnych alertów, przycisk do rozpoczęcia procesu płatności
   - Kluczowe komponenty: Formularz płatności, przycisk Stripe, wskaźnik ładowania, podsumowanie transakcji
   - Względy UX/Dostępności: Bezpieczna prezentacja danych płatniczych, zgodność z zasadami PCI, czytelność informacji o kosztach

7. **(Opcjonalnie) Ekran administracyjny**
   - Ścieżka: /admin/whitelist
   - Główny cel: Zarządzanie whitelistą kanałów YouTube (dostęp wyłącznie dla administratorów)
   - Kluczowe informacje: Lista kanałów, możliwość dodania/edycji/usunięcia pozycji
   - Kluczowe komponenty: Tabela, formularze, przyciski akcji
   - Względy UX/Dostępności: Ograniczony dostęp, walidacja danych, czytelny interfejs administracyjny

## 3. Mapa podróży użytkownika

Przykładowy główny scenariusz:
1. Użytkownik oglądający podcast na YouTube zostaje rozpoznany przez system, który wyświetla nakładkę z pytaniem o analizę odcinka (Ekran natywnych powiadomień).
2. Po zaakceptowaniu, w tle rozpoczyna się analiza (wywoływany endpoint `/api/podcasts/analyze`), a użytkownik otrzymuje powiadomienie o rozpoczęciu procesu.
3. Po przetworzeniu, alerty zostają wyświetlone w widoku listy alertów (/alerts).
4. Użytkownik klika na konkretny alert, przechodząc do widoku szczegółów alertu (/alerts/{id}), gdzie może zapoznać się z pełnymi informacjami i ocenić alert.
5. W dowolnym momencie użytkownik może przejść do ekranu logowania/rejestracji (/auth) lub edycji konta (/account/edit) w celu zarządzania swoimi danymi.
6. Jeśli alerty są płatne, użytkownik zostaje przekierowany do ekranu płatności (/payments) w celu realizacji transakcji.

## 4. Układ i struktura nawigacji

Nawigacja w aplikacji zostanie oparta na:
- Pasek nawigacyjny widoczny na wszystkich głównych widokach, zawierający linki do: Lista alertów, Konto, Płatności (oraz ewentualnie panel administracyjny dla adminów).
- Menu typu hamburger dla użytkowników mobilnych lub wąskich ekranów, z możliwością szybkiego dostępu do najważniejszych funkcji.
- System okien modalnych dla natychmiastowych akcji (np. nakładka powiadomień, formularze logowania) zapewniający, że główne widoki nie są zakłócane.
- Intuicyjne przyciski powrotu i ścieżki okruszkowe (breadcrumbs) w widokach szczegółowych (np. szczegóły alertu), aby ułatwić powrót do listy alertów.

## 5. Kluczowe komponenty

- **Przyciski (Button):** Standaryzowane przyciski wykorzystywane w formularzach, alertach i nawigacji.
- **Karty alertów (Alert Card):** Komponent do wyświetlania skróconych informacji o alertach, używany w widoku listy alertów.
- **Modale/Overlay:** Mechanizm wyświetlania powiadomień, promptów oraz formularzy logowania/rejestracji.
- **Formularze:** Zestaw komponentów do zarządzania danymi użytkownika (logowanie, rejestracja, edycja konta, płatności).
- **Elementy statusu operacji:** Wskaźniki ładowania, komunikaty błędów oraz potwierdzenia sukcesu, zapewniające responsywność interfejsu.
- **Menu nawigacyjne:** Pasek lub menu rozwijane umożliwiające szybki dostęp do głównych widoków oraz funkcji konta.


