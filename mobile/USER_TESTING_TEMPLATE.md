# Buddy Walk — User Testing Session Template

Use this script for every session so results are comparable across testers.  
**Do not skip steps.** Check each box as you go and fill in the Result column.

**Run each test category 5 times.** Use a **different storefront, landmark, destination, line, or saved place** on each run when you can. Log **every run** in that category’s results table — not just your best attempt.

---

## Session info (fill in before you start)

| Field | Your answer |
|---|---|
| **Tester name** | |
| **Date** | |
| **Device** | e.g. iPhone 14 / Android / laptop + browser |
| **Platform** | ☐ Web (`https://buddy-walk-mobile.vercel.app`) ☐ TestFlight / native app |
| **Screen reader** | ☐ VoiceOver ☐ TalkBack ☐ Off |
| **Location** | e.g. Manhattan — street name or intersection |
| **Session lead / note-taker** | |

**Web beta:** https://buddy-walk-mobile.vercel.app  
**Feedback:** raymondsekyere99@gmail.com, dylansch7@gmail.com

---

## Pre-session checklist (all testers)

Complete before Test 1.

| # | Step | Done |
|---|---|:---:|
| P1 | Open Buddy Walk and finish the **permissions screen** (location, camera, microphone — all three). | ☐ |
| P2 | Confirm you land on the **main screen** (camera preview or black area, Ask field, Submit). | ☐ |
| P3 | Use **headphones** or turn volume up — answers are spoken aloud. | ☐ |
| P4 | If testing **on a phone**, use **Safari (iOS)** or **Chrome (Android)** for the web beta. | ☐ |
| P5 | If you hear *"Your location looks approximate"*, note it in Session notes — results may be off on desktop Wi‑Fi. | ☐ |

**Session notes (pre-session):**

```
```

---

## Test 1 — Camera + voice/text Q&A

**Objective:** Confirm capture works and the AI gives a **accurate, spoken** answer you can understand.

### 1A — Photo of a storefront

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Stand **outside** a **storefront with a visible sign** (deli, café, bank, pharmacy, etc.). Face the **entrance or sign** — not the sky or sidewalk only. | ☐ |
| 2 | On the main screen, **tap quickly once** on the camera area (do not hold). | ☐ |
| 3 | Wait for the spoken confirmation: *"Photo captured. Ready to describe the image."* | ☐ |
| 4 | Type or speak this **exact question:** **"What business or building is this?"** | ☐ |
| 5 | Tap **Submit**. Wait for the full spoken answer. | ☐ |

**Pass if (check all that apply):**

| Criterion | Pass |
|---|---|
| Photo captured without an error message | ☐ |
| Answer describes the **storefront/sign** plausibly (not random California or unrelated place) | ☐ |
| Answer is spoken **once**, clearly, at a listenable volume | ☐ |
| You could understand the answer **without reading the screen** | ☐ |

**Results — run 5 times (different storefronts):**

| Run | Storefront / location tried | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|
| 1 | | ☐ | ☐ | ☐ | |
| 2 | | ☐ | ☐ | ☐ | |
| 3 | | ☐ | ☐ | ☐ | |
| 4 | | ☐ | ☐ | ☐ | |
| 5 | | ☐ | ☐ | ☐ | |
---

### 1B — Video of a monument or landmark (optional second capture)

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Point the camera at a **fixed landmark**: statue, monument plaque, notable building façade, or subway entrance sign. | ☐ |
| 2 | **Press and hold** the camera area for **3–5 seconds**, then release. | ☐ |
| 3 | Wait for: *"Video recording ended. Ready to describe the video."* (Web: frames sampled during hold.) | ☐ |
| 4 | Ask: **"Describe what you see in front of me."** | ☐ |
| 5 | Tap **Submit**. | ☐ |

**Pass if:**

