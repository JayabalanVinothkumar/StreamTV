# Stream TV

Full-screen JioHotstar shell for Chromecast with Google TV. It opens only
jiohotstar.com and adds TV remote navigation on top of the real website.

## Remote

| Where | Key | Action |
|---|---|---|
| Browsing | Arrows | Move the white focus ring |
| Browsing | OK | Open the highlighted item |
| Browsing | Back | Close a pop-up / go back a page (press twice on home to exit) |
| Search box | Left/Right, OK | Move the cursor, search; Up/Down leaves the box |
| Video | OK | Play / pause |
| Video | Left / Right | -10 s / +10 s (hold for 30 s jumps) |
| Video | Up / Down | Reach the player buttons (audio, quality, episodes); Back returns |

## Build (GitHub Actions)

1. Create a new **private** GitHub repo (e.g. `streamtv`) and upload all files in this folder, including `.github`.
2. Open the **Actions** tab, then the latest **Build APK** run, and download **StreamTV-apk** under Artifacts.
3. Unzip it and sideload `app-release.apk` to the Chromecast the same way you installed your IPTV app.

The app is signed with a fixed key (`app/release.keystore`), so new builds install over the old one and you stay logged in.

## Notes

- Quality: the app reports a fast connection and the full 1080p screen size, so the player starts and stays at its top quality. DRM can still cap some titles below what the official app plays.
- Change the start page or allowed sites in `MainActivity.java` (`START_URL`, `ALLOWED_HOSTS`).
- Change the app name in `app/src/main/res/values/strings.xml`.
