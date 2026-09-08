# App package

Before zipping:

1. Replace every `{{HOSTNAME}}` in `manifest.json` with your tunnel/prod host
   (no scheme, e.g. `abc123-5173.euw.devtunnels.ms`).
2. Replace `id` with a fresh GUID (`New-Guid` in PowerShell).
3. Add two PNG icons next to the manifest:
   - `color.png` — 192x192, full colour
   - `outline.png` — 32x32, white on transparent
4. Zip the **contents** of this folder (not the folder itself):

```powershell
Compress-Archive -Path .\manifest.json,.\color.png,.\outline.png -DestinationPath .\build\copresenter.zip -Force
```

5. Teams → **Apps → Manage your apps → Upload a custom app** → pick the zip.
6. In a meeting: **+ Add an app → Co-Presenter → Save**, then open it from the
   meeting toolbar to get the side panel.
