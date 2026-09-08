# Co-Presenter — your private AI co-presenter

Co-Presenter listens to a customer call, spots the questions being asked, and suggests
short, grounded answers in a side panel that **only you** can see. It runs in a browser
window next to Teams — no install, no admin approval.

```
Customer:  "Why should we use Terraform instead of clicking through the Azure Portal?"

Co-Presenter (private to you):
  Question   Why Terraform instead of the Azure Portal?
  Topic      comparison · Azure Infrastructure as Code
  Answer     Using Terraform means your infrastructure is stored as code, so changes
             are reviewable and repeatable. It also lets you preview exactly what
             will change before you apply it.
  Talking points
   • Terraform detects configuration drift automatically
   • One consistent workflow across Azure and other clouds
  Source     Your notes · iac-terraform.md
```

Answers start appearing about a second and a half after the question, and stream in
word by word so you can start speaking before they finish.

## How it works

1. It listens to your meeting audio — a copy of what you already hear.
2. Azure Speech turns that audio into text.
3. A small, fast model decides whether the customer actually asked a question.
4. It looks for the answer in your own notes first, then in official Microsoft Learn docs.
5. The answer streams into the panel, phrased so you can say it out loud.

## What you need

- Node.js 20 or newer
- An **Azure OpenAI** resource with three deployments: a small model for detection
  (`gpt-4.1-nano`), a normal one for answers (`gpt-4.1-mini`), and an embedding model
  (`text-embedding-3-small`)
- An **Azure AI Speech** resource
- **Chrome or Edge** — system audio capture is Chromium only

## Setup (once)

```powershell
copy .env.example .env     # then fill in the values
cd server; npm install; cd ..
cd client; npm install; cd ..
az login                   # the app signs in with Entra ID, no API keys needed
```

## Run it

Two terminals:

```powershell
cd server; npm run dev     # http://localhost:3978
```

```powershell
cd client; npm run dev     # http://localhost:5173
```

## Use it in a meeting

1. Open **http://localhost:5173** in Chrome or Edge, next to your Teams window.
   Not the VS Code Simple Browser — it cannot capture audio.
2. Leave **Meeting audio** selected and press **Start listening**.
3. In the picker choose **Entire Screen**, tick **Also share system audio**, then Share.
4. Answers appear as the customer talks. Press **Stop** when the call ends.

Your meeting audio keeps playing normally. The app taps the sound, it does not take it.
Nobody else sees the panel.

## Capture modes

| Mode | Hears | Use when |
| --- | --- | --- |
| **Meeting audio** (default) | Everyone you can hear | Normal calls — this is what you want |
| **Meeting + my mic** | Them and you, as two streams | You want your own words in the transcript |
| **My mic only** | You | No screen share allowed |

Browsers only expose system audio alongside a screen share, which is why it asks for a
screen. The video is ignored. Because each speaker arrives on a separate stream, your
own words are never mistaken for customer questions.

**Wear headphones** in "Meeting + my mic" mode, or your mic re-hears the customer and
you get duplicate lines.

## Where answers come from

Every card says where its facts came from:

| Badge | Meaning |
| --- | --- |
| `Your notes` | Found in `server/knowledge/`. Most trustworthy. |
| `Microsoft Learn` | Your notes had nothing, so it used official Microsoft docs, with links you can open mid-call. |
| `General knowledge — verify specifics` | Neither had anything. The model stays high level and avoids numbers or limits it cannot back up. |

## Add your own notes

Drop markdown files into `server/knowledge/`. Use `##` headings phrased the way a
customer would ask, and keep each section short:

```markdown
## What does the Standard tier include
...

## How licensing works for external users
...
```

Restart the backend afterwards — notes are indexed at startup. Look for
`[knowledge] indexed N chunks` in the log to confirm they loaded.

## Troubleshooting

| Problem | Cause |
| --- | --- |
| `Not supported` when you press Start | Wrong browser. Use real Chrome or Edge, not VS Code's Simple Browser. |
| `No system audio was shared` | You picked a window or tab. Only **Entire Screen** offers the system audio checkbox. |
| 401s, or `no token` errors | Your Azure login expired. Run `az login`. |
| Answers ignore your notes | Backend was not restarted after editing `server/knowledge/`. |

## Cost

Nothing is charged while it sits idle — the model deployments bill per token used.
The meter that matters is **Azure Speech**, which bills per hour of audio while a
listening session is open, including silence. Press **Stop** when the call ends.
"Meeting + my mic" costs double, since it runs two streams.

## Installing into Teams (optional)

You do not need this. The app works fine in a browser window beside Teams, and
sideloading is often blocked by tenant policy anyway.

If you do want the panel docked inside the meeting window: expose the client over
HTTPS with a tunnel (`devtunnel host -p 5173 --allow-anonymous`), put that host name
into `appPackage/manifest.json` in place of every `{{HOSTNAME}}`, add the tunnel
origin to `ALLOWED_ORIGINS` in `.env`, zip the `appPackage` folder, then in Teams go
to **Apps → Manage your apps → Upload a custom app**, and in a meeting choose
**+ Add an app → Co-Presenter**.

## Project layout

| Path | What it is |
| --- | --- |
| `client/` | React panel: audio capture, speech-to-text, the UI |
| `server/` | Express API: question detection, retrieval, answer generation |
| `server/knowledge/` | **Your** notes — the grounding content |
| `appPackage/` | Teams manifest, only needed for the optional Teams install |

## Privacy

- Tell people you are transcribing, per your local law and company policy.
- Transcript text is kept in memory only and never written to disk.
- Only you can see the panel.

---

Built by **Mohammad Arshad** ([@Arshad-ashuu](https://github.com/Arshad-ashuu)).
