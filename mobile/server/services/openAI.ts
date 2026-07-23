import axios from "axios";
import OpenAI from "openai";
import { textRequestBody, history, AIPrompt, AppContext, openAITools, nearbyPlacesPrompt, entrancePrompt, directionsPrompt, imagePrompt, videoPrompt, crossStreetsPrompt, trainPrompt } from "../types";
import dotenv from "dotenv";
import { ChatCompletionContentPartImage, ChatCompletionContentPartText } from "openai/resources";
import { addPanoramaDescription, getPanoramaData } from "./doorfront";
import { aiRequestLogService } from "./aiRequestLog";
import { lastMileTestLogService } from "./lastMileTestLog";
import { getSubwayArrivals } from "./mta";
import { extractTrainLineFromText } from "../../src/utils/trainLine";
import { getNearbyFeatures } from "./features";
import { treeInterface, sidewalkMaterialInterface, pedestrianRampInterface } from "../database/models/features";
import sharp from "sharp";
import {
  appendConversationHistory,
  formatHistoryForPrompt,
  getConversationHistory,
} from "../utils/conversationHistory";
import {
  buildLastMileApproachInstruction,
  buildLastMileTurnInstruction,
  LAST_METERS_EXACT_RADIUS_METERS,
  parseDestinationVisibility,
  parseLastMileHeading,
  snapLastMileHeading,
} from "../utils/lastMileNavigation";
import {
  extractNearbyPlaceQuery,
  isNearbyPlaceCandidateRelevant,
  normalizeNearbyPlaceQuery,
  selectNearbyPlaceCandidate,
} from "../utils/nearbyPlaces";
dotenv.config();

function getGoogleMapsApiKey(): string {
  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Google Maps API key is not configured on the server.");
  }
  return apiKey;
}

async function geocodeCoordinates(latitude: number, longitude: number) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${getGoogleMapsApiKey()}`;
  try {
    const response = await axios.get(url);
    //console.log('Google Geocoding API response:', response.data);
    return response.data.results;
  } catch (error) {
    console.error('Error fetching nearby places:', error);
    throw error;
  }
}

// streetview-heading.ts

// --- 1. Type Definitions ---

interface LatLng {
  lat: number;
  lng: number;
}

interface GeocodeResponse {
  status: string;
  results: {
    geometry: {
      location: LatLng;
    };
  }[];
}

interface StreetViewMetadataResponse {
  status: string;
  location?: LatLng; // 'location' is the car's position
}


// --- 3. The Math Helper ---
function calculateHeading(from: LatLng, to: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const toDeg = (rad: number): number => (rad * 180) / Math.PI;

  const phi1 = toRad(from.lat);
  const phi2 = toRad(to.lat);
  const deltaLambda = toRad(to.lng - from.lng);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  const heading = toDeg(theta);

  // Normalize to 0-360
  return (heading + 360) % 360;
}

interface DestinationStreetViewReference {
  photo: string;
  date?: string;
  status: string;
  placeName: string;
  placeAddress: string;
  targetHeading: number;
}

interface VerifiedNearbyDestination {
  placeId: string;
  placeName: string;
  placeAddress: string;
  location: LatLng;
  distanceMeters: number;
}

async function getVerifiedNearbyDestination(
  lat: number,
  lng: number,
  destination: string,
  maxDistanceMeters = 50_000
): Promise<VerifiedNearbyDestination> {
  const nearbyQuery = normalizeNearbyPlaceQuery(destination);
  if (!nearbyQuery) {
    throw new Error("Destination name was empty after normalization.");
  }

  const locationResponse = await axios.get(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    {
      params: {
        location: `${lat},${lng}`,
        rankby: "distance",
        keyword: nearbyQuery,
        key: getGoogleMapsApiKey(),
      },
      timeout: 20_000,
    }
  );
  if (!["OK", "ZERO_RESULTS"].includes(locationResponse.data.status)) {
    throw new Error(`Nearby Places returned ${locationResponse.data.status}.`);
  }

  const nearbyPlace = selectNearbyPlaceCandidate(
    (locationResponse.data.results ?? []).filter((candidate: any) =>
      isNearbyPlaceCandidateRelevant(candidate, nearbyQuery)
    ),
    { lat, lng },
    maxDistanceMeters
  );
  const placeLocation = nearbyPlace?.geometry?.location;
  if (
    !nearbyPlace?.place_id ||
    typeof placeLocation?.lat !== "number" ||
    typeof placeLocation.lng !== "number"
  ) {
    throw new Error(
      `No verified ${nearbyQuery} was found within ${Math.round(maxDistanceMeters / 1_000)} kilometers.`
    );
  }

  return {
    placeId: nearbyPlace.place_id,
    placeName: nearbyPlace.name || nearbyQuery,
    placeAddress: nearbyPlace.vicinity || nearbyPlace.name || nearbyQuery,
    location: { lat: placeLocation.lat, lng: placeLocation.lng },
    distanceMeters: nearbyPlace.distanceMeters,
  };
}

async function getDestinationStreetViewReference(
  lat: number,
  lng: number,
  destination: string,
  resolvedDestination?: VerifiedNearbyDestination
): Promise<DestinationStreetViewReference> {
  const nearbyQuery = normalizeNearbyPlaceQuery(destination);
  if (!nearbyQuery) {
    throw new Error("Destination name was empty after normalization.");
  }
  const nearbyPlace =
    resolvedDestination ??
    await getVerifiedNearbyDestination(lat, lng, nearbyQuery, 2_000);
  const placeLocation = nearbyPlace.location;
  if (nearbyPlace.distanceMeters < 3) {
    throw new Error("Destination coordinates are too close to determine an entrance direction.");
  }

  const metadataResponse = await axios.get<StreetViewMetadata>(
    "https://maps.googleapis.com/maps/api/streetview/metadata",
    {
      params: {
        location: `${placeLocation.lat},${placeLocation.lng}`,
        radius: 100,
        source: "outdoor",
        key: getGoogleMapsApiKey(),
      },
      timeout: 20_000,
    }
  );
  const metadata = metadataResponse.data;
  if (metadata.status !== "OK" || !metadata.location) {
    throw new Error(`Destination Street View metadata returned ${metadata.status}.`);
  }

  const cameraHeading = calculateHeading(metadata.location, {
    lat: placeLocation.lat,
    lng: placeLocation.lng,
  });
  const imageResponse = await axios.get(
    "https://maps.googleapis.com/maps/api/streetview",
    {
      params: {
        size: "640x640",
        ...(metadata.pano_id
          ? { pano: metadata.pano_id }
          : { location: `${placeLocation.lat},${placeLocation.lng}` }),
        heading: cameraHeading.toFixed(1),
        fov: 80,
        pitch: 0,
        source: "outdoor",
        return_error_code: true,
        key: getGoogleMapsApiKey(),
      },
      responseType: "arraybuffer",
      timeout: 20_000,
    }
  );

  return {
    photo: `data:image/jpeg;base64,${Buffer.from(imageResponse.data).toString("base64")}`,
    date: metadata.date,
    status: metadata.status,
    placeName: nearbyPlace.placeName,
    placeAddress: nearbyPlace.placeAddress,
    targetHeading: snapLastMileHeading(
      calculateHeading(
        { lat, lng },
        { lat: placeLocation.lat, lng: placeLocation.lng }
      )
    ),
  };
}

interface VerifiedWalkingDirections {
  placeName: string;
  placeAddress: string;
  distanceMeters: number;
  directionsText: string;
}

async function getVerifiedNearbyWalkingDirections(
  lat: number,
  lng: number,
  destination: string
): Promise<VerifiedWalkingDirections> {
  const nearbyPlace = await getVerifiedNearbyDestination(lat, lng, destination);

  const routeResponse = await axios.get(
    "https://maps.googleapis.com/maps/api/directions/json",
    {
      params: {
        mode: "walking",
        origin: `${lat},${lng}`,
        destination: `place_id:${nearbyPlace.placeId}`,
        key: getGoogleMapsApiKey(),
      },
      timeout: 20_000,
    }
  );
  const routeLeg = routeResponse.data.routes?.[0]?.legs?.[0];
  if (routeResponse.data.status !== "OK" || !routeLeg) {
    throw new Error(`Directions returned ${routeResponse.data.status}.`);
  }

  const directionsText = routeLeg.steps
    .map(
      (step: { html_instructions: string; distance: { text: string } }, index: number) =>
        `Step ${index + 1}) ${step.html_instructions} for ${step.distance.text}`
    )
    .join("\n");

  return {
    placeName: nearbyPlace.placeName,
    placeAddress: nearbyPlace.placeAddress,
    distanceMeters: nearbyPlace.distanceMeters,
    directionsText,
  };
}

// --- 4. Main Logic ---
async function getStreetViewWithHeading(address: string): Promise<string | null> {
  try {
    console.log(`\n1. Geocoding address: "${address}"...`);

    // Step A: Geocode Address (Find the House)
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${getGoogleMapsApiKey()}`;
    
    const geoRes = await fetch(geoUrl);
    const geoData = (await geoRes.json()) as GeocodeResponse;

    if (geoData.status !== 'OK' || !geoData.results.length) {
      throw new Error(`Geocoding failed: ${geoData.status}`);
    }

    const houseLoc: LatLng = geoData.results[0].geometry.location;
    console.log(`   House found at: ${houseLoc.lat}, ${houseLoc.lng}`);

    // Step B: Find Nearest Panorama (Find the Car)
    // The Metadata API returns the specific lat/lng where the car was standing
    const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${houseLoc.lat},${houseLoc.lng}&key=${getGoogleMapsApiKey()}`;
    
    const metaRes = await fetch(metaUrl);
    const metaData = (await metaRes.json()) as StreetViewMetadataResponse;

    if (metaData.status !== 'OK' || !metaData.location) {
      throw new Error(`No Street View found nearby: ${metaData.status}`);
    }

    const carLoc: LatLng = metaData.location;
    console.log(`   Car found at:   ${carLoc.lat}, ${carLoc.lng}`);

    // Step C: Calculate Heading
    const heading = calculateHeading(carLoc, houseLoc);
    console.log(`   Calculated Heading: ${heading.toFixed(2)}°`);

    // Step D: Construct Final URL
    const finalUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${houseLoc.lat},${houseLoc.lng}&heading=${heading.toFixed(2)}&fov=80&pitch=0&key=${getGoogleMapsApiKey()}`;
    
    console.log(`\n✅ Final Image URL:\n${finalUrl}`);
    return finalUrl;

  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('An unknown error occurred');
    }
    return null;
  }
}

