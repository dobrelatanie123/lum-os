# Lumos Project Summary

## Overview

**Lumos is an AI-powered fact-checking system for YouTube podcasts**, designed as a Chrome browser extension that automatically verifies claims made in long-form video content. When a user watches a podcast on YouTube, the extension captures audio chunks, sends them to a backend API for transcription using OpenAI's Whisper, and then analyzes the transcript with GPT-4 to identify factual claims. Each claim is evaluated for credibility and cross-referenced against academic sources (via Google Custom Search, Semantic Scholar, or PubMed). The results are delivered as browser notifications with verdicts (confirmed/questionable) and links to supporting evidence, allowing users to quickly assess the reliability of information they're consuming.

## Architecture

**The technical architecture consists of three main components**:

1. **Chrome Extension** (`extension/`) - Detects YouTube playback, captures audio, and displays alerts via browser notifications
2. **Express.js API Server** (`api-server.js`) - Runs on port 3001, orchestrates the AI pipeline including:
   - Audio processing (Whisper transcription)
   - YouTube video handling (via yt-dlp)
   - Fact-checking (GPT-4 analysis)
   - Academic source lookup
   - Cost tracking and rate limiting
3. **Astro/React Frontend** (`astro/`) - Web interface for viewing alert history and managing videos

### Backend Services

The backend uses a modular TypeScript service architecture:

| Service | Purpose |
|---------|---------|
| `audio-processor.ts` | OpenAI Whisper integration for transcription |
| `youtube-processor.ts` | yt-dlp audio extraction from YouTube |
| `fact-checker.ts` | GPT-4 claim analysis and verification |
| `academic-search.ts` | Google Custom Search for academic papers |
| `academic-analyzer.ts` | Source relevance scoring |
| `cost-tracker.ts` | API usage and cost monitoring |
| `retry-handler.ts` | Retry logic and circuit breaker patterns |

### Database

Data is persisted in Supabase (PostgreSQL) with the following tables:

- `podcasts` - Video metadata (id, title, url, description)
- `transcriptions` - Full transcript text linked to podcasts
- `alerts` - Fact-check results with claims, verdicts, and sources
- `users` - User accounts with role-based access
- `payments` - Usage-based billing records
- `whitelist` - Approved YouTube channels

## Business Model

**The project is built for a freemium business model** targeting tech-savvy podcast listeners who want to verify claims about health, science, and statistics.

### Key Features

- **Language Support**: English and Polish
- **Platform**: YouTube-only (MVP scope)
- **Pricing**: Usage-based via Stripe Checkout
- **Rate Limiting**: Max 5 alerts per minute
- **Claim Grouping**: Within 120-second windows (up to 3 claims per alert)
- **Caching**: 30-day transcript cache per video
- **Fast Mode**: Transcript-only processing (skips GPT analysis)

### Tech Stack

- **Runtime**: Node.js / Bun
- **Backend**: Express.js, TypeScript
- **Frontend**: Astro 5, React 19, Tailwind CSS, shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI (Whisper, GPT-4/GPT-5)
- **Tools**: yt-dlp for YouTube audio extraction

