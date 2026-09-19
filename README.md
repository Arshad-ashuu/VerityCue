# VerityCue

> Grounded answers, right on cue.

VerityCue is a private AI meeting companion. It listens for customer questions, retrieves relevant facts, and streams concise, speakable answers
into a panel that **only you** can see. Run it beside Microsoft Teams in Chrome or Edge,
or install it as an optional Teams meeting app.

## Highlights

- **Live question detection** filters normal conversation and responds when a customer
  asks something actionable.
- **Grounded answers** search your own notes first, then official Microsoft Learn content.
- **Fast streaming** lets you begin answering before the full suggestion is complete.
- **Private guidance** keeps answer cards, talking points, sources, and transcripts visible
  only to you.
- **Flexible capture** supports meeting audio, your microphone, or both as separate streams.
- **Azure-native AI** uses Azure OpenAI and Azure AI Speech with API key or Entra ID
  authentication.

## Example

```
Customer:  "Why should we use Terraform instead of clicking through the Azure Portal?"

VerityCue (private to you):
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

Answers typically begin appearing shortly after a question is detected and stream word by
word, so you can start speaking before the response is complete.

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
- Access to invoke both Azure resources, using either API keys or an Entra ID account
- **Chrome or Edge** — system audio capture is Chromium only

> Cloning or sharing this repository is not enough by itself. Each user also needs
> access to the Azure resources above and a configured root `.env` file. The models
> run in Azure; nothing needs to be downloaded or hosted locally.

## Provision Azure automatically

The included PowerShell script can create everything this app needs in Azure:

- a resource group
- an Azure OpenAI resource
- an Azure AI Speech resource
- `gpt-4.1-mini`, `gpt-4.1-nano`, and `text-embedding-3-small` deployments
- a root `.env` file containing the resulting configuration

You need an Azure subscription, Azure CLI, and permission to create resources, model
deployments, and role assignments. Azure usage is billable and model availability and
quota vary by subscription and region.

```powershell
# One-time Azure CLI setup
winget install --exact --id Microsoft.AzureCLI
az login
az account list --output table

# Run from the repository root with your subscription ID
.\scripts\provision-azure.ps1 -SubscriptionId '<subscription-id>'
```

The default region is `swedencentral`, deployment SKU is `GlobalStandard`, and
authentication uses resource keys. Override settings when needed:

```powershell
.\scripts\provision-azure.ps1 `
  -SubscriptionId '<subscription-id>' `
  -Location 'eastus2' `
  -ResourceGroup 'rg-my-veritycue' `
  -Authentication EntraId
```

With `-Authentication EntraId`, the script assigns the signed-in user the
`Cognitive Services OpenAI User` and `Cognitive Services Speech User` roles. The user
running it therefore also needs permission to create role assignments, such as Owner
or User Access Administrator. Role assignments can take several minutes to propagate.

The script validates that each model and the selected SKU are offered in the region.
If Azure reports unavailable capacity or quota, choose another region/SKU or request
quota in Azure. It reuses resources and deployments that already exist. If `.env`
already exists, it preserves that file and writes the new values to `.env.generated`
for review instead.

## First-time setup

1. Run the provisioning script above, manually provision the Azure OpenAI and Azure AI
  Speech resources, or ask the resource owner to grant you access. The names in
  `.env` must be the **deployment names** in Azure, which may differ from the
  underlying model names.
2. Create the local configuration file and fill in the Azure endpoint, deployment
   names, Speech region, and one authentication method:

```powershell
Copy-Item .env.example .env
```

- **API keys:** set `AZURE_OPENAI_API_KEY` and `AZURE_SPEECH_KEY`.
- **Entra ID (keyless):** leave both key fields empty, set
  `AZURE_SPEECH_RESOURCE_ID`, and sign in with `az login`. The account needs the
  `Cognitive Services OpenAI User` role on the Azure OpenAI resource and equivalent
  data-plane access to the Speech resource.

Never commit or share `.env`; it is excluded by `.gitignore` because it may contain
credentials.

3. Install dependencies from the repository root:

```powershell
cd server
npm install
cd ..\client
npm install
cd ..
```

4. When using Entra ID authentication, sign in:

```powershell
az login
```

## Run it each time

From the repository root, use two terminals and leave both running.

Terminal 1 — backend:

```powershell
cd server
npm run dev
```

Terminal 2 — frontend:

```powershell
cd client
npm run dev
```

Then open **http://localhost:5173** in Chrome or Edge. The backend health endpoint is
available at **http://localhost:3978/api/health**.

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
**+ Add an app → VerityCue**.

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

Built by **Mohammad Arshad [MOARSHAD]** ([@Arshad-ashuu](https://github.com/Arshad-ashuu)).