| Criterion | Pass |
|---|---|
| Video/hold capture completes without *"Could not capture"* | ☐ |
| Answer mentions **visible features** of the landmark (not generic filler) | ☐ |
| Spoken answer is clear and not cut off mid-sentence | ☐ |

**Results — run 5 times (different landmarks):**

| Run | Landmark tried | Pass | Fail | Partial | Skipped | Notes |
|:---:|:---|:---|:---|:---|:---|:---|
| 1 | | ☐ | ☐ | ☐ | ☐ | |
| 2 | | ☐ | ☐ | ☐ | ☐ | |
| 3 | | ☐ | ☐ | ☐ | ☐ | |
| 4 | | ☐ | ☐ | ☐ | ☐ | |
| 5 | | ☐ | ☐ | ☐ | ☐ | |
---

### 1C — Voice question (Tap to Ask)

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Tap **Tap to Ask** (or shake phone on **native app only**). | ☐ |
| 2 | Say clearly: **"What street am I on?"** | ☐ |
| 3 | Wait for *"I heard: … Press submit when ready"* (or text appears in the field). | ☐ |
| 4 | Tap **Submit**. | ☐ |

**Pass if:** question transcribed correctly **and** answer addresses the street/location.

**Results — run 5 times (vary the question if you like):**

| Run | Question spoken | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|
| 1 | *"What street am I on?"* | ☐ | ☐ | ☐ | |
| 2 | *"What intersection am I at?"* | ☐ | ☐ | ☐ | |
| 3 | *"What's near me?"* | ☐ | ☐ | ☐ | |
| 4 | *"What businesses are around me?"* | ☐ | ☐ | ☐ | |
| 5 | *"Am I facing north or south?"* | ☐ | ☐ | ☐ | |
---

## Test 2 — Hands-off navigation

**Objective:** Directions **start automatically**; steps advance **without tapping Next**; arrival is announced.

> **Native app (TestFlight):** vibrations + shake-to-stop.  
> **Web:** spoken directions only — **no vibration**; use **Stop Navigation** on screen.

### Setup

Pick **5 different destinations** (~5–10 min walk each). Write them before you start:

| Run | Destination |
|:---:|---|
| 1 | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |
### Navigation script (repeat for each run)

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Ask **exactly:** **"How do I get to [your destination]?"** (use the name you wrote above). | ☐ |
| 2 | **Do not tap** "Start Navigation" — navigation should **begin on its own** after the answer. | ☐ |
| 3 | Listen for opening cue: *"Starting navigation…"* plus the **first step** instruction. | ☐ |
| 4 | **Walk** toward the destination for at least **2 minutes** (or until arrival). | ☐ |
| 5 | Confirm you hear **new step instructions** without pressing anything (GPS or timer). | ☐ |
| 6 | Near the destination, listen for **"You have arrived at your destination"** (or *"close to your destination"* on approximate routes). | ☐ |
| 7 | **Stop navigation:** **Native** — shake phone once firmly; **Web** — tap **Stop Navigation**. | ☐ |
| 8 | Confirm stop feedback: buzz + *"Navigation stopped"* (native) or banner clears (web). | ☐ |

**Pass if (native):**

| Criterion | Pass |
|---|---|
| Navigation started **without** pressing a start button | ☐ |
| Felt **distinct vibrations** at turns (not every button tap) | ☐ |
| Steps advanced **while walking** without manual Next | ☐ |
| Arrival announced near the destination | ☐ |
| Shake stopped navigation reliably | ☐ |

**Pass if (web only):**

| Criterion | Pass |
|---|---|
| Navigation started automatically | ☐ |
| **Spoken** step instructions while walking | ☐ |
| Steps advanced without tapping Next | ☐ |
| Stop button worked | ☐ |
| *(Expected)* No vibration — note if tester expected haptics | ☐ |

**Results — 5 navigation runs:**

