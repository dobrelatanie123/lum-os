# REST API Plan

## 1. Resources

- **Users** - corresponds to `users` table - user management and authentication
- **Podcasts** - corresponds to `podcasts` table - podcast metadata and analysis triggers
- **Transcriptions** - corresponds to `transcriptions` table - podcast transcriptions (1:1 with podcasts)
- **Alerts** - corresponds to `alerts` table - fact-checking alerts for users
- **Whitelist** - corresponds to `whitelist` table - approved YouTube channels for analysis
- **Payments** - corresponds to `payments` table - user billing and payment tracking

## 2. Endpoints

### Authentication Endpoints

#### POST /api/auth/login
- **Description**: Authenticate user with email and magic link
- **Request Body**:
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Response**: 
  ```json
  {
    "success": true,
    "message": "Magic link sent to email"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request, 429 Too Many Requests

#### POST /api/auth/verify
- **Description**: Verify magic link token
- **Request Body**:
  ```json
  {
    "token": "magic_link_token",
    "email": "user@example.com"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "user"
    },
    "access_token": "jwt_token"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request, 401 Unauthorized

#### POST /api/auth/logout
- **Description**: Logout user and invalidate session
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized

### User Endpoints

#### GET /api/users/profile
- **Description**: Get current user profile
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
  ```json
  {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 404 Not Found

#### PUT /api/users/profile
- **Description**: Update user profile
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "email": "newemail@example.com"
  }
  ```
- **Response**:
  ```json
  {
    "id": "uuid",
    "email": "newemail@example.com",
    "role": "user",
    "updated_at": "2024-01-01T00:00:00Z"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request, 401 Unauthorized, 409 Conflict

### Podcast Endpoints

#### POST /api/podcasts/analyze
- **Description**: Trigger analysis of a YouTube podcast
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "url": "https://youtube.com/watch?v=...",
    "title": "Podcast Episode Title",
    "channel": "Channel Name",
    "timestamp": 1234567890
  }
  ```
- **Response**:
  ```json
  {
    "podcast_id": "uuid",
    "analysis_status": "started",
    "estimated_completion": "2024-01-01T00:05:00Z"
  }
  ```
- **Success Codes**: 202 Accepted
- **Error Codes**: 400 Bad Request, 401 Unauthorized, 402 Payment Required, 429 Too Many Requests

