# VerityCue

> Grounded answers, right on cue.

VerityCue is a private AI meeting companion. It listens for customer questions, retrieves relevant facts, and streams concise, speakable answers
into a panel that **only you** can see. Run it beside Microsoft Teams in Chrome or Edge,
or install it as an optional Teams meeting app.

![alt text](<Screenshot 2026-10-01 104029.png>)

## Highlights

- **Live question detection** filters normal conversation and responds when a customer
  asks something actionable.
- **Grounded answers** search your own notes first, then official Microsoft Learn content.
- **Fast streaming** lets you begin answering before the full suggestion is complete.
- **Private guidance** keeps answer cards, talking points, sources, and transcripts visible
  only to you.
- **Flexible capture** supports meeting audio, your microphone, or both as separate streams.
- **Silence-aware listening** detects speech on your device and streams it immediately,
  without uploading long stretches of silence.
- **Azure-native AI** uses Azure OpenAI and Azure AI Speech with Microsoft Entra ID
  authentication; no resource keys are needed.

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
- An Entra ID account with access to invoke both Azure resources
- **Chrome or Edge** — system audio capture is Chromium only

> Cloning or sharing this repository is not enough by itself. Each user also needs
> access to the Azure resources above and a configured root `.env` file. The models
> run in Azure; nothing needs to be downloaded or hosted locally.

## Provision Azure automatically

Run the bootstrap script from the repository root. No subscription ID, endpoint,
resource name, or API key needs to be copied into the script first:

```powershell
.\scripts\provision-azure.ps1
```

From Command Prompt, use:

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\provision-azure.ps1
```

The script:

1. Checks for `az`. If missing, installs Azure CLI with WinGet, or the official
   Microsoft MSI when WinGet is unavailable, and refreshes the current process PATH.
   Installation may require administrator approval.
2. Runs `az login`, then reads `az account show` for the selected subscription and
   tenant. You choose the account/subscription during sign-in; `-SubscriptionId`
   can explicitly override it.
3. Checks the subscription's supported service regions, model catalog, deployment
   SKUs, and remaining quota **before creating resource groups or accounts**.
4. Creates or reuses a resource group, an Azure OpenAI account, an Azure AI Speech
   account, and the three model deployments this app needs. It does **not** create
   an unused Foundry project, hub, or hosted agent.
5. Assigns the signed-in user `Cognitive Services OpenAI User` and
   `Cognitive Services Speech User` access. Authentication is **Entra ID only**;
   it never requests resource keys. New accounts have local/key authentication
   disabled; existing accounts' authentication policy is left unchanged.
6. Prints the exact `.env` assignments in the terminal, including the actual
   endpoint, deployment names, Speech region/resource ID, and **empty key fields**.
   It also creates `.env`, or writes `.env.generated` without overwriting an
   existing `.env`. Merge the printed Azure settings into an existing file,
   clearing any old values of `AZURE_OPENAI_API_KEY` and `AZURE_SPEECH_KEY`.

You need an enabled Azure subscription and permission to create resources, deploy
models, and assign roles (for example, Owner or appropriate resource-creation
permissions plus User Access Administrator). Role assignments can take several
minutes to propagate. Azure usage is billable.

There is **no hardcoded Azure region**. Existing OpenAI account location is reused;
otherwise, the script prefers the resource group's region when suitable and checks
discovered regions until it finds supported models and sufficient quota. Azure
accounts do not have a universal "home region" in `az account show`. Pin locations
when latency or data residency matters:

```powershell
.\scripts\provision-azure.ps1 `
  -Location 'eastus2' `
  -ResourceGroup 'rg-my-veritycue'