| Run | Destination | Pass | Fail | Partial | Notes (wrong turns, off-route, etc.) |
|:---:|:---|:---|:---|:---|:---|
| 1 | | ☐ | ☐ | ☐ | |
| 2 | | ☐ | ☐ | ☐ | |
| 3 | | ☐ | ☐ | ☐ | |
| 4 | | ☐ | ☐ | ☐ | |
| 5 | | ☐ | ☐ | ☐ | |
---

## Test 3 — VoiceOver / accessibility

**Objective:** Complete Tests **1A** and **2** with the screen reader **on**, without relying on sight.

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Enable **VoiceOver** (iOS) or **TalkBack** (Android). | ☐ |
| 2 | Repeat **Test 1A** (storefront photo + *"What business or building is this?"*). | ☐ |
| 3 | Repeat **Test 2** navigation script (short walk or first 2 steps if time-limited). | ☐ |

**Pass if:**

| Criterion | Pass |
|---|---|
| All buttons (Submit, Tap to Ask, Stop Navigation) are **reachable and labeled** | ☐ |
| You did **not** hear the **same text twice** (app voice + screen reader overlapping) | ☐ |
| Navigation status / arrival announced **clearly** | ☐ |
| You could complete the flow **without seeing the screen** | ☐ |

**Results — run 5 times with VoiceOver / TalkBack on:**

| Run | Flow repeated | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|
| 1 | Test 1A (storefront photo) | ☐ | ☐ | ☐ | |
| 2 | Test 2 (navigation, ≥2 min or 2 steps) | ☐ | ☐ | ☐ | |
| 3 | Submit + Tap to Ask labels only | ☐ | ☐ | ☐ | |
| 4 | Test 1B (landmark video) | ☐ | ☐ | ☐ | |
| 5 | Companion Mode controls | ☐ | ☐ | ☐ | |
---

## Test 4 — Companion Mode

**Objective:** Generate a **live location share link** a contact can open.

| Step | Instruction | Done |
|---|---|:---:|
| 1 | From the main screen, open **Companion Mode**. | ☐ |
| 2 | Start or create a session (follow on-screen prompts). | ☐ |
| 3 | Copy or share the **link** to a second device or a friend on another phone. | ☐ |
| 4 | Open the link in a **mobile browser** (not the Buddy Walk app). | ☐ |
| 5 | Walk **one block** (~1 minute). Ask your contact: did the map/dot **update**? | ☐ |

**Pass if:**

| Criterion | Pass |
|---|---|
| Link generated without error | ☐ |
| Link opens in a browser | ☐ |
| Location updates while walking (within ~30 s) | ☐ |

**Results — run 5 times (new session or re-open link each run if needed):**

| Run | Contact / second device | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|
| 1 | | ☐ | ☐ | ☐ | |
| 2 | | ☐ | ☐ | ☐ | |
| 3 | | ☐ | ☐ | ☐ | |
| 4 | | ☐ | ☐ | ☐ | |
| 5 | | ☐ | ☐ | ☐ | |
---

## Test 5 — Saved Places

**Objective:** Save an alias and use it in a directions question.

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Open **Saved Places**. | ☐ |
| 2 | Save your **current location** with alias: **`test-home`** (or **`home`** if unused). | ☐ |
| 3 | Return to the **main screen**. | ☐ |
| 4 | Ask: **"How do I get to test-home?"** (or **"How do I get home?"** if you used `home`). | ☐ |
| 5 | Confirm the app **recognizes the saved place** and returns **walking directions**. | ☐ |

**Pass if:**

| Criterion | Pass |
|---|---|
| Place saved successfully | ☐ |
| App resolves the alias in the question | ☐ |
| Directions returned (and auto-navigation starts on native) | ☐ |

**Results — run 5 times (different aliases or questions):**

