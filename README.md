# VJ Hotstar (Stream TV)

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
| Video | Left / Right | Seek with a preview on the bottom bar (tap = 10 s, hold to speed up); OK jumps now, Back cancels |
| Video | Down | VJ menu: video quality, audio language, TV 4K check |
| Video | Up | The player's own buttons (subtitles, episodes); Back returns |
| Anywhere | Hold OK | VJ menu (same as Down while watching) |
| Series page | ⏭ Last episode | Opens the latest season and loads the full list, then jumps to the last episode |

## Build (GitHub Actions)

1. Create a new **private** GitHub repo (e.g. `streamtv`) and upload all files in this folder, including `.github`.
2. Open the **Actions** tab, then the latest **Build APK** run, and download **StreamTV-apk** under Artifacts.
3. Unzip it and sideload `app-release.apk` to the Chromecast the same way you installed your IPTV app.

The app is signed with a fixed key (`app/release.keystore`), so new builds install over the old one and you stay logged in.

## Notes

- Quality: playback is set to the best the Chromecast plays smoothly in the app: 1080p H.264. The player starts high and adapts to your connection (and VPN) speed. 4K, HEVC, AV1 and Dolby Vision are switched off because the TV web engine cannot decode them in time.
- Change the start page or allowed sites in `MainActivity.java` (`START_URL`, `ALLOWED_HOSTS`).
- Change the app name in `app/src/main/res/values/strings.xml`.
