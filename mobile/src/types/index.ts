export interface CustomCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  orientation?: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  } | null;
}

export interface RequestData {
  text: string;
  image: string | null | (string | null)[];
  coords: CustomCoords | null;
  analytics?: {
    requestId?: string;
    installId?: string;
    sessionId?: string;
    conversationId?: string;
    resetHistory?: boolean;
    platform?: string;
    appVersion?: string;
    feature?: string;
  };
}

export interface LocationInterface {
  lat: number;
  lon: number;
}

export interface MessageInterface {
  input: string;
  output: string;
  imageURL: string;
  location: LocationInterface;
  flag?: boolean;
  flag_reason?: string;
}

export interface ChatLogInterface {
  messages: MessageInterface[];
  user?: string;
}

export interface NavLatLng {
  lat: number;
  lng: number;
}

export interface NavStep {
  index: number;
  instruction: string;
  distance: { text: string; value: number }; // value in meters
  duration: { text: string; value: number }; // value in seconds
  /**
   * Google maneuver token, e.g. "turn-left", "turn-right", "straight",
   * "uturn-left", "ramp-right", "arrive". Free-form when synthesized
   * client-side from natural-language directions.
   */
  maneuver: string;
  startLocation: NavLatLng;
  endLocation: NavLatLng;
  travelMode?: string;
}

export interface NavRoute {
  destination: { name?: string; address?: string } & NavLatLng;
  origin?: NavLatLng;
  totalDistance?: { text: string; value: number };
  totalDuration?: { text: string; value: number };
  steps: NavStep[];
  polyline?: string;
  travelMode?: string;
}

export type RootStackParamList = {
  Welcome: undefined;
  Auth: undefined;
  Permissions: undefined;
  Waiver: undefined;
  Name: undefined;
  Main: undefined;
  Companion: undefined;
  SavedPlaces: undefined;
};
