import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import fs from "fs"; 
import sharp, { OverlayOptions } from "sharp";

dotenv.config({ path: path.resolve(__dirname, "../mobile/.env") });

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function encodeImageToBase64(filePath: string): string {
  const imageBuffer = fs.readFileSync(filePath);
  return `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
}

function createOverlaySvg(heading: number, segmentIndex: number): Buffer {
  const svg = `
    <svg width="640" height="640">
      <rect x="0" y="0" width="10" height="640" fill="#000000" />
      <rect x="20" y="20" width="220" height="45" rx="8" fill="rgba(0, 0, 0, 0.75)" />
      <text x="30" y="50" font-family="Arial" font-size="22" font-weight="bold" fill="#00FFCC">
        SEG ${segmentIndex}: ${heading}°
      </text>
    </svg>
  `;
  return Buffer.from(svg);
}

async function processEightDirectionTiles(lat: number, lng: number): Promise<{ heading: number; base64: string }[]> {
  console.log("🎬 FETCHING 8 INDIVIDUAL DIRECTION TILES...");
  const headings = [0, 45, 90, 135, 180, 225, 270, 315];
  const tilesData = [];
  const rawBuffers: Buffer[] = [];

  for (const hd of headings) {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${hd}&fov=45&pitch=0&source=outdoor&key=${GOOGLE_API_KEY}`;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    rawBuffers.push(buffer);
    tilesData.push({ heading: hd, base64: `data:image/jpeg;base64,${buffer.toString("base64")}` });
  }

  const compositeLayers: OverlayOptions[] = [];
  rawBuffers.forEach((buffer, index) => {
    const leftOffset = index * 640;
    compositeLayers.push({ input: buffer, left: leftOffset, top: 0 });
    compositeLayers.push({ input: createOverlaySvg(headings[index], index + 1), left: leftOffset, top: 0 });
  });

  const outputPath = path.resolve(__dirname, "panorama-360-highres.jpg");
  await sharp({ create: { width: 5120, height: 640, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(compositeLayers)
    .toFile(outputPath);

  return tilesData;
}

/**
 * Executes the strict 3-Step Pipeline using independent API calls to prevent hallucinations
 */
async function executeThreeStepNavigation(lat: number, lng: number, userImagePath: string, targetDestination: string) {
  const userImageBase64 = encodeImageToBase64(userImagePath);
  const tiles = await processEightDirectionTiles(lat, lng);

  console.log(`\n🤖 Running 3-Step Architecture for target: [${targetDestination}]...`);

  // SOLUCIÓN: Intercalar etiquetas de texto explícitas antes de cada imagen
  const panoramaImagesMsg: any[] = [];
  tiles.forEach((tile) => {
    panoramaImagesMsg.push({ type: "text", text: `--- PANORAMA IMAGE AT ${tile.heading}° ---` });
    panoramaImagesMsg.push({ type: "image_url", image_url: { url: tile.base64 } });
  });

  try {
    // ==========================================
    // STEP 1: FIND USER HEADING (User Photo + Panorama)
    // ==========================================
    console.log("   ➤ Step 1: Locating User's Current View...");
    const step1Response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You will receive 8 panorama images explicitly labeled with their degrees (0°, 45°, etc.), followed by a user's photo. Identify which panorama segment visually matches the user's photo. Reply ONLY with the integer number of the degrees (e.g., 315)." },
        { role: "user", content: [...panoramaImagesMsg, { type: "text", text: "--- USER'S CURRENT PHOTO ---" }, { type: "image_url", image_url: { url: userImageBase64 } }] }
      ],
      temperature: 0.0
    });
    const currentHeading = parseInt(step1Response.choices[0].message.content?.trim() || "0");

    // ==========================================
    // STEP 2: FIND TARGET HEADING (Text Name + Panorama ONLY - NO USER PHOTO)
    // ==========================================
    console.log("   ➤ Step 2: Locating Target Store...");
    const step2Response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You will receive 8 panorama images explicitly labeled with their degrees. Find the storefront or sign for "${targetDestination}". Reply ONLY with the integer number of the degrees where it is located (e.g., 45).` },
        { role: "user", content: panoramaImagesMsg }
      ],
      temperature: 0.0
    });
    const targetHeading = parseInt(step2Response.choices[0].message.content?.trim() || "0");

    // ==========================================
    // TYPESCRIPT MATH CALCULATION (Bulletproof Turn Logic)
    // ==========================================
    let turnInstruction = "";
    if (currentHeading === targetHeading) {
      turnInstruction = "No turn needed. Move straight forward.";
    } else {
      let diff = targetHeading - currentHeading;
      if (diff < -180) diff += 360;
      if (diff > 180) diff -= 360;
      
      const direction = diff > 0 ? "RIGHT" : "LEFT";
      const degrees = Math.abs(diff);
      turnInstruction = `Turn ${degrees}° to your ${direction}.`;
    }

    // ==========================================
    // STEP 3: ACCESSIBLE GUIDANCE & LANDMARKS
    // ==========================================
    console.log("   ➤ Step 3: Generating Accessible Guidance...");
    const step3Response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are an orientation assistant for the blind. 
        The system has mathematically calculated the required action: "${turnInstruction}".
        Your job is to look at the user's current photo and provide physical, tactile landmarks to help them execute this instruction safely. 
        Rule 1: Double-check Left vs Right in the photo.
        Rule 2: Mention physical objects like trash cans, steps, or building corners. Do NOT mention elevated text signs.
        Rule 3: Keep it conversational but concise.` },
        { role: "user", content: [{ type: "image_url", image_url: { url: userImageBase64 } }] }
      ],
      temperature: 0.1
    });

    const landmarksGuidance = step3Response.choices[0].message.content;

    // --- FINAL OUTPUT FOR TERMINAL ---
    console.log("\n💬 AI 3-Step Navigation Output:");
    console.log(`- 1st Match (Current View): The user is facing ${currentHeading}°.`);
    console.log(`- 2nd Match (Target Store): The target '${targetDestination}' is located at ${targetHeading}°.`);
    console.log(`- 3rd Step (Guidance): ${turnInstruction} Landmarks: ${landmarksGuidance}`);
    console.log("=========================================\n");

  } catch (error: any) {
    console.error("❌ OpenAI Request failed:", error.message);
  }
}

// --- EXECUTION BLOCK ---
const testLat = 40.702900;
const testLng = -73.869146;
const localUserPhotoPath = path.resolve(__dirname, "my-photo.webp"); 
const finalDestination = "The Corner: Delli Grill"; 

(async () => {
  if (fs.existsSync(localUserPhotoPath)) {
      console.log(`🧪 TESTING MODULAR 3-STEP NAVIGATION PIPELINE...`);
      await executeThreeStepNavigation(testLat, testLng, localUserPhotoPath, finalDestination);
  } else {
      console.error(`❌ Error: Could not find your photo at ${localUserPhotoPath}`);
  }
})();