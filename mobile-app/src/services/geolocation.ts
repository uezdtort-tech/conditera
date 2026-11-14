/**
 * Geolocation service — find nearby confectioners.
 *
 * Uses expo-location to get user's coordinates, then calculates distance
 * to each confectioner using the Haversine formula.
 *
 * Confectioner's coordinates come from the `location` Json field in the DB
 * (see schema.prisma → Confectioner.location with lat/lng).
 */
import * as Location from "expo-location";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ConfectionerWithDistance {
  id: string;
  businessName: string;
  avatar: string;
  city: string;
  rating: number;
  reviewsCount: number;
  ordersCount: number;
  verified: boolean;
  specialization: string[];
  location: {
    lat?: number;
    lng?: number;
    city?: string;
    region?: string;
    serviceRadiusKm?: number;
    deliveryCities?: string[];
  };
  /** Calculated distance in km (null if confectioner has no coords) */
  distanceKm: number | null;
  /** Whether user is within service radius */
  inServiceArea: boolean;
}

/**
 * Request foreground location permission.
 * Returns true if granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === "granted";
}

/**
 * Get current location with high accuracy.
 * Throws if permission not granted or location unavailable.
 */
export async function getCurrentLocation(): Promise<Coordinates> {
  const granted = await requestLocationPermission();
  if (!granted) {
    throw new Error("Геолокация не разрешена");
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

/**
 * Haversine formula — distance between two coordinates in km.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format distance for display.
 * <1 km → meters
 * >=1 km → kilometers with 1 decimal
 */
export function formatDistance(km: number | null): string {
  if (km === null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} м`;
  if (km < 10) return `${km.toFixed(1)} км`;
  return `${Math.round(km)} км`;
}

/**
 * Sort confectioners by distance from user.
 * Those without coordinates go to the end.
 */
export function sortByDistance(
  confectioners: ConfectionerWithDistance[]
): ConfectionerWithDistance[] {
  return [...confectioners].sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null) return 0;
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

/**
 * Filter confectioners within user's service area.
 */
export function filterInServiceArea(
  confectioners: ConfectionerWithDistance[]
): ConfectionerWithDistance[] {
  return confectioners.filter((c) => c.inServiceArea);
}

/**
 * Add distance + inServiceArea to each confectioner based on user's location.
 */
export function annotateWithDistance(
  confectioners: Array<{
    id: string;
    businessName: string;
    avatar: string;
    city: string;
    rating: number;
    reviewsCount: number;
    ordersCount: number;
    verified: boolean;
    specialization: string[];
    location: Record<string, unknown>;
  }>,
  userCoords: Coordinates
): ConfectionerWithDistance[] {
  return confectioners.map((c) => {
    const loc = c.location as {
      lat?: number;
      lng?: number;
      serviceRadiusKm?: number;
    };
    const distanceKm =
      typeof loc.lat === "number" && typeof loc.lng === "number"
        ? calculateDistance(userCoords.latitude, userCoords.longitude, loc.lat, loc.lng)
        : null;
    const inServiceArea =
      distanceKm !== null &&
      typeof loc.serviceRadiusKm === "number" &&
      distanceKm <= loc.serviceRadiusKm;

    return {
      ...c,
      location: loc as ConfectionerWithDistance["location"],
      distanceKm,
      inServiceArea,
    };
  });
}