const tools = openAITools

function maxTokensForFeature(feature?: string): number {
  switch (feature) {
    case 'mta':
      return 100;
    case 'location_qa':
      return 80;
    case 'directions':
      return 280;
    case 'photo_qa':
    case 'video_qa':
      return 150;
    default:
      return 120;
  }
}

export class OpenAIService {
  private _client: OpenAI | null = null;

  private get client(): OpenAI {
    if (!this._client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured on the server");
      }
      this._client = new OpenAI({ apiKey });
    }
    return this._client;
  }

  async parseUserRequest(ctx: AppContext, text: string, lat: number, lng: number) {
    //console.log(openAIHistory[openAIHistory.length - 1].data)
    const { res } = ctx
    //try function?
    try {
      const openAiResponse = await this.client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "user", content: text },
          {
            role: "system",
            content: `decide the appropriate link to return from function options. If none fit the user query, return 'none'. The latitude is ${lat} and the longitude is ${lng}.  If no type is specified, leave this part out: &type=type.
            Use the chat history to find names of locations, types of locations that the user has asked about, the ratings of locations user has asked about, or the latitude and longitude of relevant locations.
            If no tool is appropriate, do not return any link. Use the image and video tool calls when the user wants description of an image or a video.`
          },
        ],
        tools: tools,
        tool_choice: "auto"
      });
      // console.log(openAIHistory)
      console.log("token usage " + openAiResponse.usage?.total_tokens)
      return openAiResponse
      // res.status(200).json(openAiResponse);
    } catch (e) {
      console.log(e)
      res.status(500).json({ error: 'Error processing your request' });
    }
  }

  // --- LAST METERS NAVIGATION PIPELINE ---
  async lastMileRequest(ctx: AppContext, lat: number, lng: number, image: string, destination: string) {
    const { res } = ctx;
    const startedAt = Date.now();
    let activeStage = "destination proximity check";
    let navigationMode: "approach" | "exact" | undefined;
    let destinationDistanceMeters: number | undefined;
    let verifiedDestination: VerifiedNearbyDestination | undefined;
    let panoramaPhoto: string | undefined;
    let panoramaDate: string | undefined;
    let panoramaStatus: string | undefined;
    let panoramaHeadings: number[] = [];
    let destinationPhoto: string | undefined;
    let destinationPhotoDate: string | undefined;
    let destinationPhotoStatus: string | undefined;
    let destinationPlaceName: string | undefined;
    let destinationPlaceAddress: string | undefined;
    let destinationReferenceUsed = false;
    const testSteps: {
      name: string;
      prompt: string;
      response?: string;
      parsedHeading?: number;
      model: string;
      success: boolean;
      error?: string;
      tokenCount?: number;
    }[] = [];

    console.log("\n==================================================");
    console.log("📥 [BACKEND] HIT RECEIVED ON /api/last-mile route!");
    console.log(`[BACKEND] Destination requested: "${destination}"`);
    console.log(`[BACKEND] Coordinates: lat=${lat}, lng=${lng}`);
    console.log(`[BACKEND] Image payload received (Base64 length): ${image?.length}`);
    console.log("==================================================");

    try {
      const proximityPrompt =
        `Resolve "${destination}" near the user's coordinates and use exact ` +
        `panorama matching only within ${LAST_METERS_EXACT_RADIUS_METERS} meters.`;
      try {
        verifiedDestination = await getVerifiedNearbyDestination(
          lat,
          lng,
          destination
        );
        destinationDistanceMeters = verifiedDestination.distanceMeters;
        destinationPlaceName = verifiedDestination.placeName;
        destinationPlaceAddress = verifiedDestination.placeAddress;
      } catch (proximityError) {
        const message =
          proximityError instanceof Error
            ? proximityError.message
            : "Destination proximity lookup failed.";
        testSteps.push({
          name: "proximity_gate",
          prompt: proximityPrompt,
          response: "DESTINATION_NOT_VERIFIED",
          model: "google-places",
          success: false,
          error: message,
        });
        const finalOutput =
          `I could not verify a nearby ${destination} from your current location. ` +
          "Try a more specific name or street address.";
        const testLogId = await lastMileTestLogService.record({
          destination,
          lat,
          lng,
          userPhoto: await resizeDataUrlImage(image, 1024, 76),
          panoramaHeadings,
          destinationPlaceName,
          destinationPlaceAddress,
          destinationDistanceMeters,
          finalOutput,
          steps: testSteps,
          success: false,
          error: "destination_not_verified",
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json({
          output: finalOutput,
          testLogId,
          warning: "destination_not_verified",
        });
        return;
      }

      if (destinationDistanceMeters > LAST_METERS_EXACT_RADIUS_METERS) {
        navigationMode = "approach";
        const bearing = calculateHeading(
          { lat, lng },
          verifiedDestination.location
        );
        const finalOutput = buildLastMileApproachInstruction(
          verifiedDestination.placeName,
          destinationDistanceMeters,
          bearing
        );
        testSteps.push({
          name: "proximity_gate",
          prompt: proximityPrompt,
          response:
            `APPROACH_ONLY: ${Math.round(destinationDistanceMeters)} meters, ` +
            `${bearing.toFixed(1)} degrees`,
          model: "google-places",
          success: true,
        });
        const testLogId = await lastMileTestLogService.record({
          destination,
          lat,
          lng,
          userPhoto: await resizeDataUrlImage(image, 1024, 76),
          panoramaHeadings,
          destinationPlaceName,
          destinationPlaceAddress,
          destinationDistanceMeters,
          navigationMode,
          finalOutput,
          steps: testSteps,
          success: true,
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json({
          output: finalOutput,
          testLogId,
          mode: navigationMode,
          warning: "destination_too_far",
        });
        return;
      }

      navigationMode = "exact";
      testSteps.push({
        name: "proximity_gate",
        prompt: proximityPrompt,
        response: `EXACT: ${Math.round(destinationDistanceMeters)} meters`,
        model: "google-places",
        success: true,
      });
      activeStage = "panorama download";
      const panorama = await processEightDirectionTiles(lat, lng);
      const { tiles } = panorama;
      panoramaDate = panorama.metadata.date;
      panoramaStatus = panorama.metadata.status;
      panoramaHeadings = tiles.map((tile) => tile.heading);
      activeStage = "panorama assembly";
      panoramaPhoto = await buildPanoramaDebugImage(tiles);
      const panoramaOverviewMsg: any[] = [];
      tiles.forEach((tile) => {
        const label = { type: "text", text: `--- PANORAMA IMAGE AT ${tile.heading}° ---` };
        panoramaOverviewMsg.push(label);
        panoramaOverviewMsg.push({
          type: "image_url",
          image_url: { url: tile.base64, detail: "low" },
        });
      });

      console.log(`\n🤖 Running 3-Step Architecture for target: [${destination}]...`);

      // ==========================================
      // STEP 1: FIND USER HEADING (User Photo + Panorama)
      // ==========================================
      activeStage = "current-view matching";
      console.log("   ➤ Step 1: Locating User's Current View...");
      const step1Prompt = `You will receive 8 panorama images explicitly labeled with their degrees (0°, 45°, etc.), followed by a user's photo. Identify which single panorama segment confidently matches the user's photo.
Reply with exactly one token: 0, 45, 90, 135, 180, 225, 270, 315, or NOT_VISIBLE.
Use NOT_VISIBLE when the photo is blurry, blank, obstructed, or cannot be confidently matched. Do not return business names or explanations.`;
      const step1Response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: step1Prompt },
          {
            role: "user",
            content: [
              ...panoramaOverviewMsg,
              { type: "text", text: "--- USER'S CURRENT PHOTO ---" },
              { type: "image_url", image_url: { url: image, detail: "low" } },
            ],
          }
        ],
        temperature: 0.0,
        max_tokens: 12,
      });
      const step1Text = step1Response.choices[0].message.content?.trim() || "";
      const currentHeading = parseLastMileHeading(step1Text);
      testSteps.push({
        name: "current_view_match",
        prompt: step1Prompt,
        response: step1Text,
        parsedHeading: currentHeading ?? undefined,
        model: "gpt-4o-mini",
        success: currentHeading !== null,
        error: currentHeading === null ? "Current view could not be matched." : undefined,
        tokenCount: step1Response.usage?.total_tokens,
      });
      if (currentHeading === null) {
        const finalOutput =
          "I could not confidently match your photo to the street panorama. Stop in a safe place and retake the photo while facing straight ahead.";
        const testLogId = await lastMileTestLogService.record({
          destination,
          lat,
          lng,
          userPhoto: await resizeDataUrlImage(image, 1024, 76),
          panoramaPhoto,
          panoramaDate,
          panoramaStatus,
          panoramaHeadings,
          destinationPhoto,
          destinationPhotoDate,
          destinationPhotoStatus,
          destinationPlaceName,
          destinationPlaceAddress,
          destinationDistanceMeters,
          destinationReferenceUsed,
          navigationMode,
          finalOutput,
          steps: testSteps,
          success: false,
          error: "current_view_not_visible",
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json({
          output: finalOutput,
          testLogId,
          mode: navigationMode,
          warning: "current_view_not_visible",
        });
        return;
      }

      // ==========================================
      // STEP 2: FIND TARGET HEADING (Text Name + Panorama ONLY - NO USER PHOTO)
      // ==========================================
      activeStage = "destination matching";
      console.log("   ➤ Step 2: Locating Target Store...");
      const panoramaDateContext = panoramaDate
        ? `Street View reports that this panorama was captured in ${panoramaDate}.`
        : "Street View did not provide a capture date for this panorama.";
      const step2Prompt = `You will receive one panorama grid containing 8 views explicitly labeled with their degrees. Find the storefront or sign for "${destination}". ${panoramaDateContext}
Reply with exactly one token: 0, 45, 90, 135, 180, 225, 270, 315, or NOT_VISIBLE.
Use NOT_VISIBLE unless the requested destination is clearly identifiable in the panorama. Do not infer a current business from nearby stores, an old sign, or the destination name alone.`;
      const step2Response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: step2Prompt },
          {
            role: "user",
            content: [
              { type: "text", text: "--- LABELED PANORAMA GRID ---" },
              { type: "image_url", image_url: { url: panoramaPhoto, detail: "high" } },
            ],
          }
        ],
        temperature: 0.0,
        max_tokens: 12,
      });
      const step2Text = step2Response.choices[0].message.content?.trim() || "";
      let targetHeading = parseLastMileHeading(step2Text);
      testSteps.push({
        name: "target_store_match",
        prompt: step2Prompt,
        response: step2Text,
        parsedHeading: targetHeading ?? undefined,
        model: "gpt-4o-mini",
        success: targetHeading !== null,
        error: targetHeading === null ? "Destination was not visible in the panorama." : undefined,
        tokenCount: step2Response.usage?.total_tokens,
      });
      if (targetHeading === null) {
        activeStage = "destination reference lookup";
        console.log("   Step 2B: Fetching a destination-focused Street View reference...");
        const referencePrompt =
          `Fetch a Street View image aimed at the verified nearby location for "${destination}", ` +
          "then confirm the destination in that image.";
        try {
          const reference = await getDestinationStreetViewReference(
            lat,
            lng,
            destination,
            verifiedDestination
          );
          destinationPhoto = reference.photo;
          destinationPhotoDate = reference.date;
          destinationPhotoStatus = reference.status;
          destinationPlaceName = reference.placeName;
          destinationPlaceAddress = reference.placeAddress;

          activeStage = "destination reference verification";
          const destinationDateContext = reference.date
            ? `Street View reports that this image was captured in ${reference.date}.`
            : "Street View did not provide a capture date for this image.";
          const step2bPrompt = `You will receive a destination-focused Street View image for the verified nearby place "${reference.placeName}" at "${reference.placeAddress}". ${destinationDateContext}
Reply with exactly one token: VISIBLE or NOT_VISIBLE.
Use VISIBLE only when the storefront, sign, or entrance clearly corresponds to the named destination. Do not infer identity from the prompt, nearby businesses, or a generic building entrance.`;
          const step2bResponse = await this.client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: step2bPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: "--- DESTINATION-FOCUSED STREET VIEW ---" },
                  { type: "image_url", image_url: { url: reference.photo, detail: "high" } },
                ],
              },
            ],
            temperature: 0.0,
            max_tokens: 8,
          });
          const step2bText = step2bResponse.choices[0].message.content?.trim() || "";
          destinationReferenceUsed = parseDestinationVisibility(step2bText);
          if (destinationReferenceUsed) {
            targetHeading = reference.targetHeading;
          }
          testSteps.push({
            name: "destination_reference_match",
            prompt: step2bPrompt,
            response: step2bText,
            parsedHeading: destinationReferenceUsed ? reference.targetHeading : undefined,
            model: "gpt-4o-mini",
            success: destinationReferenceUsed,
            error: destinationReferenceUsed
              ? undefined
              : "Destination was not confirmed in the focused Street View image.",
            tokenCount: step2bResponse.usage?.total_tokens,
          });
        } catch (referenceError) {
          const message =
            referenceError instanceof Error
              ? referenceError.message
              : "Destination reference lookup failed.";
          console.error("Destination Street View fallback failed:", message);
          testSteps.push({
            name: "destination_reference_match",
            prompt: referencePrompt,
            model: "google-street-view",
            success: false,
            error: message,
          });
        }
      }
      if (targetHeading === null) {
        const ageWarning = panoramaDate
          ? ` The available Street View image is dated ${panoramaDate} and may be outdated.`
          : "";
        const finalOutput =
          `I could not confirm ${destination} in the street panorama.${ageWarning} ` +
          "Do not turn based on this result. Move closer using your primary navigation and try Last Meters again.";
        const testLogId = await lastMileTestLogService.record({
          destination,
          lat,
          lng,
          userPhoto: await resizeDataUrlImage(image, 1024, 76),
          panoramaPhoto,
          panoramaDate,
          panoramaStatus,
          panoramaHeadings,
          destinationPhoto,
          destinationPhotoDate,
          destinationPhotoStatus,
          destinationPlaceName,
          destinationPlaceAddress,
          destinationDistanceMeters,
          destinationReferenceUsed,
          navigationMode,
          currentHeading,
          finalOutput,
          steps: testSteps,
          success: false,
          error: "destination_not_visible",
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json({
          output: finalOutput,
          testLogId,
          mode: navigationMode,
          warning: "destination_not_visible",
        });
        return;
      }

      // ==========================================
      // TYPESCRIPT MATH CALCULATION (Bulletproof Turn Logic)
      // ==========================================
      const turnInstruction = buildLastMileTurnInstruction(currentHeading, targetHeading);

      // ==========================================
      // STEP 3: ACCESSIBLE GUIDANCE & LANDMARKS
      // ==========================================
      activeStage = "accessible guidance";
      console.log("   ➤ Step 3: Generating Accessible Guidance...");
      const destinationReferenceContext = destinationReferenceUsed
        ? `A separate Street View image for "${destinationPlaceName}" is also provided. It was captured ${destinationPhotoDate || "on an unknown date"} and may be outdated. Use it only as historical entrance context, never as proof of current conditions.`
        : "No separate destination reference image is provided.";
      const step3Prompt = `You are an orientation assistant for a blind pedestrian.
The validated turn instruction is: "${turnInstruction}"
${destinationReferenceContext}
Describe at most two stable physical landmarks. Use the user's current photo for a landmark useful while turning in place. If a destination reference is provided, you may also describe one clearly visible entrance feature and must prefix it with "Street View reference:".
Only mention stable, cane-detectable or tactile features such as a wall edge, curb, doorway recess, railing, or steps.
Never claim that a reference-image feature is currently present or visible from the user's position. Never invent an object. Never say "look", "see", "watch", "keep an eye out", or promise that a path is clear.
Do not instruct the user to walk forward or cross a street. If no reliable landmark is visible, reply exactly: NO_RELIABLE_LANDMARKS.
Keep the response to two short sentences and do not repeat the turn instruction.`;
      const step3UserContent: any[] = [
        { type: "text", text: "--- USER'S CURRENT PHOTO ---" },
        { type: "image_url", image_url: { url: image, detail: "high" } },
      ];
      if (destinationReferenceUsed && destinationPhoto) {
        step3UserContent.push(
          { type: "text", text: "--- DESTINATION-FOCUSED STREET VIEW REFERENCE ---" },
          { type: "image_url", image_url: { url: destinationPhoto, detail: "high" } }
        );
      }
      const step3Response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: step3Prompt },
          { role: "user", content: step3UserContent }
        ],
        temperature: 0.1,
        max_tokens: 100,
      });

      const step3Text = step3Response.choices[0].message.content?.trim() || "";
      const landmarksGuidance =
        !step3Text || /\bNO_RELIABLE_LANDMARKS\b/i.test(step3Text)
          ? "No reliable physical landmark was identified. Turn in place without moving forward, then confirm your orientation before continuing."
          : step3Text;
      testSteps.push({
        name: "accessible_guidance",
        prompt: step3Prompt,
        response: step3Text,
        model: "gpt-4o-mini",
        success: !!step3Text && !/\bNO_RELIABLE_LANDMARKS\b/i.test(step3Text),
        error:
          !step3Text || /\bNO_RELIABLE_LANDMARKS\b/i.test(step3Text)
            ? "No reliable physical landmark was identified."
            : undefined,
        tokenCount: step3Response.usage?.total_tokens,
      });

      // --- FINAL OUTPUT FOR TERMINAL ---
      console.log("\n💬 AI 3-Step Navigation Output:");
      console.log(`- 1st Match (Current View): The user is facing ${currentHeading}°.`);
      console.log(`- 2nd Match (Target Store): The target '${destination}' is located at ${targetHeading}°.`);
      console.log(`- 3rd Step (Guidance): ${turnInstruction} Landmarks: ${landmarksGuidance}`);
      console.log("=========================================\n");

      const finalOutput = `${turnInstruction} Landmarks: ${landmarksGuidance}`;
      const testLogId = await lastMileTestLogService.record({
        destination,
        lat,
        lng,
        userPhoto: await resizeDataUrlImage(image, 1024, 76),
        panoramaPhoto,
        panoramaDate,
        panoramaStatus,
        panoramaHeadings,
        destinationPhoto,
        destinationPhotoDate,
        destinationPhotoStatus,
        destinationPlaceName,
        destinationPlaceAddress,
        destinationDistanceMeters,
        destinationReferenceUsed,
        navigationMode,
        currentHeading,
        targetHeading,
        turnInstruction,
        finalOutput,
        steps: testSteps,
        success: true,
        latencyMs: Date.now() - startedAt,
      });
      res.status(200).json({ output: finalOutput, testLogId, mode: navigationMode });

    } catch (error: any) {
      const upstreamStatus = error?.status ?? error?.response?.status;
      const failureReason =
        typeof upstreamStatus === "number"
          ? `upstream returned HTTP ${upstreamStatus}`
          : typeof error?.code === "string"
            ? error.code
            : "unexpected backend error";
      const clientError = `Last Meters failed during ${activeStage}: ${failureReason}.`;
      console.error("❌ Last Meters request failed:", {
        stage: activeStage,
        status: upstreamStatus,
        code: error?.code,
        message: error?.message,
      });
      await lastMileTestLogService.record({
        destination,
        lat,
        lng,
        userPhoto: await resizeDataUrlImage(image, 1024, 76),
        panoramaPhoto,
        panoramaDate,
        panoramaStatus,
        panoramaHeadings,
        destinationPhoto,
        destinationPhotoDate,
        destinationPhotoStatus,
        destinationPlaceName,
        destinationPlaceAddress,
        destinationDistanceMeters,
        destinationReferenceUsed,
        navigationMode,
        steps: testSteps,
        success: false,
        error: error?.message ?? "Last meters calculation failed.",
        latencyMs: Date.now() - startedAt,
      });
      res.status(502).json({ error: clientError });
    }
  }

  async textRequest(ctx: AppContext, content: textRequestBody) {
    const { res } = ctx;
    const startedAt = Date.now();
    let toolUsed: string | undefined;
    const analytics = content.analytics;
    const requestHadCoords = !!content.coords;
    const requestedNearbyQuery = requestHadCoords
      ? extractNearbyPlaceQuery(content.text)
      : null;
    const requiresVerifiedNearbyAnswer =
      requestHadCoords &&
      (
        analytics?.feature === "directions" ||
        requestedNearbyQuery !== null
      );
    let verifiedNearbyAnswer = false;
    const imageCount = Array.isArray(content.image)
      ? content.image.filter((img) => img).length
      : 0;

    const recordAiRequest = async (
      success: boolean,
      extra?: { outputLength?: number; tokenCount?: number; errorCode?: string }
    ) => {
      await aiRequestLogService.record({
        requestId: analytics?.requestId,
        installId: analytics?.installId,
        sessionId: analytics?.sessionId,
        platform: analytics?.platform,
        appVersion: analytics?.appVersion,
        feature: analytics?.feature,
        toolUsed,
        inputLength: content.text?.length ?? 0,
        hasImage: imageCount > 0,
        imageCount,
        hasCoords: !!content.coords,
        success,
        errorCode: extra?.errorCode,
        latencyMs: Date.now() - startedAt,
        outputLength: extra?.outputLength,
        tokenCount: extra?.tokenCount,
      });
    };

    const respondWithUnverifiedNearbyLocation = async (destinationLabel: string) => {
      const safeOutput =
        `I could not verify a nearby ${destinationLabel} from your current location. ` +
        "Try a more specific name or street address.";
      const updatedHistory = appendConversationHistory(content.analytics, {
        input: content.text,
        output: safeOutput,
        data: "Nearby destination lookup failed; no unverified location was used.",
      });
      await recordAiRequest(false, {
        outputLength: safeOutput.length,
        errorCode: "nearby_destination_not_verified",
      });
      res.status(200).json({ output: safeOutput, history: updatedHistory, route: null });
    };

    // console.log("hello world!!!")
    let systemContent = '';
    let completeAIPrompt = AIPrompt
    let relevantData = '';
    let panoramaId = '';
    const userContent: [ChatCompletionContentPartText | ChatCompletionContentPartImage] = [
      { type: 'text', text: content.text }
    ]
    //updated userContent to take array of images instead of a singe string image
    if (Array.isArray(content.image) && content.image.length > 0 && content.image[0] !== null) {
      // console.log(content)
      content.image.forEach(image => {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: image,
            detail: 'auto',
          },
        });
      });
    }
    // console.log(userContent)
    if (content.coords) {
      const geocodedCoords = await geocodeCoordinates(content.coords.latitude, content.coords.longitude)
      systemContent += `Current Address: ${geocodedCoords[0].formatted_address} `;

      if (content.coords.heading !== undefined) {
        systemContent += `, Heading (Compass Direction): ${content.coords.heading}`;
      }

      if (content.coords.orientation) {
        systemContent += `, Orientation - Alpha: ${content.coords.orientation.alpha}, Beta: ${content.coords.orientation.beta}, Gamma: ${content.coords.orientation.gamma}`;
      }
    }
    else content.coords = { latitude: 0, longitude: 0 }

    if (requiresVerifiedNearbyAnswer) {
      const nearbyQuery = requestedNearbyQuery;
      if (!nearbyQuery) {
        await respondWithUnverifiedNearbyLocation("destination");
        return;
      }
      try {
        const verifiedDirections = await getVerifiedNearbyWalkingDirections(
          content.coords.latitude,
          content.coords.longitude,
          nearbyQuery
        );
        toolUsed = "verifiedNearbyWalkingDirections";
        verifiedNearbyAnswer = true;
        completeAIPrompt += directionsPrompt;
        relevantData = `Directions:\n${verifiedDirections.directionsText}`;
        systemContent +=
          `\nVerified nearby destination: ${verifiedDirections.placeName}, ` +
          `${verifiedDirections.placeAddress}, approximately ` +
          `${Math.round(verifiedDirections.distanceMeters)} meters away.\n` +
          relevantData;
      } catch (error) {
        console.error("Verified nearby directions lookup failed:", error);
        await respondWithUnverifiedNearbyLocation(nearbyQuery);
        return;
      }
    }

    try {
      if (verifiedNearbyAnswer) {
        console.log("Using deterministic nearby walking directions.");
      } else {
      const parsedRequest = await this.parseUserRequest(ctx, content.text, content.coords.latitude, content.coords.longitude)
      // console.log("parsedRequest: ", parsedRequest)
      console.log(parsedRequest?.choices[0].message)
      //determine if chat gpt is returning an api link
      if (parsedRequest && parsedRequest.choices.length > 0 && parsedRequest.choices[0].message.tool_calls && parsedRequest.choices[0].message.tool_calls!.length > 0) {
        console.log(parsedRequest?.choices[0].message.tool_calls![0].function.name)
        toolUsed = parsedRequest.choices[0].message.tool_calls![0].function.name;

        const parsedArgs = JSON.parse(parsedRequest.choices[0].message.tool_calls![0].function.arguments)
        //get link
        const { link } = parsedArgs;
        console.log("Calling Google Maps tool:", parsedRequest.choices[0].message.tool_calls![0].function.name)
        // console.log("parsedArgs", parsedArgs);  
        if (link !== undefined && parsedRequest.choices[0].message.tool_calls![0].function.name !== "generateTrainInformation") {
          //use link
          if (parsedRequest.choices[0].message.tool_calls![0].function.name === "getCrossStreets") {
            completeAIPrompt += crossStreetsPrompt;
            const completeLink = link + `&key=${getGoogleMapsApiKey()}`;
            userContent.push({
              type: 'image_url',
              image_url: {
                url: completeLink,
                detail: 'low',
              }
            });
            // console.log(userContent);
          }

          else {
            const places: any = await axios.get(link + `&key=${getGoogleMapsApiKey()}`);
            //if its giving back a nearby places link
            if (places.data.results) {
              completeAIPrompt += nearbyPlacesPrompt;
              // console.log(places.data.results)
              relevantData = places.data.results.map(
                (place: { name: string, geometry: { location: { lat: number, lng: number } }, rating: number, vicinity: string }) =>
                  `\n{name: ${place.name}, location(lat,lng): ${place.geometry.location.lat},${place.geometry.location.lng}, address: ${place.vicinity}, rating: ${place.rating} stars}`).join(', ');
              //console.log(relevantData)
              systemContent += `\nNearby Places in order of nearest distance: ${relevantData}`;
              //console.log(systemContent)
            }
            //if its giving back a specific place link
            else if (places.data.candidates) {
              completeAIPrompt += nearbyPlacesPrompt;
              //console.log(places.data.candidates[0])
              //relevantData = `name: ${places.data.candidates[0].name}, address: ${places.data.candidates[0].formatted_address}`
              //console.log(relevantData)
              let operatingHours = '';
              if (places.data.candidates[0].opening_hours) {
                //console.log("user wants operating hours")
                const placeInformation = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${places.data.candidates[0].place_id}&fields=opening_hours&key=${getGoogleMapsApiKey()}`);
                operatingHours = placeInformation.data.result.opening_hours.weekday_text
              }
              systemContent += `Relevant Place Information: ${JSON.stringify(places.data.candidates[0], null, 2)}`
              systemContent += `Operating Hours: ${operatingHours.length > 0 ? operatingHours : 'Not available'}`;
            }
            //if its giving back directions link

            // else if (places.data.routes) {
            //   console.log(places.data.routes[0].legs[0])
            //   relevantData = "Directions:\n"
            //   for (let i = 0; i < places.data.routes[0].legs[0].steps.length; i++) {
            //     relevantData += `Step ${i + 1}) ${places.data.routes[0].legs[0].steps[i].html_instructions} \n`
            //   }
            //   systemContent += relevantData
            //   const routePoints: { lat: number, lng: number  }[] = [{lat:places.data.routes[0].legs[0].steps[0].start_location.lat, lng:places.data.routes[0].legs[0].steps[0].start_location.lng}]
            //   routePoints.push(...places.data.routes[0].legs[0].steps.map((step: { start_location: { lat: number, lng: number }, end_location: { lat: number, lng: number } }) => ({
            //     lat: step.end_location.lat, lng: step.end_location.lng
            //   })));
            //   let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?&size=640x640&maptype=roadmap&path=color:0x0000ff|weight:5|`;
            //   staticMapUrl += routePoints.map(point => `${point.lat},${point.lng}`).join('|');
            //   staticMapUrl += `&key=${process.env.GOOGLE_API_KEY}`;
            //   console.log(staticMapUrl)
            // }

            //if its giving back distance matrix link
            else if (places.data.rows) {
              relevantData = "distance: " + places.data.rows[0].elements[0].distance.value + ", duration: " + places.data.rows[0].elements[0].duration.text
              systemContent += `Distance in miles: ${places.data.rows[0].elements[0].distance.value * 0.00062137}, How long it will take to walk: ${places.data.rows[0].elements[0].duration.text}`
              //console.log(systemContent)
            }
          }
        }
        //if its using doorfront api
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "useDoorfrontAPI") {
          //use doorfront api
          completeAIPrompt += entrancePrompt;
          const parsedArgs = JSON.parse(parsedRequest.choices[0].message.tool_calls![0].function.arguments)
          //get link
          const { address } = parsedArgs;
          // console.log(address)
          const reqlink = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?location=
            ${content.coords.latitude},${content.coords.longitude}&fields=formatted_address%2Cname%2Cgeometry&inputtype=textquery&input=${address.replace(/\s+/g, '%2C')}` + `&key=${getGoogleMapsApiKey()}`;
          console.log(reqlink)
          const location: any = await axios.get(reqlink);
          // console.log(location)
          // console.log(geocodedCoords[0].formatted_address)
          // remove st, nd, rd, th from address for better matching
          const cleanAddress = location.data.candidates[0].name.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
          const panoramaData = await getPanoramaData(ctx, cleanAddress);
          if (panoramaData) {
            //console.log(panoramaData.human_labels[0].labels);
            console.log(panoramaData.image_description);
            if (panoramaData.url && panoramaData.image_description === undefined) {
              userContent.push({
                type: 'image_url',
                image_url: {
                  url: panoramaData.url,
                  detail: 'high',
                }
              });
              panoramaId = panoramaData._id.toString();
              relevantData = `Entrance Information and Features for ${location.data.candidates[0].formatted_address}:`
              relevantData += panoramaData.human_labels[0].labels.map(
                (label: { label: string, subtype: number, box: { x: number, y: number, width: number, height: number } }) =>
                  `\n${label.label} (${label.subtype ? label.subtype : 'exists'}), Bounding Box: x = ${label.box.x}, y = ${label.box.y}, width: ${label.box.width}, height: ${label.box.height}`
              ).join('; ');
              console.log(relevantData);
            } else {
              relevantData += `Image Description: ${panoramaData.image_description}`;
            }
          } else {
            console.error('No panorama data found for this address.');
            const streetViewURL = await getStreetViewWithHeading(location.data.candidates[0].formatted_address);
            console.log("getting sv with proper heading... ", streetViewURL);
            if (streetViewURL) userContent.push({
                type: 'image_url',
                image_url: {
                  url: streetViewURL,
                  detail: 'high',
                }
              });
            // relevantData = 'Data on this address has not been collected yet. Let the user know if they want detailed information on this address, they can visit doorfront.org and request it be added.';
            relevantData = `Data on this address has not been collected yet by volunteers. Use the street view image to describe the entrance features visible from street view. Let the user know this data is not validated by real users and may not be correct.
             When describing this image, provide a confidence level (1 to 5) for your description of the entrance based on how clear the image is.`;

          }
          systemContent += `\n${relevantData}`;
        }
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "getNearbyFeatures") {
          const parsedArgs = JSON.parse(parsedRequest.choices[0].message.tool_calls![0].function.arguments);
          if (parsedArgs.address) {
            console.log(parsedArgs.address);

          }
          const features = await getNearbyFeatures(content.coords.latitude, content.coords.longitude, 0.06);
          // console.log(features);
          const trees: treeInterface[] = features.trees;
          const sidewalkMaterials: sidewalkMaterialInterface[] = features.sidewalkMaterials;
          const pedestrianRamps: pedestrianRampInterface[] = features.pedestrianRamps;
          relevantData = `Nearby Features for location (${content.coords.latitude}, ${content.coords.longitude}):\n`;
          relevantData += `Trees: ${trees.length}, Sidewalk Materials: ${sidewalkMaterials.length}, Pedestrian Ramps: ${pedestrianRamps.length}`;
          systemContent += `\n${relevantData}`;
          let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?&zoom=18&size=640x640&maptype=roadmap`;
          // Add user location marker
          staticMapUrl += `&markers=color:blue%7Clabel:U%7C${content.coords.latitude},${content.coords.longitude}`;
          staticMapUrl += `&markers=color:green%7Clabel:T%7C${trees.map(tree => `${tree.location.coordinates[1]},${tree.location.coordinates[0]}`).join('%7C')}`;
          // staticMapUrl += `&markers=color:yellow%7Clabel:S%7C${sidewalkMaterials.map(material => `${material.location.coordinates[1]},${material.location.coordinates[0]}`).join('%7C')}`;
          // Define colors for each sidewalk material type
          const materialColors: Record<string, string> = {
            tactile: "yellow",
            //concrete: "gray",
            manhole: "black",
            "cellar door": "brown",
            "subway grate": "orange",
            other: "white"
          };

          // Add a marker for each material type
          Object.entries(materialColors).forEach(([material, color]) => {
            const locations = sidewalkMaterials
              .filter(m => m.material.toLowerCase() === material)
              .map(m => `${m.location.coordinates[1]},${m.location.coordinates[0]}`);
            if (locations.length > 0) {
              staticMapUrl += `&markers=color:${color}%7Clabel:S%7C${locations.join('%7C')}`;
            }
          });
          staticMapUrl += `&markers=color:purple%7Clabel:R%7C${pedestrianRamps.map(
            ramp => `${ramp.location.coordinates[1]},${ramp.location.coordinates[0]}`).join('%7C')}`;
          // Add the API key to the static map URL
          staticMapUrl += `&key=${getGoogleMapsApiKey()}`;

          console.log(staticMapUrl);
        }
        // Directions with static map, doorfront, and features
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "generateGoogleDirectionAPILink") {
          try {
            completeAIPrompt += directionsPrompt
            let formattedAddress = '';
            let nearbyPlaceId: string | undefined;
            console.log("Generating Google Direction API Link")
            console.log(parsedArgs);
            // step 1: if destination is a store name, get the formatted address
            let cleanAddress;
            if (!parsedArgs.address) {
              const nearbyQuery = normalizeNearbyPlaceQuery(String(parsedArgs.destination || ""));
              if (!nearbyQuery) {
                throw new Error("Destination name was empty after normalization.");
              }
              const location = await axios.get(
                "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
                {
                  params: {
                    location: `${content.coords.latitude},${content.coords.longitude}`,
                    rankby: "distance",
                    keyword: nearbyQuery,
                    key: getGoogleMapsApiKey(),
                  },
                  timeout: 20_000,
                }
              );
              if (!["OK", "ZERO_RESULTS"].includes(location.data.status)) {
                throw new Error(`Nearby Places returned ${location.data.status}.`);
              }
              const nearbyPlace = selectNearbyPlaceCandidate(
                (location.data.results ?? []).filter((candidate: any) =>
                  isNearbyPlaceCandidateRelevant(candidate, nearbyQuery)
                ),
                {
                  lat: content.coords.latitude,
                  lng: content.coords.longitude,
                }
              );
              if (!nearbyPlace?.place_id) {
                throw new Error(`No nearby ${nearbyQuery} was found within 50 kilometers.`);
              }

              nearbyPlaceId = nearbyPlace.place_id;
              formattedAddress = nearbyPlace.vicinity || nearbyPlace.name || nearbyQuery;
              cleanAddress = nearbyPlace.name?.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
              systemContent +=
                `Resolved nearby destination: ${nearbyPlace.name || nearbyQuery}, ` +
                `${formattedAddress}, approximately ${Math.round(nearbyPlace.distanceMeters)} meters away.\n`;
            }
            else {
              const location = await axios.get(
                "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                {
                  params: {
                    fields: "formatted_address,name,place_id",
                    inputtype: "textquery",
                    input: parsedArgs.destination,
                    locationbias:
                      `circle:50000@${content.coords.latitude},${content.coords.longitude}`,
                    key: getGoogleMapsApiKey(),
                  },
                  timeout: 20_000,
                }
              );
              if (location.data.status !== "OK" || !location.data.candidates?.[0]) {
                throw new Error(`Address lookup returned ${location.data.status}.`);
              }
              formattedAddress = location.data.candidates[0].formatted_address;
              cleanAddress = location.data.candidates[0].name.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
              nearbyPlaceId = location.data.candidates[0].place_id;
            }
            console.log(formattedAddress);
            

            // step 2: get doorfront data if it exists for the formatted address
            const panoramaData = await getPanoramaData(ctx, cleanAddress);
            let doorfrontData = '';
            let doorLocation: { lat: number, lng: number } | undefined | string = undefined;
            if (panoramaData && panoramaData.human_labels && panoramaData.human_labels.length > 0) {
              console.log("Panorama data found for address:", formattedAddress);
              // doorfrontData += panoramaData.human_labels[0].labels.map(
              //   (label: { label: string, subtype: string, box: { x: number, y: number, width: number, height: number } }) =>
              //     `\n${label.label} (${label.subtype ? label.subtype : 'exists'}), Bounding Box: x = ${label.box.x}, y = ${label.box.y}, width: ${label.box.width}, height: ${label.box.height}`
              // ).join('; ');
              for (const label of panoramaData.human_labels[0].labels) {
                if (label.label === 'door') {
                  doorLocation = `${label.exactCoordinates?.lat}, ${label.exactCoordinates?.lng}`;
                  break;
                }
              }
              if (doorLocation === undefined) {
                doorLocation = `${panoramaData.location.lat}, ${panoramaData.location.lng}`;
              }
            } else {
              console.log('No panorama data found for this address.');
              console.log("getting sv with proper heading... ", getStreetViewWithHeading(formattedAddress));
            }
            // step 3: get route from starting location to destination (doorfront location if it exists)
            if (!doorLocation) {
              doorLocation = nearbyPlaceId ? `place_id:${nearbyPlaceId}` : formattedAddress;
            }
            const route = await axios.get(
              "https://maps.googleapis.com/maps/api/directions/json",
              {
                params: {
                  mode: "walking",
                  origin: `${content.coords.latitude},${content.coords.longitude}`,
                  destination: doorLocation,
                  key: getGoogleMapsApiKey(),
                },
                timeout: 20_000,
              }
            );
            if (route.data.status !== "OK" || !route.data.routes?.[0]?.legs?.[0]) {
              throw new Error(`Directions returned ${route.data.status}.`);
            }
            relevantData = "Directions:\n"
            for (let i = 0; i < route.data.routes[0].legs[0].steps.length; i++) {
              relevantData += `Step ${i + 1}) ${route.data.routes[0].legs[0].steps[i].html_instructions} for ${route.data.routes[0].legs[0].steps[i].distance.text} \n`
            }
            systemContent += relevantData
            // // step 4: Take each lat/lng from each point in route --> can just use encoded polyline
            // const polyline = route.data.routes[0].overview_polyline.points;
            // const routePoints: { lat: number, lng: number  }[] = [{lat:route.data.routes[0].legs[0].steps[0].start_location.lat, lng:route.data.routes[0].legs[0].steps[0].start_location.lng}]
            // routePoints.push(...route.data.routes[0].legs[0].steps.map((step: { start_location: { lat: number, lng: number }, end_location: { lat: number, lng: number } }) => ({
            //   lat: step.end_location.lat, lng: step.end_location.lng
            // })));
            // // step 5: For each point in route, get features in a certain radius around that point
            // const features = await Promise.all(routePoints.map(async (point) => {
            //   const nearbyFeatures = await getNearbyFeatures(point.lat, point.lng, 0.03);
            //   return nearbyFeatures;
            // }));
            // const mergedFeatures = {
            //   trees: features.flatMap(f => f.trees),
            //   sidewalkMaterials: features.flatMap(f => f.sidewalkMaterials),
            //   pedestrianRamps: features.flatMap(f => f.pedestrianRamps),
            // };
            // // console.log(features)
            // // step 6: Add the route line and all features to the static map along with starting and ending position
            // // let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?&size=640x640&maptype=roadmap&path=color:0x0000ff|weight:7|enc:${polyline}`;
            // let staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${routePoints[routePoints.length-1].lat},${routePoints[routePoints.length-1].lng}&zoom=19&size=640x640&maptype=roadmap&path=color:0x0000ff|weight:7|enc:${polyline}`;
            // const trees: treeInterface[] = mergedFeatures.trees;
            // const sidewalkMaterials: sidewalkMaterialInterface[] = mergedFeatures.sidewalkMaterials;
            // const pedestrianRamps: pedestrianRampInterface[] = mergedFeatures.pedestrianRamps;
            // staticMapUrl += `&markers=color:blue%7Clabel:U%7C${content.coords.latitude},${content.coords.longitude}`;
            // staticMapUrl += `&markers=color:red%7Clabel:D%7C${routePoints[routePoints.length-1].lat},${routePoints[routePoints.length-1].lng}`;
            // staticMapUrl += `&markers=color:green%7Clabel:T%7C${trees.map(tree => `${tree.location.coordinates[1]},${tree.location.coordinates[0]}`).join('%7C')}`;
            // systemContent += `Feature Locations: Trees: ${trees.map(tree => `(${tree.location.coordinates[1]},${tree.location.coordinates[0]})`).join(', ')} \n 
            // Sidewalk Materials: ${sidewalkMaterials.map(material => `${material.material} at (${material.location.coordinates[1]},${material.location.coordinates[0]})`).join(', ')} \n 
            // Pedestrian Ramps: ${pedestrianRamps.map(ramp => `(${ramp.location.coordinates[1]},${ramp.location.coordinates[0]})`).join(', ')}`;
            // // staticMapUrl += `&markers=color:yellow%7Clabel:S%7C${sidewalkMaterials.map(material => `${material.location.coordinates[1]},${material.location.coordinates[0]}`).join('%7C')}`;
            // // Define colors for each sidewalk material type
            // const materialColors: Record<string, string> = {
            //   // tactile: "yellow",
            //   //concrete: "gray",
            //   // manhole: "black",
            //   // "cellar door": "brown",
            //   "subway grate": "orange",
            //   // other: "white"
            // };

            // // Add a marker for each material type
            // Object.entries(materialColors).forEach(([material, color]) => {
            //   const locations = sidewalkMaterials
            //     .filter(m => m.material.toLowerCase() === material)
            //     .map(m => `${m.location.coordinates[1]},${m.location.coordinates[0]}`);
            //   if (locations.length > 0) {
            //     staticMapUrl += `&markers=color:${color}%7Clabel:S%7C${locations.join('%7C')}`;
            //   }
            // });
            // staticMapUrl += `&markers=color:red%7Clabel:R%7C${pedestrianRamps.map(
            //   ramp => `${ramp.location.coordinates[1]},${ramp.location.coordinates[0]}`).join('%7C')}`;
            // // Add the API key to the static map URL
            // staticMapUrl += `&key=${process.env.GOOGLE_API_KEY}`;
            // console.log(staticMapUrl);
            //   // step 7: give populated static map to gpt
            // userContent.push({
            //   type: 'image_url',
            //   image_url: {
            //     url: staticMapUrl,
            //     detail: 'high',
            //   }
            // });
            // const fullRouteData = {
            //   route: routePoints,
            //   features: mergedFeatures,
            //   doorfront: doorfrontData,
            // }
            // console.log(JSON.stringify(fullRouteData))
          } catch (error) {
            console.error("Nearby directions lookup failed:", error);
            const failedDestination = String(parsedArgs.destination || "that destination");
            const safeOutput =
              `I could not verify a nearby ${failedDestination} from your current location. ` +
              "Try a more specific name or street address.";
            const updatedHistory = appendConversationHistory(content.analytics, {
              input: content.text,
              output: safeOutput,
              data: "Nearby destination lookup failed; no unverified location was used.",
            });
            await recordAiRequest(false, {
              outputLength: safeOutput.length,
              errorCode: "nearby_destination_not_verified",
            });
            res.status(200).json({ output: safeOutput, history: updatedHistory, route: null });
            return;
          }
        }
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "generateTrainInformation") {
          completeAIPrompt += trainPrompt;
          const parsedArgs = JSON.parse(parsedRequest.choices[0].message.tool_calls![0].function.arguments);
          const extractedRoute = extractTrainLineFromText(content.text);
          const route = extractedRoute ?? (parsedArgs.routeId?.toUpperCase() || "A");
          console.log(`[MTA] AI requested data for the ${route} train.`);

          const trainData = await getSubwayArrivals(
            route,
            content.coords.latitude,
            content.coords.longitude
          );

          relevantData = `Live MTA Transit Information for line ${route}: ${trainData}`;
          systemContent += `\n${relevantData}`;
        }
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "imageDescription") {
          completeAIPrompt += imagePrompt;
        }
        else if (parsedRequest.choices[0].message.tool_calls![0].function.name === "videoDescription") {
          completeAIPrompt += videoPrompt;
        }

      } else console.log("No tool calls found in OpenAI response");
      }
      // const places = await fetchNearbyPlaces(content.coords.latitude, content.coords.longitude);
      // nearbyPlaces = places.map((place: { name: string }) => place.name).join(', ');
      // systemContent += ` Nearby Places: ${nearbyPlaces}`;
    } catch (error) {
      console.error('Error including api information in OpenAI request:', error);
    }

    // console.log(systemContent)
    // openAI separate text request
    try {
      //  console.log("user prompt: ", userContent)
        console.log("system prompt: ", systemContent)
      // console.log("openAI history: ", openAIHistory)
      systemContent += `Current Date and Time (Eastern): ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`;
      // console.log("prompt: ", completeAIPrompt)
      const priorHistory = getConversationHistory(analytics);
      const recentHistory = priorHistory.slice(-3);
      if (toolUsed === "generateGoogleDirectionAPILink" && content.image && content.image[0] !== null) {
        completeAIPrompt += "\n\nCRITICAL INSTRUCTION: The user attached an image/video of their surroundings for 'Last Meters' navigation. DO NOT just read the GPS directions. You MUST analyze the image and use it to guide the user exactly to the physical door or entrance relative to their current view.";
      }
      const combinedSystemMessage = completeAIPrompt
        + "\n\nRelevant data: "
        + systemContent
        + "\n\nChat history: "
        + formatHistoryForPrompt(recentHistory);
      const chatCompletion = await this.client.chat.completions.create({
        messages: [
          { role: 'system', content: combinedSystemMessage },
          { role: 'user', content: userContent }
        ],
        model: 'gpt-4.1-mini',
        temperature: 0.2,
        max_tokens: maxTokensForFeature(analytics?.feature),
      });
      console.log('OpenAI API response:', chatCompletion.usage?.total_tokens);
      const outputText = chatCompletion.choices[0].message.content as string;
      const updatedHistory = appendConversationHistory(analytics, {
        input: content.text,
        output: outputText,
        data: relevantData,
      });

      // 3. Only update if both conditions are met AND we have a valid ID
      if (panoramaId) {
          console.log("Generating new description for DF database...");
          
          // We pass the panorama _id and the AI's generated output
          await addPanoramaDescription(panoramaId, outputText);
      }
      await recordAiRequest(true, {
        outputLength: outputText?.length ?? 0,
        tokenCount: chatCompletion.usage?.total_tokens,
      });
      res.status(200).json({ output: outputText, history: updatedHistory });
    }
    catch (e: any) {
      console.error('Error with OpenAI API request:', e);
      await recordAiRequest(false, { errorCode: 'openai_error' });
      res.status(500).json({ error: 'Error processing your request: ' + e.message });
    }
  }
  // ----------------------------------------------------------------------------------------------------------------
  //* OpenAI Audio API
  async audioRequest(ctx: AppContext, text: string) {
    const { res } = ctx
    // const speechFile = path.resolve("./speech.mp3");
    //console.log(text)
    try {
      const mp3 = await this.client.audio.speech.create({
        model: "tts-1",
        voice: "echo",
        input: text
      })
      const buffer = Buffer.from(await mp3.arrayBuffer());
      // await fs.promises.writeFile(speechFile, buffer);

      res.contentType("audio/mpeg")
      res.status(200).send(buffer)
    } catch (e) {
      console.error(e)
    }
  }

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

