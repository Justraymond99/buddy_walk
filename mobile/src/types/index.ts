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

export type RootStackParamList = {
  Welcome: undefined;
  Permissions: undefined;
  Waiver: undefined;
  Name: undefined;
  Main: undefined;
};
