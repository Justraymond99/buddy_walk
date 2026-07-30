import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNearbyPlaceQuery,
  isNearbyPlaceCandidateRelevant,
  looksLikeBareDestinationQuery,
  MAX_LOCAL_PLACE_DISTANCE_METERS,
  nearbyPlaceDistanceMeters,
  normalizeNearbyPlaceQuery,
  selectNearbyPlaceCandidate,
  selectNearbyPlaceCandidates,
} from "../../server/utils/nearbyPlaces";

const manhattan = { lat: 40.758, lng: -73.9855 };

test("normalizeNearbyPlaceQuery removes proximity filler", () => {
  assert.equal(normalizeNearbyPlaceQuery("closest FedEx near me"), "FedEx");
  assert.equal(normalizeNearbyPlaceQuery("Nearby pharmacy"), "pharmacy");
});

test("extractNearbyPlaceQuery isolates destinations from local requests", () => {
  assert.equal(
    extractNearbyPlaceQuery("Give me walking directions to FedEx near me."),
    "FedEx"
  );
  assert.equal(extractNearbyPlaceQuery("Where is the nearest Whole Foods?"), "Whole Foods");
  assert.equal(extractNearbyPlaceQuery("Find a pharmacy nearby"), "pharmacy");
  assert.equal(extractNearbyPlaceQuery("What is near me?"), null);
  assert.equal(extractNearbyPlaceQuery("Tell me about package delivery"), null);
});

test("extractNearbyPlaceQuery only accepts bare destinations when explicitly allowed", () => {
  assert.equal(extractNearbyPlaceQuery("FedEx"), null);
  assert.equal(extractNearbyPlaceQuery("FedEx", true), "FedEx");
  assert.equal(extractNearbyPlaceQuery("38 Warren St", true), "38 Warren St");
  assert.equal(extractNearbyPlaceQuery("Hello", true), null);
  assert.equal(extractNearbyPlaceQuery("What is FedEx?", true), null);
});

test("looksLikeBareDestinationQuery detects safe destination-shaped text", () => {
  assert.equal(looksLikeBareDestinationQuery("FedEx"), true);
  assert.equal(looksLikeBareDestinationQuery("Whole Foods"), true);
  assert.equal(looksLikeBareDestinationQuery("38 Warren St"), true);
  assert.equal(looksLikeBareDestinationQuery("Hello"), false);
  assert.equal(looksLikeBareDestinationQuery("What is FedEx?"), false);
});

test("isNearbyPlaceCandidateRelevant rejects fuzzy brand substitutions", () => {
  assert.equal(
    isNearbyPlaceCandidateRelevant(
      { name: "Burger Man", types: ["restaurant"], vicinity: "7th Avenue" },
      "Whataburger"
    ),
    false
  );
  assert.equal(
    isNearbyPlaceCandidateRelevant(
      { name: "FedEx Office Print & Ship Center", types: ["store"] },
      "FedEx"
    ),
    true
  );
  assert.equal(
    isNearbyPlaceCandidateRelevant(
      { name: "CVS", types: ["drugstore", "pharmacy", "store"] },
      "pharmacy"
    ),
    true
  );
});

test("selectNearbyPlaceCandidate chooses the nearest valid result", () => {
  const selected = selectNearbyPlaceCandidate(
    [
      {
        place_id: "farther",
        name: "FedEx Downtown",
        geometry: { location: { lat: 40.72, lng: -74.0 } },
      },
      {
        place_id: "near",
        name: "FedEx Midtown",
        geometry: { location: { lat: 40.759, lng: -73.984 } },
      },
    ],
    manhattan
  );

  assert.equal(selected?.place_id, "near");
  assert.ok((selected?.distanceMeters ?? Infinity) < 500);
});

test("selectNearbyPlaceCandidate rejects global and malformed results", () => {
  assert.equal(
    selectNearbyPlaceCandidate(
      [
        {
          place_id: "texas",
          name: "FedEx El Paso",
          geometry: { location: { lat: 31.7619, lng: -106.485 } },
        },
      ],
      manhattan
    ),
    null
  );
  assert.equal(
    selectNearbyPlaceCandidate([{ place_id: "missing-location" }], manhattan),
    null
  );
});

test("default place selection rejects results beyond the local boundary", () => {
  const sixKilometersNorth = {
    place_id: "outside-local-area",
    name: "FedEx outside local area",
    geometry: { location: { lat: 40.812, lng: -73.9855 } },
  };

  assert.equal(
    selectNearbyPlaceCandidate([sixKilometersNorth], manhattan),
    null
  );
});

test("local place ranking filters distant results before returning options", () => {
  const origin = { lat: 40.758, lng: -73.9855 };
  const local = {
    name: "Local store",
    geometry: { location: { lat: 40.759, lng: -73.9855 } },
  };
  const distant = {
    name: "Different-state result",
    geometry: { location: { lat: 41.2, lng: -74.5 } },
  };

  const ranked = selectNearbyPlaceCandidates(
    [distant, local],
    origin,
    MAX_LOCAL_PLACE_DISTANCE_METERS
  );

  assert.deepEqual(ranked.map((place) => place.name), ["Local store"]);
  assert.ok(nearbyPlaceDistanceMeters(origin, origin) < 1);
});
