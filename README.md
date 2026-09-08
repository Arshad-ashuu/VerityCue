# Co-Presenter — Private AI co-presenter for Microsoft Teams meetings

A Teams **meeting side panel** app that listens to the meeting conversation, detects
customer questions in real time, and suggests concise, grounded answers that only
**you** can see.

```
Customer:  "Why should we use Terraform instead of clicking through the Azure Portal?"

Co-Presenter (side panel, private to you):
  Question   Why Terraform instead of the Azure Portal?
  Topic      Infrastructure as Code
  Intent     Objection / comparison
  Domain     Azure • DevOps
  Answer     The portal is great for exploring, but it can't be reviewed, repeated,
             or rolled back. Terraform makes your environment a versioned file:
             one `plan` shows exactly what will change before it happens, and the
             same code builds dev, test and prod identically.
  Talking points
   • Repeatable + reviewable (PR review for infrastructure)
   • Drift detection — the portal has none
   • One workflow across Azure, and multi-cloud if needed
  Sources    docs/iac-terraform.md
```

## Repository layout

| Path | What it is |
| --- | --- |
| `client/` | React + Vite side panel (Teams tab). Runs real-time speech-to-text. |
| `server/` | Express API: question detection, retrieval, answer generation. |
| `server/knowledge/` | **Your** grounding content. Drop markdown files here. |
| `appPackage/` | Teams app manifest — zip this to sideload the app. |

## Verified environment

The dependency tree was installed and both projects were type-checked and built on:

| | |
| --- | --- |
| Node | 24.18.0, **win32-arm64** |
| npm | 11.16.0 |
| Registry | `packagefeedproxy.microsoft.io/npm` — all packages resolve |
| Backend | `tsc --noEmit` clean, boots and serves `/api/health` |
| Frontend | `tsc --noEmit` clean, `vite build` produces a 613 kB bundle |

Two environment notes that cost time if you hit them cold:

- npm 11 **blocks postinstall scripts** by default, so esbuild's `install.js` never runs.
  Harmless here — `tsx` and Vite get their arm64 binaries from optional dependencies.
  You do not need `npm approve-scripts`.
- `@vitejs/plugin-react@6` requires `vite@8`. Pairing it with Vite 7 fails `ERESOLVE`.

## Prerequisites

- Node.js 20+ (tested on 24)
- An **Azure OpenAI** resource with a chat deployment (e.g. `gpt-4o-mini`) and an
  embedding deployment (e.g. `text-embedding-3-small`)
- An **Azure AI Speech** resource (for real-time transcription)
- A tunnel for local dev (`devtunnel host -p 5173 --allow-anonymous` or ngrok)

## Setup

```powershell
cp .env.example .env      # then fill in the values
cd server; npm install; cd ..
cd client; npm install; cd ..
```

Run both processes (two terminals):

```powershell
cd server; npm run dev     # http://localhost:3978
cd client; npm run dev     # http://localhost:5173
```

Teams requires HTTPS, so the tunnel is not optional. Point it at the client port and
add the tunnel origin to `ALLOWED_ORIGINS` in `.env`.

Expose the client over HTTPS with your tunnel, put that host name into
`appPackage/manifest.json` (replace every `{{HOSTNAME}}`), zip the `appPackage`
folder, and upload it in Teams via **Apps → Manage your apps → Upload a custom app**.
Then in a meeting: **+ Add an app → Co-Presenter**.

## How transcription works

Teams does not expose a real-time client-side transcript to third-party apps, so the
app taps audio itself. There are three capture modes, picked in the panel:

| Mode | Captures | Labelled as |
| --- | --- | --- |
| **Meeting audio** (default) | System audio — everyone you can hear | `customer` |
| **Meeting + my mic** | System audio *and* your microphone, as two streams | `customer` / `me` |
| **My mic only** | Your microphone | `me` |

System audio is captured with `getDisplayMedia`, which is a **tap on the playback
stream**: the audio still reaches your headset at full volume, and nothing is muted,
rerouted or held exclusively. The browser asks you to share a screen — choose
**Entire Screen** and tick **Also share system audio**, since browsers only expose
system audio alongside a screen share. The video is ignored.

Because each speaker arrives on its own stream, attribution needs no guesswork: your
own words are never treated as customer questions.

Two things to know:

- **Wear headphones.** On speakers, your mic re-hears the customer and you get
  duplicate lines in "Meeting + my mic" mode.
- Chromium only. Firefox and Safari do not offer system audio via `getDisplayMedia`.

Everything the panel shows is private — meeting side panel content is never shared
with other participants.

## Using it without installing anything into Teams

Sideloading is often blocked by tenant policy, and the app does not actually need
Teams to work. Open `http://localhost:5173` in a normal Chrome/Edge window beside
the Teams meeting, choose **Meeting audio**, and press **Start listening**.

You lose nothing except the side-panel placement: the same detection, grounding and
streaming run, and the Teams SDK falls back to a local meeting id automatically. No
tunnel, no manifest, no admin approval. Use the Teams package only when you want the
panel docked inside the meeting window.

## Where answers come from

Every card states its source, in this order of preference:

| Badge | Meaning |
| --- | --- |
| `Your notes` | Grounded in `server/knowledge/`. Highest trust. |
| `Microsoft Learn` | Your notes had nothing, so it fell back to official Microsoft Learn documentation, with deep links you can click mid-call. |
| `General knowledge — verify specifics` | Neither had anything. The model answers from general knowledge, and is instructed to stay high level and avoid numbers, limits or pricing it cannot support. |

The Learn fallback uses the public `learn.microsoft.com/api/mcp` endpoint — no auth,
no key, and bounded by a 5 s timeout so it can never stall a live call.

## Speed

Answers stream in, so the first words appear long before the answer is finished.
Measured on this machine, per question:

| | first word | complete |
| --- | --- | --- |
| Grounded in your notes | ~1.5–2.2 s | ~2.0–2.9 s |
| Falling back to Learn | ~2.5–3.5 s | ~3.5 s |

Three things make that possible, and they matter if you change the code:

- **Cache the Entra token.** `DefaultAzureCredential` falls through to the Azure CLI
  and spawns `az account get-access-token` on *every* request — about 2.5 s each.
  `getBearerTokenProvider` in `openaiClient.ts` caches it. This alone took the
  pipeline from 11 s to 2 s.
- **Retrieval runs in parallel with detection**, started on the raw utterance, so its
  network time hides behind the detection call instead of adding to it.
- **Two model sizes.** A nano model classifies; a mini model writes. Detection is on
  the hot path for every candidate utterance, so it must be cheap.

## Privacy & compliance

- Announce recording/transcription per your local law and your company policy.
- Transcript text is held in memory only (`TranscriptBuffer`, last N utterances) and
  is never written to disk by this app.
