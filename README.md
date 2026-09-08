<div align="center">

# FreeLLMAPI

**One OpenAI-compatible endpoint. Twelve free LLM providers. Multimodal Vision, Image Gen, and Audio Speech/STT. ~1B+ tokens per month.**

Aggregate the free tiers from Google, Groq, Cerebras, SambaNova, NVIDIA, Mistral, OpenRouter, GitHub Models, Cohere, Cloudflare, Pollinations, Z.ai (Zhipu), and Experiential Labs behind a unified OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/images/*`, `/v1/audio/*`). Keys are stored encrypted. An intelligent router picks the best available model for each request, handles multimodal inputs, falls over to the next provider when one is rate-limited, and tracks per-key usage so you stay under every free-tier cap.

[![CI](https://github.com/byteWizard-zero/my-freellmapi-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/byteWizard-zero/my-freellmapi-proxy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

![Fallback chain with per-provider token budget](repo-assets/fallback-chain.png)

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [Supported providers](#supported-providers)
- [Features](#features)
- [Not yet supported](#not-yet-supported)
- [Quick start](#quick-start)
- [Admin-only access & dashboard security](#admin-only-access--dashboard-security)
- [Using the API](#using-the-api)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [Terms of Service review](#terms-of-service-review)
- [Disclaimer](#disclaimer)

## Why this exists

Every serious AI lab now offers a free tier — a few million tokens a month, a few thousand requests a day. On its own each tier is a toy. Stacked together, they add up to roughly **1.3 billion tokens per month** of working inference capacity, across dozens of models from small-and-fast to reasonably capable.

The problem is that stacking them by hand is painful: fourteen different SDKs, fourteen different rate limits, fourteen places a request can fail. FreeLLMAPI collapses that into one OpenAI-compatible endpoint. Point any OpenAI client library at your local server, and it routes transparently across whichever providers you've added keys for.

## Supported providers

<table>
<tr>
<td align="center" width="180"><a href="https://ai.google.dev"><b>Google</b><br/>Gemini 1.5/2.0/2.5 Flash · Imagen 3 · Gemini Audio</a></td>
<td align="center" width="180"><a href="https://groq.com"><b>Groq</b><br/>Llama 3.3, Llama 4, Whisper Large v3 / Turbo</a></td>
<td align="center" width="180"><a href="https://cerebras.ai"><b>Cerebras</b><br/>Qwen3 235B · Llama 3.1 8B</a></td>
<td align="center" width="180"><a href="https://cloud.sambanova.ai"><b>SambaNova</b><br/>DeepSeek V3.x · Llama 4 · Gemma 3</a></td>
</tr>
<tr>
<td align="center"><a href="https://mistral.ai"><b>Mistral</b><br/>Large 3 · Codestral · Pixtral Vision · Small 3</a></td>
<td align="center"><a href="https://openrouter.ai"><b>OpenRouter</b><br/>openrouter/free · 20+ free chat & vision models</a></td>
<td align="center"><a href="https://github.com/marketplace/models"><b>GitHub Models</b><br/>GPT-4.1 · GPT-4o · GPT-4o mini</a></td>
<td align="center"><a href="https://developers.cloudflare.com/workers-ai"><b>Cloudflare Workers AI</b><br/>Flux 1 Schnell · SDXL · Whisper · Melo TTS</a></td>
</tr>
<tr>
<td align="center"><a href="https://pollinations.ai"><b>Pollinations AI</b><br/>Flux (Image Gen) · Voice TTS (No key required)</a></td>
<td align="center"><a href="https://docs.z.ai"><b>Z.ai (Zhipu)</b><br/>GLM-4 Flash · GLM-4V · GLM-4.5 · GLM-4.7</a></td>
<td align="center"><a href="https://cohere.com"><b>Cohere</b><br/>Command R+ · Command-A (trial)</a></td>
<td align="center"><a href="https://moonshot.cn"><b>Moonshot AI (Kimi)</b><br/>Kimi 8k/32k/128k · K2.5/2.6/2.7</a></td>
</tr>
<tr>
<td align="center" colspan="4"><a href="https://platform.experientiallabs.ai"><b>Experiential Labs</b><br/>Claude Fable 5.1 · GPT-6 Astra · GPT-5.6 Luna · DeepSeek V4 Flash · Qwen3.8 27B</a></td>
</tr>
<tr>
<td align="center" colspan="4"><i>Adding another? See <a href="#contributing">Contributing</a>.</i></td>
</tr>
</table>

## Features

- **OpenAI-compatible** — `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/embeddings`, `POST /v1/moderations`, `POST /v1/images/*`, `POST /v1/audio/*`, and `GET /v1/models` work with the official OpenAI SDKs and any OpenAI-compatible client (LangChain, LlamaIndex, Continue, Hermes, etc.). Just change `base_url`.
- **Vector Embeddings (`/v1/embeddings`)** — OpenAI-standard text embedding generation with multi-provider failover across Google `text-embedding-004`, Mistral `mistral-embed`, Cohere `embed-english-v3.0` / `embed-multilingual-v3.0`, and Cloudflare `bge-base` / `bge-large`.
- **Legacy Text Completions (`/v1/completions`)** — Full support for legacy prompt completions with streaming SSE and non-streaming response generation.
- **Content Moderation (`/v1/moderations`)** — Standard OpenAI content safety checks (hate, sexual, violence, self-harm, harassment) with provider integration and fallback safety analysis.
- **Multiple Choices (`n > 1`)** — Request multiple completions per call (`n: 2..5`) with parallel execution and aggregated token usage tracking.
- **Multi-tenant Auth & Client Token Budgets** — Issue isolated client API keys (`freellm-client-...`) for downstream applications, agents, or teams with custom RPM rate limits and monthly token budgets.
- **Multimodal Vision** — OpenAI-standard `image_url` format supported in `/v1/chat/completions` with universal image format transcoding (**HEIC**, **HEIF**, **TIFF**, **BMP**, **WebP**, **AVIF**, **PNG**, **JPEG**, **SVG**) and dynamic vision-model routing.
- **AI Image Generation & Edits (`/v1/images/*`)** — `POST /v1/images/generations`, `/v1/images/edits`, and `/v1/images/variations` with Pollinations Flux, Cloudflare Flux/SDXL, Google Imagen 3, and automatic zero-auth failover.
- **Audio Transcription, Translation & Speech (`/v1/audio/*`)** — Speech-to-text (`/v1/audio/transcriptions`, `/v1/audio/translations`) via Groq Whisper Large v3 / Turbo, Cloudflare Whisper, and Gemini Audio. Neural text-to-speech synthesis (`/v1/audio/speech`) with voices (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`).
- **Streaming and non-streaming** — Server-Sent Events for `stream: true`, JSON response otherwise. Every provider adapter implements both.
- **Tool calling** — OpenAI-style `tools` / `tool_choice` requests are passed through, and assistant `tool_calls` + `tool` role follow-up messages round-trip across providers.
- **Automatic fallover** — If the chosen provider returns a 429, 5xx, or times out, the router skips it, puts the key on a short cooldown, and retries on the next model in your fallback chain (up to 20 attempts).
- **Global Key Cooldowns** — If an API key encounters an error or hits rate limits on any model, it goes on a global cooldown for **1 hour** across all models using that key to avoid redundant fallback loops.
- **Per-key rate tracking** — RPM, RPD, TPM, and TPD counters per `(platform, model, key)` so the router always picks a key that's under its caps.
- **Sticky sessions** — Multi-turn conversations keep talking to the same model for 30 minutes to avoid the hallucination spike that comes from mid-conversation model switches.
- **Admin-Only Dashboard Access & API Protection** — Secure `AuthGate` requiring scrypt-hashed credentials to access the UI and `/api/*` management endpoints, with brute-force rate limiting.
- **Hardware Passkeys & WebAuthn Biometrics** — 1-click biometric sign-in via Touch ID, Windows Hello, Face ID, or FIDO2 security keys (YubiKey).
- **One-Time Remote Setup Code** — Generates an ephemeral 6-character code in server console logs on first boot to prevent unauthorized setup on public/cloud deployments (Render, Railway, Docker).
- **Console-Based Password Recovery** — Ephemeral 6-character reset codes logged directly to server console output for zero-dependency admin password recovery without SMTP or email services.
- **Auto-Locking & Session Isolation** — Sessions use browser `sessionStorage` and a one-click header lock button to ensure unattended devices are instantly protected.
- **Encrypted key storage** — API keys are encrypted with AES-256-GCM before hitting SQLite; decryption happens in-memory just before a request.
- **Unified API key & Multi-tenant Keys** — Clients authenticate with the master key or dedicated client API keys with token limits.
- **Health checks** — Periodic probes mark keys as `healthy`, `rate_limited`, `invalid`, or `error` so the router skips dead ones automatically.
- **Playground & Media Studio** — React + Vite UI with dedicated tabs for **💬 Chat & Vision**, **🎨 Image Studio**, **🎙️ Audio Lab**, **🔢 Embeddings Lab** (with cosine similarity comparison), and **🛡️ Moderation Inspector**.
- **Dedicated Cooldowns Page** — Real-time tracking of sleeping keys with countdown timers and exact trigger errors.
- **Automatic Sibling Sync** — CLI tool (`npm run sync-keys`) to scan adjacent repositories recursively and update their unified API key in `.env` configurations automatically.
- **Analytics** — Per-request logging with latency, token counts, success rate, and per-provider breakdowns.
- **Deploys to a Raspberry Pi** — Runs happily on a Pi 4 under PM2 behind nginx. ~40 MB RSS at idle.

## Not yet supported

The scope is deliberately focused. If a feature isn't on this list and isn't below, assume it isn't there yet:

- **Fine-tuning** (`/v1/fine_tuning/jobs`)
- **OpenAI Assistants API / Threads** (legacy thread storage)
- **Realtime WebRTC Audio API** (bi-directional low-latency audio stream)

PRs that add any of these are very welcome. See [Contributing](#contributing).

## Quick start

**Prerequisites:** Node.js 20+, npm.

```bash
git clone https://github.com/byteWizard-zero/my-freellmapi-proxy.git
cd freellmapi
npm install

# Generate an encryption key for at-rest key storage
cp .env.example .env
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env

# Start server + dashboard together
npm run dev
```

Open **http://localhost:5173** (the Vite dev UI). On first visit, set up your admin account (see [Admin-Only Access](#admin-only-access--dashboard-security)), add your provider keys on the **Provider Keys** page, reorder the **Fallback Chain** to taste, and grab your unified API key. That unified key (`freellmapi-...`) is what you point your OpenAI SDK at.

For a production build:

```bash
npm run build
node server/dist/index.js     # server + dashboard both served on :3001
```

### Key Persistence & Cloud Deployment

- **Automatic Local Persistence**: On first run, a unified key is generated and saved into `.env` as `UNIFIED_API_KEY=freellmapi-...`. It automatically persists across server restarts and cold starts.
- **Cloud & Container Hosting (Render, Railway, Docker, Fly.io)**: On stateless container platforms where `.env` files are not committed to git, set the environment variable in your cloud platform dashboard:
  ```env
  UNIFIED_API_KEY=freellmapi-your-fixed-secret-key
  ```
  This ensures your proxy endpoint always uses the same key across container redeployments and cold starts.
- **Dashboard Display**: The React UI automatically fetches and displays the active key from the server. You don't need to manually configure anything inside the React UI.

### Syncing Sibling Repositories (Optional)

If you have sibling coding projects on your machine that consume this proxy, you can automatically write the active unified API key directly to their `.env` files:
1. Ensure your sibling repositories have a `.env` or `.env.local` containing one of the standard key variables (e.g. `OPENAI_API_KEY`, `UNIFIED_API_KEY`, `PROXY_API_KEY`).
2. Run the sync command:
   ```bash
   npm run sync-keys
   ```
   This tool scans all adjacent workspace folders recursively (up to depth 4), updates matching placeholders with your active unified API key, and prints diagnostics.

## Admin-Only Access & Dashboard Security

FreeLLMAPI includes a built-in security perimeter that protects your upstream provider API keys, model routing configuration, client tenant keys, and usage analytics behind an **AuthGate**.

All management API routes (`/api/*`) require an authenticated admin session token. Downstream LLM consumer traffic (`/v1/*`) continues to authenticate separately via your master Unified API Key (`freellmapi-...`) or Client Project Keys (`freellm-client-...`).

---

### Step 1: Initial Setup (Claiming Admin Ownership)

When you run FreeLLMAPI for the first time, no admin account exists yet. Opening the web interface displays the **Create Admin Account** screen.

#### Option A: Local Setup (`http://localhost:5173` or `http://localhost:3001`)
1. Open the dashboard in your browser.
2. Enter your desired admin **Email** and a **Password** (minimum 8 characters).
3. Confirm your password.
4. On local loopback connections (`127.0.0.1` / `::1`), the **Setup Code** is not required. Click **Create Account**.

#### Option B: Remote or Cloud Deployment (Render, Railway, Docker, VPS)
To prevent unauthorized parties from claiming ownership when the proxy boots on a public IP or cloud platform:
1. Open your deployed dashboard URL (e.g. `https://your-proxy.onrender.com`).
2. Inspect your server console logs (e.g. Render Dashboard **Logs** tab or `docker logs <container_id>`). On startup, the server generates and displays an ephemeral 6-character code:
   ```text
   ========================================
     Dashboard setup code: 9A4F2E
     (Required for first-time remote setup)
   ========================================
   ```
3. Enter your **Email**, **Password**, and this **6-character Setup Code** in the registration form.
4. Click **Create Account**.
5. Once your account is created, the setup code is permanently purged from memory.

---

### Step 2: Logging In to the Dashboard

Once initialized, all subsequent visits require administrative authentication:

1. Navigate to the dashboard URL.
2. Enter your registered admin **Email** and **Password**.
3. Click **Sign in**.

#### Security Safeguards:
- **Per-Visit Session Isolation**: Session tokens are stored in the browser's `sessionStorage`. If you close the browser tab or open a new window, you will be prompted to log in again. This prevents unauthorized access on shared or unattended computers.
- **Server-Side Expiry**: Active sessions are validated against SQLite session token hashes (SHA-256) and expire after 30 days.
- **Brute-Force Rate Limiting**: The server tracks failed login attempts per client IP. After **5 failed attempts**, further login requests from that IP are blocked for **15 minutes** (`HTTP 429 Too Many Requests`).

---

### Step 3: Setting Up 1-Click Biometric / Hardware Passkey Login (WebAuthn)

FreeLLMAPI supports FIDO2 / WebAuthn passwordless authentication. You can sign in using **Touch ID**, **Windows Hello**, **Face ID**, or physical security keys (e.g. **YubiKey**) without retyping your password.

#### Registering a Device Passkey:
1. Log in to the dashboard using your email and password.
2. If no passkey has been added yet, an alert banner appears at the top:
   > 🔑 *You haven't set up a Passkey yet. Set one up to sign in with your fingerprint or device PIN next time!*
   *(You can also click the **Fingerprint icon** `👆` in the top-right header at any time).*
3. Click **Set up Passkey**.
4. Confirm the prompt presented by your browser or operating system (e.g. tap fingerprint scanner, scan face, or touch YubiKey).
5. You can register passkeys across multiple devices (e.g. desktop, laptop, and phone).

#### Signing In with a Passkey:
- On future visits to the login screen, a highlighted button appears:
  **"👆 Sign in with Fingerprint / Passkey"**.
- Click the button and authenticate with your biometric sensor or device PIN for instant 1-click access.

---

### Step 4: Quick-Locking the Dashboard & Logging Out

When leaving your workstation:
1. Click the **Lock icon** (`🔒`) in the top-right navigation bar.
2. The browser immediately wipes the session token from `sessionStorage` and triggers a logout event.
3. The UI immediately resets to the sign-in screen, blocking further access to all dashboard management views and `/api/*` endpoints.

---

### Step 5: Password Recovery via Server Logs (Forgot Password)

If you forget your admin password, FreeLLMAPI includes a secure, zero-dependency recovery mechanism that works without needing external SMTP or email services:

1. On the login screen, click **"Forgot password?"** below the password field.
2. Enter your registered admin **Email** and click **Send Reset Code**.
3. Check your server console output (e.g. terminal logs, Docker logs, or Render Dashboard Logs). FreeLLMAPI prints a time-limited 6-character reset code:
   ```text
   ========================================
     Password reset code: E7B841
     Account: admin@example.com
     (Valid for 15 minutes)
   ========================================
   ```
4. Enter the **Reset Code**, your **New Password** (minimum 8 characters), and confirm the password.
5. Click **Reset & Log In**.
6. FreeLLMAPI updates your password using scrypt hashing, invalidates all prior active sessions across all devices, and logs you into the dashboard with a new session.

---

### Step 6: Programmatic Access to Admin Endpoints

All administrative backend routes (`/api/keys`, `/api/client-keys`, `/api/models`, `/api/fallback`, `/api/analytics`, `/api/health`, `/api/settings`) enforce authentication via the `requireAuth` middleware.

To interact with these management routes programmatically (e.g. from CI/CD, scripts, or external tools):

1. **Obtain a Session Token**:
   ```bash
   curl -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "admin@example.com",
       "password": "your-password"
     }'
   ```
   *Response:*
   ```json
   {
     "token": "7f8b9c0d1e2f...",
     "user": {
       "id": 1,
       "email": "admin@example.com"
     }
   }
   ```

2. **Call Protected Admin Routes**:
   Send the session token in the `Authorization` header as a Bearer token (or via `x-dashboard-token`):
   ```bash
   # List configured provider keys
   curl http://localhost:3001/api/keys \
     -H "Authorization: Bearer 7f8b9c0d1e2f..."

   # Manage client tenant keys
   curl http://localhost:3001/api/client-keys \
     -H "Authorization: Bearer 7f8b9c0d1e2f..."
   ```

## Using the API

Any OpenAI-compatible client works. Examples:

**Python**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="freellmapi-your-unified-key",
)

resp = client.chat.completions.create(
    model="auto",  # let the router pick; or specify e.g. "gemini-2.5-flash"
    messages=[{"role": "user", "content": "Summarise the fall of Rome in one sentence."}],
)
print(resp.choices[0].message.content)
print("Routed via:", resp.headers.get("x-routed-via"))
```

**curl**

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer freellmapi-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "hi"}]
  }'
```

**Streaming**

```python
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Stream me a haiku about SQLite."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**Tool calling**

Pass OpenAI-style `tools` and `tool_choice`; the assistant response round-trips back through the proxy exactly like the OpenAI API. Multi-step flows (assistant `tool_calls` → `tool` role follow-up → final answer) work across every provider the router can reach.

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# 1. Model asks for a tool call
first = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "What's the weather in Karachi?"}],
    tools=tools,
    tool_choice="required",
)
call = first.choices[0].message.tool_calls[0]

# 2. You execute the tool, feed the result back
final = client.chat.completions.create(
    model="auto",
    messages=[
        {"role": "user", "content": "What's the weather in Karachi?"},
        first.choices[0].message,
        {"role": "tool", "tool_call_id": call.id, "content": '{"temp_c": 32, "cond": "sunny"}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

Works with `stream=True` as well — you'll get `delta.tool_calls` chunks followed by a `finish_reason: "tool_calls"` close. Under the hood, OpenAI-compatible providers (Groq, Cerebras, SambaNova, Mistral, OpenRouter, GitHub Models, HuggingFace, Cloudflare, Cohere compat) get the request passed through; Gemini requests get translated into Google's `functionDeclarations` / `functionResponse` shape and the response is translated back.

**Multimodal Vision**

Pass image URLs or base64 data URLs in standard OpenAI content arrays. Requests with images are automatically routed to vision-capable models:

```python
resp = client.chat.completions.create(
    model="auto",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe the contents of this image in detail."},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}},
        ],
    }],
)
print(resp.choices[0].message.content)
```

**Image Generation (`/v1/images/generations`)**

Generate images with Pollinations Flux, Cloudflare Flux 1 Schnell / SDXL, and Google Imagen 3:

```python
img_resp = client.images.generate(
    prompt="A futuristic electric hypercar speeding across a neon highway at twilight",
    model="flux",
    size="1024x1024",
    response_format="b64_json",
)
# Access generated base64 or URL
image_b64 = img_resp.data[0].b64_json
```

**Audio Transcription & Translation (`/v1/audio/*`)**

Transcribe audio files or voice notes into text using Whisper Large v3 / Turbo:

```python
with open("voice_memo.mp3", "rb") as audio_file:
    transcript = client.audio.transcriptions.create(
        model="whisper-large-v3",
        file=audio_file,
    )
print(transcript.text)
```

**Text-to-Speech (`/v1/audio/speech`)**

Synthesize spoken audio from text with natural neural voices:

```python
speech_response = client.audio.speech.create(
    model="tts-1",
    voice="nova",
    input="Hello! FreeLLMAPI now streams high-quality neural speech.",
)
speech_response.stream_to_file("output.mp3")
```

**Vector Embeddings (`/v1/embeddings`)**

Generate dense vector representations for semantic search and retrieval across Google, Mistral, Cohere, and Cloudflare:

```python
embed_resp = client.embeddings.create(
    model="text-embedding-004",  # or "auto", "mistral-embed", "embed-english-v3.0"
    input=["Artificial intelligence and neural networks", "Machine learning models"],
)
for item in embed_resp.data:
    print(f"Embedding index {item.index}: {len(item.embedding)} dimensions")
```

**Legacy Completions (`/v1/completions`)**

Interact with classic prompt-style completion models with full streaming support:

```python
completion = client.completions.create(
    model="auto",
    prompt="Generate three creative company names for a quantum computing startup:\n1.",
    max_tokens=60,
    temperature=0.7,
)
print(completion.choices[0].text)
```

**Multiple Choices (`n > 1`)**

Generate multiple independent completions in a single call:

```python
multi_choice = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Write a short catchy tagline for a coffee shop."}],
    n=3,
)
for i, choice in enumerate(multi_choice.choices):
    print(f"Choice {i + 1}: {choice.message.content}")
```

**Content Moderation (`/v1/moderations`)**

Run content safety evaluations with category scores and flags:

```python
mod_resp = client.moderations.create(
    input="Check if this input text complies with content safety standards.",
)
print("Flagged:", mod_resp.results[0].flagged)
print("Category scores:", mod_resp.results[0].category_scores)
```

**Client API Keys & Token Budgets (`/api/client-keys`)**

Create isolated API tokens with custom RPM rate limits and monthly token budgets for downstream apps:

```bash
# Create a tenant key with 60 RPM limit and 1,000,000 monthly token quota
curl http://localhost:3001/api/client-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Discord Bot",
    "rateLimitRpm": 60,
    "monthlyTokenBudget": 1000000
  }'
```

Every response carries an `X-Routed-Via: <platform>/<model>` header so you can see which provider actually served each call. If a request fell over between providers, you'll also see `X-Fallback-Attempts: N`.

## Screenshots

### Keys

Manage provider credentials and grab the unified API key your apps connect with. Each key shows a status dot and when it was last health-checked.

![Keys page](repo-assets/keys.png)

### Playground

Send a chat completion through the router and see which provider served it, with the model ID and latency printed right on the message.

![Playground page](repo-assets/playground.png)

### Analytics

Request volume, success rate, tokens in and out, average latency, and per-provider breakdowns over 24h / 7d / 30d windows.

![Analytics page](repo-assets/analytics.png)

## How it works

```
┌──────────────────┐   Bearer freellmapi-…   ┌─────────────────────────┐
│  OpenAI SDK /    │ ──────────────────────▶ │  Express proxy (:3001)  │
│  curl / any      │ ◀────────────────────── │  /v1/chat/completions   │
│  OpenAI client   │      streamed tokens    └────────────┬────────────┘
└──────────────────┘                                      │
                                                          ▼
                             ┌────────────────────────────────────────────────┐
                             │  Router                                        │
                             │   1. Pick highest-priority model that          │
                             │      (a) has a healthy key and                 │
                             │      (b) is under all its rate limits.         │
                             │   2. Decrypt key, call provider SDK.           │
                             │   3. On 429/5xx → cooldown + retry next model. │
                             └────────────────────────────────────────────────┘
                                          │
   ┌──────────────┬────────────┬──────────┴─────────┬─────────────┬──────────┐
   ▼              ▼            ▼                    ▼             ▼          ▼
 Google         Groq        Cerebras           OpenRouter        HF       …10 more
```

- **Router** (`server/src/services/router.ts`) — picks a model per request.
- **Rate-limit ledger** (`server/src/services/ratelimit.ts`) — in-memory RPM/RPD/TPM/TPD counters backed by SQLite, with cooldowns on 429s.
- **Provider adapters** (`server/src/providers/*.ts`) — one file per provider, implementing the `Provider` base class: `chatCompletion()` and `streamChatCompletion()`.
- **Health service** (`server/src/services/health.ts`) — periodic probe keeps key status fresh.
- **Dashboard** (`client/`) — React + Vite + shadcn/ui admin surface.
- **Storage** — SQLite (`better-sqlite3`) with AES-256-GCM envelope encryption for keys.

## Limitations

Stacking free tiers has real trade-offs. Be honest with yourself about them:

- **No frontier models.** The free-tier catalog tops out around Llama 3.3 70B, GLM-4.5, Qwen 3 Coder, and Gemini 2.5 Pro. You will not get GPT-5 or Claude Opus class reasoning through this. For hard problems, pay for a real API.
- **Intelligence degrades as the day progresses.** Your top-ranked models (usually Gemini 2.5 Pro, GPT-4o via GitHub Models) have the lowest daily caps. Once they hit their limits, the router falls down your priority chain to smaller/weaker models. Expect the effective intelligence of the endpoint to drop in the late hours of each day — then reset at UTC midnight.
- **Latency is highly variable.** Cerebras and Groq are extremely fast; others are not. You get whichever one is available.
- **Free tiers can change without notice.** Providers regularly tighten, loosen, or remove free tiers. When that happens you'll see 429s or auth errors until you update the catalog. Re-seed scripts live in `server/src/scripts/`.
- **No SLA, by definition.** If you need reliability, use a paid provider with a contract.
- **Single-admin architecture.** While FreeLLMAPI secures the dashboard with admin authentication and supports multi-tenant client API keys with token quotas for downstream applications, the management dashboard is designed for a single administrator.

## Contributing

Contributors very welcome! Good first PRs:

- **Add a provider** — copy `server/src/providers/openai-compat.ts` as a template, wire it into `server/src/providers/index.ts`, seed its models in `server/src/db/index.ts`, add a test in `server/src/__tests__/providers/`.
- **Add an endpoint** — embeddings, images, moderations. The provider base class can grow new methods; adapters declare which they support.
- **Improve the router** — cost-aware routing (cheapest-healthy-fastest tradeoffs), better latency-weighted priority, regional pinning.
- **Dashboard polish** — charts on the Analytics page, key rotation UX, batch import of keys from `.env`.
- **Docs** — more examples, client library snippets for Go/Rust/etc., a deployment recipe for Docker or Fly.

**Development loop:**

```bash
npm install
npm run dev      # server on :3001, dashboard on :5173, both with HMR
npm test         # vitest — 75 tests across providers, routes, router, ratelimit
```

PRs should include a test, keep the existing test suite green, and match the `.editorconfig` / tsconfig defaults already in the repo. Issues and discussions are open.

### Contributors

Thanks to everyone who's helped improve FreeLLMAPI:

- [@moaaz12-web](https://github.com/moaaz12-web) — tool-calling support across providers (#3)
- [@lukasulc](https://github.com/lukasulc) — better-sqlite3 bump to fix npm install on Node 24+ (#12)
- [@VinhPhamAI](https://github.com/VinhPhamAI) — root `.env` PORT now propagates to server + Vite dev proxy + UI base URL (#27)
- [@deadc](https://github.com/deadc) — preserve Gemini `thoughtSignature` so multi-turn function calling stops 400-ing (#32); router model-first key-exhaustion tests + per-model `limits` hoist (#42)
- [@zhangyu1324](https://github.com/zhangyu1324) — requested Ollama Cloud integration, now V10 catalog (#14 / #41)
- [@jtbrennan-git](https://github.com/jtbrennan-git) — security review (#35) and Phase 1 hardening: parameterized analytics queries, sort-preset whitelist, timing-safe API key compare, mid-stream error sanitization
- [@praveenkumarpranjal](https://github.com/praveenkumarpranjal) — guard Gemini SSE `JSON.parse` so a malformed frame no longer aborts the whole stream, plus first streaming tests for the Google provider (#47)

## Terms of Service review

A self-hosted, single-user, personal-use setup was re-reviewed against each provider's ToS (May 2026). Summary:

| Provider | Verdict | Notes |
|---|---|---|
| Google Gemini | ⚠️ Caution | March 2026 ToS narrows scope to *"professional or business purposes, not for consumer use"* — a self-hosted developer proxy is still defensible, but the clause is new. |
| Groq | ✅ Likely OK | GroqCloud Services Agreement permits Customer Application integration. |
| Cerebras | ✅ Likely OK | Permitted; explicitly forbids selling/transferring API keys. |
| Mistral | ✅ Likely OK | APIs allowed for personal/internal business use. |
| OpenRouter | ✅ Likely OK | April 2026 ToS sharpens the no-resale / no-competing-service clause; private single-user proxy still fine. |
| SambaNova | ⚠️ Ambiguous | EULA §1.5(c) blocks resale and "service bureau" use; single-user with no third-party access is fine. |
| Cloudflare Workers AI | ⚠️ Ambiguous | No anti-proxy clause; covered by general Self-Serve Subscription Agreement. |
| NVIDIA NIM | ⚠️ Caution | Trial ToS §1.2 / §1.4: *"evaluation only, not production."* Disabled in default catalog. |
| GitHub Models | ⚠️ Caution | Free tier explicitly scoped to *"experimentation"* and *"prototyping."* |
| Cohere | ❌ Avoid | Terms §14 still forbids *"personal, family or household purposes."* |
| Zhipu (open.bigmodel.cn) | ✅ Likely OK | Personal/non-commercial research carve-out still in the platform docs. |
| Z.ai (api.z.ai) | ⚠️ Caution | New row — Singapore entity (distinct from Zhipu CN). §III.3(l) anti-traffic-redirect clause could plausibly be read against a proxy; no explicit personal-use carve-out. |
| Ollama Cloud | ✅ Likely OK | New row — Free plan permits cloud-model access (1 concurrent, 5-hour session caps). No anti-proxy / anti-resale clauses found. *(Integration tracked in #14.)* |
| Moonshot AI (Kimi) | ✅ Likely OK | Direct global API endpoint (`api.moonshot.ai/v1`) supported. |

Rules of thumb that keep most providers happy: **one account per provider**, **no reselling**, **no sharing your endpoint with other humans**, **don't hammer a free tier as a paid production backend**. This is informational, not legal advice — read each provider's ToS and make your own call.

Removed since the April 2026 review: Hugging Face and MiniMax direct integrations were dropped from the catalog (HF — tool-call format issues; MiniMax — superseded by the OpenRouter `minimax/minimax-m2.5:free` route).

## Disclaimer

**This project is for personal experimentation and learning, not production.** Free tiers exist so developers can prototype against them; they aren't a stable, supported inference substrate and shouldn't be treated as one. If you build something real on top of FreeLLMAPI, swap in a paid API before you ship. Your relationship with each upstream provider is governed by the terms you accepted when you created your account — those terms still apply when the traffic is proxied through this project, and you're responsible for complying with them.

## License

[MIT](./LICENSE)

<!-- YOLO badge test -->
<!-- Pair Extraordinaire badge test -->