```

Use `-SpeechLocation` if Speech needs a separate region. An explicitly supplied
region is not silently changed. Existing resources are reused only when their
kinds/models match; ambiguous accounts or conflicting deployments stop with an
error instead of being replaced.

The default models remain `gpt-4.1-mini`, `gpt-4.1-nano`, and
`text-embedding-3-small`, matching the application requirements. Override them with
`-ChatModel`, `-DetectModel`, and `-EmbeddingModel`; use `-ChatDeploymentName`,
`-DetectDeploymentName`, and `-EmbeddingDeploymentName` for custom deployment names.
Versions and supported SKUs are discovered per model, so embeddings are not forced
onto a chat-only SKU. `-DeploymentSku` pins the chat/detection SKU;
`-EmbeddingDeploymentSku` pins the embedding SKU. Without overrides, supported
`GlobalStandard`, `Standard`, then `DataZoneStandard` SKUs are considered.
Global deployments can process data outside the account's region.

Capacity defaults to each SKU's minimum valid unit to limit initial quota needs.
Use `-ChatCapacity`, `-DetectCapacity`, and `-EmbeddingCapacity` to request more;
capacity units vary by model and do not represent a fixed tokens-per-minute rate.
Existing deployments are not silently resized. Regional service capacity can still
change after the quota check; Azure errors are shown rather than hidden.

Use `-TenantId` to select another directory or `-UseDeviceCode` when browser login
is unavailable. The older `-Authentication EntraId` argument remains supported,
but key-based provisioning is not.

To test the script without installing software or accessing Azure, run the Pester
suite with Pester 6 or newer in PowerShell 7:

```powershell
Invoke-Pester .\scripts\tests\provision-azure.Tests.ps1
```

## First-time setup

1. Run the provisioning script above, manually provision the Azure OpenAI and Azure AI
  Speech resources, or ask the resource owner to grant you access. The names in
  `.env` must be the **deployment names** in Azure, which may differ from the
  underlying model names.
2. Use the root `.env` created by the script, or merge its printed Azure settings
   into the existing file. For manual provisioning, create `.env` with the Azure
   endpoint, three deployment names, API version, Speech region, and full Speech
   resource ID. Leave `AZURE_OPENAI_API_KEY` and `AZURE_SPEECH_KEY` empty so the
   backend uses Entra ID. The account needs `Cognitive Services OpenAI User` on
   OpenAI and `Cognitive Services Speech User` on Speech.

Never commit or share `.env`; it is excluded by `.gitignore` because it may contain
local configuration.

3. Install dependencies from the repository root:

```powershell
cd server
npm install
cd ..\client
npm install
cd ..
```

4. The provisioning script already signs you in. If that login expires, sign in again:

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

### Faster responses and silence handling

Speech detection runs locally for each audio source. Quiet audio and short detection
misfires do not open an Azure Speech recognition stream. Once speech is confirmed,
audio streams immediately rather than waiting for a complete recording.

- A short lead-in buffer (about 200 ms) preserves the beginning of the first word.
- About **600 ms of silence** ends a speech segment. Shorter pauses remain in the
  same segment; longer pauses can split a question into separate transcript lines.
- Only speech segments, their lead-in, and the short ending silence are sent to
  Azure Speech. Blank and punctuation-only recognition results never trigger analysis.
- Local capture stays active between segments, so speaking again does not require
  pressing Start. Meeting audio and microphone speech stay separate.

The 600 ms is the speech-ending target, **not** the total answer time: transcription,
question detection, retrieval, and answer generation still take additional time.
The defaults live in [`client/src/speechAudio.ts`](client/src/speechAudio.ts).

The speech detector's model, worklet, and WebAssembly runtime are served by this app,
not a third-party CDN. `npm run dev` and `npm run build` prepare those assets
automatically. The first listening session loads roughly 16 MB of local assets, which
the browser can cache.

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
**Azure Speech** receives detected speech segments plus short boundary padding, not
the entire idle listening period. Azure's audio billing and any per-request rounding
still apply; silence filtering is not a guarantee of a particular bill reduction.
Press **Stop** when the call ends to release capture. "Meeting + my mic" processes
both sources separately and can incur more usage.

## Validate listening changes

From `client`, run `npm test` for deterministic speech/silence boundary, pre-roll,
misfire, and PCM tests, then `npm run build` for type-checking and the production
bundle. Real meeting response times also depend on Azure and network latency.

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