#### GET /api/podcasts/{id}
- **Description**: Get podcast details
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
  ```json
  {
    "id": "uuid",
    "title": "Podcast Title",
    "url": "https://youtube.com/watch?v=...",
    "description": "Description",
    "created_at": "2024-01-01T00:00:00Z",
    "transcription": {
      "id": "uuid",
      "transcript": "Full transcript text...",
      "created_at": "2024-01-01T00:01:00Z"
    }
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 404 Not Found

#### GET /api/podcasts
- **Description**: List podcasts with pagination and filtering
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `page` (optional): Page number (default: 1)
  - `limit` (optional): Items per page (default: 20, max: 100)
  - `search` (optional): Search in title/description
- **Response**:
  ```json
  {
    "podcasts": [
      {
        "id": "uuid",
        "title": "Podcast Title",
        "url": "https://youtube.com/watch?v=...",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "total_pages": 8
    }
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 400 Bad Request

### Alert Endpoints

#### GET /api/alerts
- **Description**: Get user's alerts with filtering and pagination
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `page` (optional): Page number (default: 1)
  - `limit` (optional): Items per page (default: 20)
  - `podcast_id` (optional): Filter by podcast
  - `alert_type` (optional): Filter by alert type
- **Response**:
  ```json
  {
    "alerts": [
      {
        "id": "uuid",
        "podcast_id": "uuid",
        "alert_type": "fact_check",
        "details": {
          "claim": "Study shows 90% effectiveness",
          "verdict": "questionable",
          "reasoning": "No credible source found",
          "sources": ["https://example.com/study"],
          "timestamp": 1234567890
        },
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50
    }
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 400 Bad Request

#### GET /api/alerts/{id}
- **Description**: Get specific alert details
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
  ```json
  {
    "id": "uuid",
    "podcast_id": "uuid",
    "alert_type": "fact_check",
    "details": {
      "claim": "Study shows 90% effectiveness",
      "verdict": "questionable",
      "reasoning": "No credible source found for this specific claim",
      "sources": ["https://example.com/study"],
      "timestamp": 1234567890,
      "context": "Full context from transcript..."
    },
    "created_at": "2024-01-01T00:00:00Z"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 404 Not Found

#### PUT /api/alerts/{id}/rating
- **Description**: Rate alert accuracy (helpful/not helpful)
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "rating": "helpful", // "helpful" or "not_helpful"
    "comment": "Optional feedback comment"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "message": "Rating recorded"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request, 401 Unauthorized, 404 Not Found

### Whitelist Endpoints (Admin Only)

#### GET /api/whitelist
- **Description**: Get whitelist of approved YouTube channels
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `page` (optional): Page number
  - `search` (optional): Search channel identifier
- **Response**:
  ```json
  {
    "channels": [
      {
        "id": "uuid",
        "channel_identifier": "@example_channel",
        "config_description": "Tech podcast channel",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "total": 25
    }
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 403 Forbidden

#### POST /api/whitelist
- **Description**: Add channel to whitelist (admin only)
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "channel_identifier": "@new_channel",
    "config_description": "Description of channel"
  }
  ```
- **Response**:
  ```json
  {
    "id": "uuid",
    "channel_identifier": "@new_channel",
    "config_description": "Description of channel",
    "created_at": "2024-01-01T00:00:00Z"
  }
  ```
- **Success Codes**: 201 Created
- **Error Codes**: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 409 Conflict

#### DELETE /api/whitelist/{id}
- **Description**: Remove channel from whitelist (admin only)
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
  ```json
  {
    "success": true,
    "message": "Channel removed from whitelist"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized, 403 Forbidden, 404 Not Found

### Payment Endpoints

#### POST /api/payments/checkout
- **Description**: Create Stripe checkout session for usage-based billing
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "credits": 10, // Number of alert credits to purchase
    "success_url": "https://app.lumos.com/success",
    "cancel_url": "https://app.lumos.com/cancel"
  }
  ```
- **Response**:
  ```json
  {
    "checkout_url": "https://checkout.stripe.com/...",
    "session_id": "cs_stripe_session_id"
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request, 401 Unauthorized

#### GET /api/payments/history
- **Description**: Get user's payment history
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `page` (optional): Page number
  - `limit` (optional): Items per page
- **Response**:
  ```json
  {
    "payments": [
      {
        "id": "uuid",
        "payment_status": "completed",
        "amount": 5.00,
        "transaction_details": "10 alert credits",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "total": 5
    }
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 401 Unauthorized

#### POST /api/payments/webhook
- **Description**: Stripe webhook endpoint for payment confirmations
- **Headers**: `Stripe-Signature: webhook_signature`
- **Request Body**: Stripe webhook payload
- **Response**:
  ```json
  {
    "received": true
  }
  ```
- **Success Codes**: 200 OK
- **Error Codes**: 400 Bad Request

## 3. Authentication and Authorization

### Authentication Mechanism
- **Primary**: Magic link authentication via email
- **Secondary**: JWT tokens for session management
- **Token Expiry**: 24 hours for access tokens, 7 days for refresh tokens

### Authorization Levels
- **User**: Access to own alerts, podcasts, and payments
- **Admin**: Full access including whitelist management and all user data

### Implementation Details
- Row Level Security (RLS) policies enforced at database level
- JWT tokens contain user_id and role claims
- API middleware validates tokens and sets user context
- Rate limiting implemented per IP address and per user

## 4. Validation and Business Logic

### Validation Rules

#### Users
- Email must be valid format and unique
- Role must be either 'user' or 'admin'
- Password requirements (if implemented): minimum 8 characters

#### Podcasts
- URL must be valid YouTube URL format
- Title cannot be empty, maximum 255 characters
- Must check whitelist before allowing analysis

#### Alerts
- alert_type must be predefined value
- details must contain valid JSON structure
- Rate limiting: maximum 5 alerts per minute per user

#### Payments
- Amount must be positive numeric value with 2 decimal places
- Payment status must be valid enum value

### Business Logic Implementation

#### Podcast Analysis Flow
1. Validate YouTube URL and extract video ID
2. Check if channel is whitelisted
3. Verify video duration (minimum 60 minutes)
4. Check cache for existing analysis (30-day TTL)
5. If not cached, trigger background processing:
   - Download audio chunks (20-30 seconds with 3-5 second overlap)
   - Send to OpenAI for transcription
   - Extract claims using AI analysis
   - Verify claims against academic APIs (Semantic Scholar, PubMed)
   - Generate alerts with verdict and reasoning

#### Rate Limiting Logic
- Maximum 5 alerts per minute per user
- Claims within 120-second window are grouped (max 3 per alert)
- IP-based rate limiting for API endpoints
- Graceful degradation for high-traffic scenarios

#### Payment Logic
- First alert is free for new users
- Subsequent alerts require payment through Stripe
- Usage-based pricing model
- Credits are deducted upon alert generation
- Failed payments prevent new analysis requests

#### Cache Strategy
- Analysis results cached by video ID for 30 days
- Cache invalidation on video length changes
- User session data cached for performance
- API response caching for whitelist and static data