| Run | Alias saved | Question asked | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|:---|
| 1 | e.g. `test-home` | *"How do I get to test-home?"* | ☐ | ☐ | ☐ | |
| 2 | e.g. `work` | *"How do I get to work?"* | ☐ | ☐ | ☐ | |
| 3 | e.g. `home` | *"How do I get home?"* | ☐ | ☐ | ☐ | |
| 4 |  |  | ☐ | ☐ | ☐ | |
| 5 |  |  | ☐ | ☐ | ☐ | |
---

## Test 6 — MTA subway arrival (real-time)

**Objective:** Buddy Walk pulls **live MTA arrival times** for the nearest station on the line you ask about. Answer should name a **nearby station** and give **arrival time(s)**.

> **NYC only.** You must be in the subway service area with **location enabled**. Stand **near a station entrance** (within ~2 blocks) for best results.

### Setup

| Step | Instruction | Done |
|---|---|:---:|
| 1 | Note the **subway line** at your nearest station (sign on entrance: e.g. **R**, **6**, **A**, **1**, **7**). | ☐ |
| 2 | Write the line here: **______** &nbsp; Station name (if known): **________________** | ☐ |

### MTA arrival script

| Step | Instruction | Done |
|---|---|:---:|
| 1 | On the main screen, type or say (replace `[LINE]` with your line, e.g. **R**): | ☐ |
|   | **"When is the next [LINE] train arriving?"** | |
| 2 | Tap **Submit**. Wait for the spoken answer (may take a few extra seconds — live MTA feed). | ☐ |
| 3 | Listen for: **station name** near you, **direction** (e.g. Uptown/Downtown), and **time(s)**. | ☐ |
| 4 | *(Optional)* Ask a second line you did **not** use above: **"When is the next 4 train arriving?"** — only if the 4 serves your area. | ☐ |

**Example questions (pick one that matches your location):**

- *"When is the next R train arriving?"* (Broadway line — Manhattan/Brooklyn)
- *"When is the next 6 train arriving?"* (Lexington Ave — East Side)
- *"When is the next A train arriving?"* (8th Ave — west side / Brooklyn)
- *"When is the next 7 train arriving?"* (Flushing line — Queens/Midtown)

**Pass if:**

| Criterion | Pass |
|---|---|
| Answer references a **plausible nearby station** (not a random borough you aren't in) | ☐ |
| Gives **at least one arrival time** or says no trains scheduled (both are valid live data) | ☐ |
| Spoken clearly; you understand it **without reading the screen** | ☐ |
| Does **not** give walking turn-by-turn instead of train times (wrong tool triggered) | ☐ |

**Fail if:** generic error, wrong city, "train doesn't exist" for a valid NYC line, or location warning then nonsense answer.

**Results — run 5 times (different lines or stations when possible):**

| Run | Line asked | Station named in answer | Pass | Fail | Partial | Notes |
|:---:|:---|:---|:---|:---|:---|:---|
| 1 | | | ☐ | ☐ | ☐ | |
| 2 | | | ☐ | ☐ | ☐ | |
| 3 | | | ☐ | ☐ | ☐ | |
| 4 | | | ☐ | ☐ | ☐ | |
| 5 | | | ☐ | ☐ | ☐ | |
---

## End-of-session summary

| Test | Runs logged | Pass | Fail | Partial | Overall (best of runs) |
|---|---|:---:|:---:|:---:|---|
| 1A Photo + Q&A | /5 | | | | |
| 1B Video + Q&A | /5 | | | | |
| 1C Voice input | /5 | | | | |
| 2 Navigation | /5 | | | | |
| 3 VoiceOver | /5 | | | | |
| 4 Companion | /5 | | | | |
| 5 Saved Places | /5 | | | | |
| 6 MTA arrival | /5 | | | | |

### Top 3 issues (required)

1.  
2.  
3.  

### What worked best?

```
```

### What would block daily use?

```
```

### Would you recommend this to another blind/low-vision traveler?

☐ Yes ☐ Maybe ☐ No — because: _______________________________

---

*Template version: June 2026 · Buddy Walk · Web: https://buddy-walk-mobile.vercel.app*
