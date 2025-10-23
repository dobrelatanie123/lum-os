# Dokument wymagań produktu (PRD) - Lumos
## 1. Przegląd produktu
Lumos to rozwiązanie służące do automatycznej weryfikacji informacji zawartych w podcastach publikowanych na YouTube. Aplikacja działa jako rozszerzenie przeglądarki (desktop-first) i wykrywa odtwarzanie treści na youtube.com przy użyciu whitelisty kanałów oraz kryterium długości wideo (minimum 60 minut). Po zebraniu metadanych (tytuł, kanał, timestamp) system w tle uruchamia proces transkrypcji audio (API OpenAI), ekstrakcji claimów oraz oceny ich wiarygodności na podstawie heurystyk (np. liczby, jednostki, nazwa badania, instytucja + rok). Wyniki analizy prezentowane są użytkownikowi poprzez natywne powiadomienia webowe, a kliknięcie powiadomienia otwiera szczegółowy widok z transkrypcją, markerem czasu oraz odnośnikami do źródeł. Produkt skierowany jest do casualowych, tech-savvy słuchaczy podcastów, korzystających z treści w językach angielskim i polskim.

## 2. Problem użytkownika
Słuchacze podcastów często ufają autorytetowi prowadzących i gości, przez co nie zawsze poddają w wątpliwość przekazywane informacje. Brak możliwości szybkiej weryfikacji twierdzeń (np. odniesień do badań, statystyk czy liczb) sprawia, że użytkownik ma trudności z oceną rzetelności przekazu. Lumos odpowiada na ten problem poprzez automatyczną analizę treści i prezentację zweryfikowanych informacji wraz z uzasadnieniami oraz linkami do źródeł, co pozwala na szybką ocenę prawdziwości przedstawionych danych.

## 3. Wymagania funkcjonalne
- Rozszerzenie przeglądarki: Wykrywanie odtwarzania treści na youtube.com poprzez pobieranie metadanych (tytuł, kanał, timestamp) i uruchamianie analizy w tle.
- Zgoda i prompt: Wyświetlenie overlay z pytaniem "Analizować ten epizod w tle?" z opcjami wyboru (zawsze dla YouTube, tylko ten odcinek, nie teraz).
- Powiadomienia: Generowanie natywnych powiadomień webowych zawierających fragment twierdzenia, werdykt oceny (wątpliwe/potwierdzone) oraz skrócone uzasadnienie. Kliknięcie powiadomienia przenosi użytkownika do widoku szczegółów.
- Widok szczegółów: Prezentacja transkrypcji z kontekstem, kluczowej tezy, krótkiego uzasadnienia i aktywnych linków do źródeł; uwzględnienie markera czasu (link "Jump to t=...").
- Historia: Rejestracja alertów per odcinek i konto z możliwością oceny alertów (trafne/nie trafne) przez użytkowników.
- Profil i autentykacja: Umożliwienie logowania (np. e‑mail + magic link lub OAuth) oraz personalizacja preferencji (np. domeny analizowane, czułość alertów).
- Płatności: Model freemium z pierwszym darmowym alerem, a kolejne alerty rozliczane według systemu usage-based poprzez Stripe Checkout, z możliwością trial.
- Integracja z AI: Wykorzystanie API OpenAI do transkrypcji audio (chunking 20–30 sekund z overlapem 3–5 sekund), ekstrakcji claimów, wyszukiwania źródeł (przy użyciu API akademickich takich jak Semantic Scholar, PubMed, z fallbackiem do Perplexity Academic/Google), oceny wiarygodności oraz generowania uzasadnień.
- Obsługa języka: Automatyczna detekcja języka podcastu (polski/angielski) i dostosowanie kryteriów analizy.
- Rate limiting: Generowanie alertów w tempie maksymalnie 5 na minutę z możliwością łączenia bliskich w czasie (okno 120 sekund, do 3 claimów w jednym alercie).
- Caching: Cache’owanie wyników analizy dla danego videoId z TTL wynoszącym 30 dni; analiza jest ponawiana przy zmianie długości wideo.
- Zabezpieczenia: Mechanizm rate limiting oparty na adresie IP, chroniący przed nadużyciami, przy jednoczesnym uwzględnieniu dynamicznych adresów.
- Integracja z API akademickich: Priorytetowe pobieranie danych z API (Semantic Scholar, PubMed) z fallbackiem do alternatywnych źródeł, gwarantujących rzetelność wyników.

