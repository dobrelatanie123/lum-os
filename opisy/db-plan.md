# Schemat bazy danych dla projektu Lumos

## 1. Tabele

### 1.1. Użytkownicy (users)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2. Podcasty (podcasts)
```sql
CREATE TABLE podcasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.3. Transkrypcje (transcriptions)
```sql
CREATE TABLE transcriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    podcast_id UUID NOT NULL UNIQUE,
    transcript TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_podcast
        FOREIGN KEY(podcast_id) 
            REFERENCES podcasts(id) ON DELETE CASCADE
);
```

### 1.4. Alerty (alerts)
```sql
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    podcast_id UUID NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
            REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_podcast
        FOREIGN KEY(podcast_id)
            REFERENCES podcasts(id) ON DELETE CASCADE
);
```

### 1.5. Whitelista (whitelist)
```sql
CREATE TABLE whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_identifier VARCHAR(255) NOT NULL UNIQUE,
    config_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.6. Płatności (payments)
```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    payment_status VARCHAR(50) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    transaction_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_user_payment
        FOREIGN KEY(user_id) 
            REFERENCES users(id) ON DELETE CASCADE
);
```

## 2. Relacje między tabelami

- Tabela `alerts` łączy `users` z `podcasts` (relacja wiele-do-jednego).
- Tabela `transcriptions` ma relację 1:1 z tabelą `podcasts` (pole `podcast_id` jest unikalne).
- Tabela `payments` odnosi się do tabeli `users`.

## 3. Indeksy

- Użytkownicy: Indeks unikatowy na `email` (już określony w definicji tabeli).
- Alerty: Indeksy na kolumnach `user_id` oraz `podcast_id`.
- Płatności: Indeks na kolumnie `user_id`.

## 4. Zasady PostgreSQL (Row Level Security)

```sql
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Polityka bezpieczeństwa dla tabeli alerts
CREATE POLICY user_alerts_policy ON alerts
    USING (current_setting('app.current_user_id')::uuid = user_id OR current_setting('app.current_user_role') = 'admin');

-- Polityka bezpieczeństwa dla tabeli payments
CREATE POLICY user_payments_policy ON payments
    USING (current_setting('app.current_user_id')::uuid = user_id OR current_setting('app.current_user_role') = 'admin');
```

## 5. Dodatkowe uwagi

- Wszystkie tabele zawierają pola audytu (`created_at`, `updated_at`) z domyślną wartością `NOW()`. Automatyczna aktualizacja `updated_at` może być implementowana za pomocą triggerów.
- Rozszerzenie tabeli `transcriptions` w celu obsługi wielu wersji transkrypcji pozostaje opcjonalne na przyszłość.
- Schemat jest zoptymalizowany pod kątem PostgreSQL i integracji z Supabase.