async function buildPanoramaDebugImage(tiles: { heading: number; base64: string }[]): Promise<string> {
  const compositeLayers: sharp.OverlayOptions[] = [];
  tiles.forEach((tile, index) => {
    const leftOffset = (index % 4) * 640;
    const topOffset = Math.floor(index / 4) * 640;
    const imageBuffer = Buffer.from(
      tile.base64.replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );
    compositeLayers.push({ input: imageBuffer, left: leftOffset, top: topOffset });
    compositeLayers.push({
      input: createOverlaySvg(tile.heading, index + 1),
      left: leftOffset,
      top: topOffset,
    });
  });

  const outputBuffer = await sharp({
    create: { width: 2560, height: 1280, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite(compositeLayers)
    .jpeg({ quality: 72 })
    .toBuffer();

  return `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;
}

async function resizeDataUrlImage(dataUrl: string, maxWidth: number, quality: number): Promise<string> {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const outputBuffer = await sharp(Buffer.from(base64Data, "base64"))
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    return `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;
  } catch (error) {
    console.error("[LastMileTestLog] failed to compress user photo for storage:", error);
    return dataUrl;
  }
}

interface StreetViewMetadata {
  status: string;
  date?: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
}

async function processEightDirectionTiles(
  lat: number,
  lng: number
): Promise<{
  tiles: { heading: number; base64: string }[];
  metadata: StreetViewMetadata;
}> {
  console.log("🎬 FETCHING 8 INDIVIDUAL DIRECTION TILES...");
  const headings = [0, 45, 90, 135, 180, 225, 270, 315];
  const tilesData: { heading: number; base64: string }[] = [];
  const apiKey = getGoogleMapsApiKey();
  const metadataUrl =
    `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${lat},${lng}&source=outdoor&key=${apiKey}`;
  const metadataResponse = await axios.get<StreetViewMetadata>(metadataUrl, {
    timeout: 20_000,
  });
  const metadata = metadataResponse.data;
  if (metadata.status !== "OK") {
    const metadataError = new Error(`Street View metadata returned ${metadata.status}.`);
    Object.assign(metadataError, { code: `STREET_VIEW_${metadata.status}` });
    throw metadataError;
  }

  const panoramaSelector = metadata.pano_id
    ? `pano=${encodeURIComponent(metadata.pano_id)}`
    : `location=${lat},${lng}`;

  for (const hd of headings) {
    const url =
      `https://maps.googleapis.com/maps/api/streetview?size=640x640&${panoramaSelector}` +
      `&heading=${hd}&fov=45&pitch=0&source=outdoor&return_error_code=true&key=${apiKey}`;
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 20_000 });
    const buffer = Buffer.from(response.data);
    tilesData.push({ heading: hd, base64: `data:image/jpeg;base64,${buffer.toString("base64")}` });
  }

  return { tiles: tilesData, metadata };
}
