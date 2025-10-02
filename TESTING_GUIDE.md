# 🚀 Lumos End-to-End Testing Guide

## Cel
Przetestować pełny system fact-checking z [tym YouTube video](https://www.youtube.com/watch?v=xXVB8A5xvSw&list=PL9p1Ugqk8k148REKovrxNdveex86ERW2d)

## Kroki testowania:

### 1. ✅ Backend Status Check
- [x] Serwer Astro działa na `http://localhost:4322`
- [x] API endpoints gotowe (`/api/transcribe/audio`)
- [x] OpenAI API key skonfigurowany w `.env`

### 2. 🔧 Browser Extension Installation

**W Chrome:**
1. Idź do `chrome://extensions/`
2. Włącz "Developer mode" (prawym górnym rogu)
3. Kliknij "Load unpacked"
4. Wybierz folder: `/Users/maciejorlowski/lumos/extension/`
5. Extension "Lumos - YouTube Fact Checker" powinien się pojawić

### 3. 🎬 YouTube Video Test

**Przygotowanie:**
1. Otwórz [YouTube video](https://www.youtube.com/watch?v=xXVB8A5xvSw)
2. Kliknij ikonę Lumos w toolbar Chrome
3. Sprawdź czy popup pokazuje:
   - Video ID: `xXVB8A5xvSw`
   - Status: "Monitoring inactive"

**Test 1: Manual Start**
1. W popup kliknij "Start Monitoring" 
2. Przyznaj permissions (microphone/screen capture)
3. Status powinien zmienić się na "Monitoring active"
4. Badge powinien pokazać "REC"

**Test 2: Audio Processing**
1. Puść video (z dźwiękiem)
2. Co 10 sekund extension wysyła audio chunk do API
3. Sprawdź w console (F12) logi:
   ```
   📤 Sending audio chunk (X bytes) to API...
   🚨 Alerts detected: [...]
   ```

**Test 3: Notifications**
1. Jeśli LLM wykryje problematyczne treści:
   - Browser notification się pojawi
   - Badge pokaże liczbę alertów
   - Popup pokaże Recent Alerts

### 4. 🔍 Backend Monitoring

**W terminalu (Astro logs):**
```bash
# Sprawdź logi podczas testowania
cd /Users/maciejorlowski/lumos/astro
tail -f <terminal_output>
```

**Oczekiwane logi:**
- `📤 Sending audio chunk...`
- `Transcribing audio with Whisper...`
- `Analyzing transcript with LLM...`
- `🚨 Alerts detected: X alerts`

### 5. 🐛 Troubleshooting

**Extension nie działa:**
- F12 → Console → sprawdź błędy
- Sprawdź permissions
- Reload extension w `chrome://extensions/`

**API errors:**
- Sprawdź czy backend działa: `curl http://localhost:4322/api/alerts`
- Sprawdź `.env` file z API keys
- Restart Astro server

**Audio nie jest przechwytywane:**
- Sprawdź czy video ma dźwięk
- Spróbuj różnych video
- Sprawdź mikrofonowe permissions

### 6. 📊 Validation

**Sukces oznacza:**
- ✅ Extension się załadował bez błędów
- ✅ Audio chunks są wysyłane do API
- ✅ Whisper API transcribuje audio
- ✅ LLM analizuje transcript
- ✅ Alerts pojawiają się w notifications/popup
- ✅ Link do detailed view działa

## Current Status: 🎯 Ready for Testing!

**Wszystko zaimplementowane:**
- ✅ Browser Extension (content script, background, popup)
- ✅ Whisper API integration
- ✅ LLM analysis pipeline
- ✅ Real-time notifications
- ✅ Existing alerts UI integration

**Możliwe problemy:**
- 🔍 Audio capture permissions
- 🔍 CORS issues między extension a localhost
- 🔍 Whisper API rate limits/costs
- 🔍 Mock vs real transcript quality

---

**Następny krok:** Zainstaluj extension i przetestuj z YouTube video! 🚀





