# Buddy Walk Mobile

Expo / React Native companion app for [Buddy Walk](https://github.com/tort8678/contextual_vlm). Helps blind and low-vision users capture photos or videos, ask location-aware questions, and receive spoken AI responses — all from a native mobile experience on iOS and Android.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18+ | LTS recommended |
| **npm** | 9+ | Ships with Node |
| **Expo CLI** | — | Installed automatically via `npx expo` |
| **Expo Go** | Latest | Install on your phone from the App Store / Google Play |

> The **Buddy Walk backend** (Express + MongoDB) must be running for the app to function. See the [main repo](https://github.com/tort8678/contextual_vlm) for backend setup instructions.

---

## Quick Start

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd buddy-walk-mobile
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

Open `.env` and point the app at your backend:

```
EXPO_PUBLIC_API_URL=http://<YOUR_LOCAL_IP>:8000
```

> Use your machine's **local network IP** (e.g. `192.168.x.x`), not `localhost`, so the phone can reach the backend over Wi-Fi. Find it with `ipconfig` (Windows) or `ifconfig` (macOS/Linux).

Start the Expo dev server:

```bash
npx expo start
```

Scan the QR code in your terminal with **Expo Go** (Android) or the **Camera app** (iOS).

---

## Project Structure

```
mobile/
├── App.tsx                     Root component, wraps Navigation in PaperProvider
├── src/
│   ├── navigation/             React Navigation stack (Welcome → Permissions → Waiver → Name → Main)
│   ├── screens/
│   │   ├── WelcomeScreen       Landing / intro
│   │   ├── WaiverScreen        Terms agreement
│   │   ├── PermissionsScreen   Camera, mic, location grants
│   │   ├── NameScreen          User name entry (voice or typed)
│   │   └── MainScreen          Core experience — camera, voice input, AI Q&A
│   ├── api/                    Axios client, OpenAI / chat-log / token endpoints
│   ├── components/             Shared components (Access-A-Ride button, etc.)
│   └── types/                  TypeScript interfaces
├── .env.example                Environment variable template
├── package.json
└── tsconfig.json
```

---

## Key Features

- **Tap for photo / hold for video** — the camera button adapts with spoken feedback ("Photo captured.", "Video recording.", "Video recording ended.")
- **Voice input** — Azure Speech-to-Text via REST; tap the mic button or **shake the phone** to start listening
- **Shake to repeat** — if ambient noise drowns out your voice and STT returns nothing, the app vibrates and prompts you to try again; shake the device to instantly re-open the mic without finding the button
- **Offline awareness** — `expo-network` monitors connectivity and speaks "No internet connection." the moment Wi-Fi or data drops; the submit handler catches network errors as a fallback
- **Spoken AI responses** — every response is read aloud via `expo-speech` and announced to screen readers
- **Accessibility-first** — all interactive elements carry `accessibilityLabel`, `accessibilityRole`, and `accessibilityHint`; `AccessibilityInfo.announceForAccessibility` is used throughout
- **Access-A-Ride quick-dial** — one-tap call button always visible

---

## Running on a Physical Device

1. Make sure your phone and dev machine are on the **same Wi-Fi network**.
2. Start the backend: run `npm run dev` in the main Buddy Walk repo root.
3. Start Expo: run `npx expo start` in this directory.
4. Scan the QR code with Expo Go.

> Camera and sensors require a **physical device**. The emulator will not provide real camera or accelerometer data.

---

## Building for Production

Generate native projects and build locally:

```bash
npx expo prebuild
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

Or use [EAS Build](https://docs.expo.dev/build/introduction/) for cloud builds:

```bash
npx eas build --platform all
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | Base URL of the Express backend | `http://localhost:8000` |

---

## Tech Stack

| Package | Purpose |
|---------|---------|
| **Expo SDK 54** / React Native 0.81 | Core framework |
| **React Navigation** | Native stack navigation |
| **React Native Paper** | Material Design components |
| **expo-camera** | Photo and video capture |
| **expo-av** | Audio recording for Azure STT |
| **expo-speech** | Text-to-speech |
| **expo-sensors** | Magnetometer (compass) and accelerometer (shake detection) |
| **expo-location** | GPS tracking |
| **expo-network** | Connectivity monitoring |
| **axios** | HTTP client |
| **Azure Cognitive Services** | Speech-to-Text (token fetched from backend) |
