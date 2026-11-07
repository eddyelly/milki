'use client';

import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip } from 'react-leaflet';

/** Parcel location on OpenStreetMap; boundary polygon if surveyed. Loaded client-side only (see ParcelMapLazy). */
export default function ParcelMap({
  latitude,
  longitude,
  boundary,
  label,
}: {
  latitude: number;
  longitude: number;
  boundary: [number, number][] | null;
  label: string;
}) {
  // Boundaries are stored GeoJSON-style [lng, lat]; Leaflet wants [lat, lng].
  const ring = boundary?.map(([lng, lat]) => [lat, lng] as [number, number]);
  return (
    <MapContainer center={[latitude, longitude]} zoom={16} scrollWheelZoom={false} className="h-64 w-full" attributionControl>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {ring && ring.length >= 3 && <Polygon positions={ring} pathOptions={{ color: '#12805C', weight: 2, fillColor: '#E9B949', fillOpacity: 0.25 }} />}
      <CircleMarker center={[latitude, longitude]} radius={7} pathOptions={{ color: '#0B4F3C', weight: 2, fillColor: '#E9B949', fillOpacity: 1 }}>
        <Tooltip>{label}</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
