# Buddy Walk Last Meters Localization Algorithm

## Purpose

Use visual localization only when a blind traveler is close enough to a verified destination. The system combines GPS, compass, Street View, the user's photo, and a destination name. It must report uncertainty instead of pretending a weak match is precise.

## Inputs

| Input | Source | Required use |
| --- | --- | --- |
| User photo | Phone camera | Match the traveler’s view to Street View. |
| Latitude, longitude, and horizontal accuracy | Phone location sensor | Coarse location and GPS confidence. |
| Phone compass | Phone heading sensor | The only source allowed to control a turn instruction. |
| Destination name | User text | Resolve the correct nearby Google Place. |
| Eight Street View views | Google Street View | 360-degree visual comparison at 45-degree intervals. |

## Pipeline

1. Resolve the destination with Google Places and rank candidates by relevance and distance from the user. Store the chosen place name, address, coordinates, and distance.
2. Run the approach gate. When the destination is beyond `LAST_METERS_EXACT_RADIUS_METERS` (currently 250 m), return rough compass/map guidance and do not run vision. Ask the traveler to try Last Meters again closer to the destination.
3. In exact mode, retrieve eight non-overlapping Street View images centered at 0, 45, 90, 135, 180, 225, 270, and 315 degrees. Store the panorama date and coordinates.
4. Independently match the user photo to the eight panorama views. Record the panorama heading only as visual evidence; it must never replace the phone compass.
5. Compare the snapped compass heading to the panorama heading. Agreement within 45 degrees increases confidence; disagreement lowers confidence and is saved for evaluation.
6. Independently locate the destination in the panorama. Accept it only if the visible heading agrees with the verified Google Place bearing. If it is not visible, only use a destination-focused Street View reference within 75 m; otherwise return to approach mode and request another photo.
7. Compute the turn using the phone compass heading and the verified target heading. Express the result as left, right, forward, or turn around.
8. Fuse evidence into a confidence score. GPS accuracy, user-photo panorama match, compass/panorama agreement, and destination verification each contribute evidence. If confidence is low, ask the traveler to stop safely and take another photo before moving forward.

## Recovery Rules

| Failure | Response |
| --- | --- |
| Google Places cannot verify a local destination | Ask for a more specific destination or address. |
| Destination is too far away | Use rough approach guidance only; skip vision. |
| User photo cannot match panorama | Continue only with the compass; lower confidence. |
| Compass missing | Do not calculate a turn. Capture the panorama result for research only. |
| Destination missing from panorama | Use destination reference only in the close range; otherwise guide the traveler closer and repeat. |
| Low confidence | Do not treat the result as confirmed. Stop safely, recapture, and repeat the pipeline. |

## Evaluation Data

Every Last Meters trial stores the user photo, panorama, place information, GPS accuracy, individual test steps, compass heading, panorama heading, heading difference, confidence score, final guidance, and reviewer notes. The dashboard and CSV export make it possible to compare compass and panorama localization separately.