## 4. Granice produktu
- Produkt działa wyłącznie na domenie youtube.com – obsługa innych platform (np. Spotify, Apple) nie wchodzi w zakres MVP.
- Analiza odbywa się z akceptowalnym opóźnieniem 30–60 sekund – nie realizujemy rozwiązania zero-latency.
- Brak możliwości ręcznego dodawania odcinków poprzez URL.
- Funkcje społecznościowe, współdzielenie oraz zaawansowane raporty są poza zakresem MVP.
- Aplikacja nie jest w pełni zoptymalizowana dla urządzeń mobilnych ani nie posiada dedykowanej aplikacji mobilnej.
- Weryfikacja dotyczy twierdzeń, a nie profilowania wiarygodności osób.
- Wielojęzyczność ograniczona jest do języka polskiego i angielskiego.
- Zarządzanie whitelistą kanałów oraz bazą słów kluczowych odbywa się w początkowej fazie ręcznie.

## 5. Historyjki użytkowników

US-001  
Tytuł: Wykrywanie odtwarzania i prompt analizy  
Opis: Jako użytkownik, podczas odtwarzania podcastu na YouTube chcę, aby system automatycznie wykrył odtwarzanie, pobrał niezbędne metadane oraz wyświetlił overlay z pytaniem o analizę odcinka.  
Kryteria akceptacji:  
- Odtwarzanie na youtube.com zostaje skutecznie wykryte.  
- Pobierane są prawidłowe metadane (tytuł, kanał, timestamp).  
- Użytkownik widzi prompt z opcjami wyboru: zawsze, tylko ten odcinek, nie teraz.

US-002  
Tytuł: Generowanie powiadomień o alertach  
Opis: Jako użytkownik chcę otrzymywać natywne powiadomienia zawierające fragment twierdzenia, werdykt (wątpliwe/potwierdzone) oraz skrócone uzasadnienie, abym mógł szybko poznać wynik analizy.  
Kryteria akceptacji:  
- Powiadomienia zawierają wymagane informacje o analizie.  
- Kliknięcie powiadomienia otwiera szczegółowy widok alertu.  
- Alerty generowane są maksymalnie w tempie 5 na minutę, z łączeniem claimów pojawiających się w niedługim odstępie czasu.

US-003  
Tytuł: Szczegółowy widok alertu  
Opis: Jako użytkownik po kliknięciu powiadomienia chcę zobaczyć szczegółowy widok alertu z transkrypcją, główną tezą, uzasadnieniem oraz linkami do źródeł, łącznie z markerem czasu.  
Kryteria akceptacji:  
- Widok zawiera pełny kontekst transkrypcji i główne informacje o analizie.  
- Link "Jump to t=..." przekierowuje do odpowiedniego momentu w wideo.  
- Prezentowane dane odpowiadają wynikom algorytmu analizy.

US-004  
Tytuł: Przeglądanie historii alertów i ocena trafności  
Opis: Jako użytkownik chcę mieć możliwość przeglądania historii alertów dla danego odcinka oraz oceny ich trafności, aby wyrazić swoją opinię na temat jakości analizy.  
Kryteria akceptacji:  
- Historia alertów jest dostępna w interfejsie aplikacji.  
- Użytkownik może ocenić każdy alert jako trafny lub nietrafny.  
- System zbiera co najmniej 5 ocen dla pojedynczego alertu.

US-005  
Tytuł: Logowanie i uwierzytelnianie  
Opis: Jako użytkownik chcę mieć możliwość logowania się przy użyciu e-maila (magic link) lub OAuth, aby uzyskać dostęp do spersonalizowanej historii i ustawień konta.  
Kryteria akceptacji:  
- Proces logowania jest intuicyjny i bezpieczny.  
- Użytkownik otrzymuje magic link na podany adres e-mail.  
- Dane konta są związane z historią alertów oraz preferencjami użytkownika.

