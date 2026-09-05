# <img src="public/icons/logo.png" alt="BlinkBreak Icon" width="36" height="36" align="top"> BlinkBreak `v1.1.0` (Stable)

**Developed by KSquare**

**BlinkBreak** is a tested, stable, privacy-first, and intelligent Chrome extension that protects your eye health with guided eye resets (20-20-20 rule) without breaking your workflow.

---

## Key Features

- **Direct & Frictionless Breaks**: Starts 20-second active eye resets automatically with soothing breathing visualizers—no annoying prompt modals.
- **Flexible Snooze Control**: In-break **"Do later"** options (`5 min`, `10 min`, `Wait for next pause`) allow instant postponing without friction.
- **Prohibited on High-Priority Sites**: Zero popups during video calls or meetings on **Zoom, Google Meet, Microsoft Teams, Webex, Discord, Twitch, and presentations**.
- **Adaptive Work-Flow Timing**: Intelligent local engine detects deep flow (rapid coding/typing) and waits for a natural micro-pause before triggering.
- **100% Local & Private**: No account, no cloud servers, no telemetry, and zero tracking of keystrokes or URLs.
- **Calm & Accessible UI**: Dark/light modes, soft optional audio chimes, full keyboard navigation, and reduced motion support.

---

## How to Use

### Option 1: Install from Releases (Easiest)
1. Go to the [Releases page](https://github.com/KeshKunal/BlinkBreak/releases) on GitHub.
2. Download the latest `BlinkBreak-v1.1.0.zip` file (do **not** download the "Source code" zip).
3. Unzip the downloaded file.
4. Open `chrome://extensions` in Chrome, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

### Option 2: Build from Source
If you downloaded the source code directly or want to build it yourself:
1. **Install dependencies and build**:
   ```bash
   npm install
   npm run package
   ```
2. This will generate the `BlinkBreak-v1.1.0.zip` file in the root directory.
3. Unzip the generated zip file.
4. Open `chrome://extensions` in Chrome, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

---

**Enjoy seamless eye care**: BlinkBreak runs quietly in the background, keeping track of your focus and prompting gentle breaks only at the right moment.

---

## License

MIT
