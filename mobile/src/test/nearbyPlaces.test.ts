import assert from "node:assert/strict";
import test from "node:test";
import {
  describeNearbyPlaceCandidates,
  extractNearbyPlaceQuery,
  isNearbyPlaceCandidateRelevant,
  looksLikeBareDestinationQuery,
  MAX_LOCAL_PLACE_DISTANCE_METERS,
  mergeNearbyPlaceCandidates,
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

test("chain lookups pick the nearest branch after merging both searches", () => {
  // Nearby Search returned only a far branch; Text Search found the one at the user.
  const nearby = [
    {
      place_id: "far",
      name: "McDonald's",
      geometry: { location: { lat: 40.7175, lng: -74.0105 } },
    },
  ];
  const text = [
    {
      place_id: "far",
      name: "McDonald's",
      geometry: { location: { lat: 40.7175, lng: -74.0105 } },
    },
    {
      place_id: "here",
      name: "McDonald's",
      formatted_address: "West St, New York",
      geometry: { location: { lat: 40.7148, lng: -74.0138 } },
    },
  ];
  const merged = mergeNearbyPlaceCandidates(nearby, text);
  assert.deepEqual(merged.map((c) => c.place_id), ["far", "here"]);

  const ranked = selectNearbyPlaceCandidates(
    merged.filter((c) => isNearbyPlaceCandidateRelevant(c, "McDonald's")),
    { lat: 40.71473, lng: -74.01396 }
  );
  assert.equal(ranked[0].place_id, "here");
  assert.ok(ranked[0].distanceMeters < 30);
  assert.match(describeNearbyPlaceCandidates(ranked), /^1\. McDonald's - West St, New York - \d+ m\n2\. McDonald's/);
});

test("permanently closed places are never selected", () => {
  const selected = selectNearbyPlaceCandidate(
    [
      {
        place_id: "closed",
        name: "FedEx Midtown",
        business_status: "CLOSED_PERMANENTLY",
        geometry: { location: { lat: 40.7581, lng: -73.9855 } },
      },
      {
        place_id: "open",
        name: "FedEx Downtown",
        business_status: "OPERATIONAL",
        geometry: { location: { lat: 40.759, lng: -73.984 } },
      },
    ],
    manhattan
  );
  assert.equal(selected?.place_id, "open");
  assert.equal(describeNearbyPlaceCandidates([]), "NO_RELEVANT_CANDIDATES");
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