US-006  
Tytuł: Model płatności freemium i integracja ze Stripe Checkout  
Opis: Jako użytkownik chcę korzystać z modelu freemium, gdzie pierwszy alert jest darmowy, a kolejne alerty są rozliczane przy użyciu Stripe Checkout, aby mieć możliwość wyboru płatnych funkcji.  
Kryteria akceptacji:  
- Pierwszy alert jest udostępniany bezpłatnie.  
- Kolejne alerty wymagają płatności przy użyciu zintegrowanego Stripe Checkout.  
- Użytkownik jest informowany o trialu i systemie rozliczeń oparty o usage-based pricing.

US-007  
Tytuł: Działanie w przeglądarkach desktopowych  
Opis: Jako użytkownik chcę, aby aplikacja działała poprawnie w nowoczesnych przeglądarkach opartych na Chromium (np. Chrome, ewentualnie Safari), gwarantując spójne działanie na desktopie.  
Kryteria akceptacji:  
- Aplikacja jest testowana i działa w Chrome oraz Safari.  
- Interfejs jest responsywny, przy zachowaniu minimalnej optymalizacji dla urządzeń mobilnych.

US-008  
Tytuł: Zarządzanie whitelistą kanałów i bazą słów kluczowych  
Opis: Jako administrator chcę mieć możliwość zarządzania whitelistą kanałów YouTube oraz bazą słów kluczowych, aby móc modyfikować kryteria analizy w zależności od potrzeb.  
Kryteria akceptacji:  
- Panel administracyjny umożliwia edycję whitelisty.  
- Istnieje możliwość aktualizacji bazy słów kluczowych (np. "research", "study" i ich odpowiedniki).  
- Zmiany są natychmiast odzwierciedlane w działaniu systemu.

US-009  
Tytuł: Automatyczna detekcja języka  
Opis: Jako użytkownik chcę, aby system automatycznie wykrywał język podcastu (polski lub angielski) i dostosowywał analizę do specyfiki językowej.  
Kryteria akceptacji:  
- System prawidłowo identyfikuje język analizowanej treści.  
- Wyniki analizy odpowiadają specyfice języka podcastu.

US-010  
Tytuł: Integracja z API akademickich  
Opis: Jako system chcę integrować wyniki analizy z API akademickich (np. Semantic Scholar, PubMed) z fallbackiem do alternatywnych źródeł (Perplexity Academic lub Google), aby zapewnić rzetelność i dopasowanie wyników.  
Kryteria akceptacji:  
- Główne źródła API są wykorzystywane jako priorytet.  
- W przypadku błędu stosowany jest mechanizm fallback.  
- Wyniki analizy zawierają odnośniki do odpowiednich publikacji i źródeł.

US-011  
Tytuł: Implementacja mechanizmu rate limiting  
Opis: Jako system chcę wdrożyć mechanizm rate limiting oparty na adresie IP, aby ograniczyć liczbę alertów generowanych w jednostce czasu, łącząc bliskie w czasie claimy i chroniąc system przed nadużyciami.  
Kryteria akceptacji:  
- System generuje alerty z maksymalnym tempem 5 na minutę.  
- Claimy pojawiające się w ciągu 120 sekund są łączone (maksymalnie 3 w jednym alercie).  
- Mechanizm rate limiting nie blokuje uczciwych użytkowników korzystających z dynamicznych adresów.

## 6. Metryki sukcesu
- Co najmniej 70% nowych użytkowników aktywuje funkcję analizy na YouTube i otrzyma co najmniej jeden alert w ciągu 7 dni.
- Co najmniej 80% ocen alertów dokonanych przez użytkowników uznawane jest za trafne.
- System utrzymuje generowanie alertów na poziomie nie przekraczającym 5 na minutę z odpowiednim łączeniem bliskich w czasie claimów.
- Średni koszt generowania alertu oscyluje w okolicach 0.03 USD, przy zastosowaniu mechanizmu cache’owania wyników.
- Proces logowania oraz zarządzanie profilem odbywa się sprawnie, a dane użytkowników są bezpiecznie chronione.
```

Ten dokument jest wyczerpujący, zawiera wszystkie sekcje wraz z historyjkami użytkowników (każda z unikalnym identyfikatorem) oraz precyzyjnymi kryteriami akceptacji, co zapewnia możliwość testowania każdej funkcjonalności.