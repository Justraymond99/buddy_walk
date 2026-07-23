import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNearbyPlaceQuery,
  selectNearbyPlaceCandidate,
} from "../../server/utils/nearbyPlaces";

const manhattan = { lat: 40.758, lng: -73.9855 };

test("normalizeNearbyPlaceQuery removes proximity filler", () => {
  assert.equal(normalizeNearbyPlaceQuery("closest FedEx near me"), "FedEx");
  assert.equal(normalizeNearbyPlaceQuery("Nearby pharmacy"), "pharmacy");
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
