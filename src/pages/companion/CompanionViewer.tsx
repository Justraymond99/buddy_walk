import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

type Snapshot = {
  active: boolean;
  displayName?: string | null;
  lat?: number | null;
  lon?: number | null;
  accuracy?: number | null;
  lastUpdate?: string | null;
};

function sanitizeToken(raw?: string | null): string {
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

function formatRelative(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor(Math.max(0, Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ago`;
}

async function loadLeaflet(): Promise<{
  map: (el: HTMLElement) => { setView: (c: unknown, z: number) => void; getZoom: () => number; remove: () => void };
  tileLayer: (url: string, opts: object) => { addTo: (map: unknown) => void };
  marker: (c: unknown) => { addTo: (map: unknown) => unknown; setLatLng: (c: unknown) => void };
  circle: (c: unknown, opts: object) => { addTo: (map: unknown) => unknown; setLatLng: (c: unknown) => void; setRadius: (r: number) => void };
}> {
  const win = window as typeof window & {
    L?: {
      map: (el: HTMLElement) => { setView: (c: unknown, z: number) => void; getZoom: () => number; remove: () => void };
      tileLayer: (url: string, opts: object) => { addTo: (map: unknown) => void };
      marker: (c: unknown) => { addTo: (map: unknown) => unknown; setLatLng: (c: unknown) => void };
      circle: (c: unknown, opts: object) => { addTo: (map: unknown) => unknown; setLatLng: (c: unknown) => void; setRadius: (r: number) => void };
    };
  };
  if (win.L) return win.L;

  if (!document.querySelector('link[data-leaflet-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.setAttribute('data-leaflet-css', '1');
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-leaflet-js]')) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.setAttribute('data-leaflet-js', '1');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load map library'));
      document.body.appendChild(script);
    });
  }

  if (!win.L) throw new Error('Leaflet unavailable');
  return win.L;
}

export default function CompanionViewer() {
  const { token: paramToken } = useParams<{ token?: string }>();
  const [searchParams] = useSearchParams();
  const token = sanitizeToken(paramToken ?? searchParams.get('token'));

  const mapRef = useRef<HTMLDivElement>(null);
  const mapLayerRef = useRef<{
    map: { setView: (c: unknown, z: number) => void; getZoom: () => number; remove: () => void };
    marker: { setLatLng: (c: unknown) => void };
    circle: { setLatLng: (c: unknown) => void; setRadius: (r: number) => void } | null;
    fitOnce: boolean;
  } | null>(null);

  const [title, setTitle] = useState('Buddy Walk – Live Location');
  const [status, setStatus] = useState('Connecting…');
  const [statusKind, setStatusKind] = useState<'live' | 'stale' | 'ended' | ''>('');
  const [updated, setUpdated] = useState('');
  const [empty, setEmpty] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('Invalid link');
      setStatusKind('ended');
      setEmpty('This link is missing a session token.');
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          `/api/companion/snapshot?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/html')) {
          setStatus('Service unavailable');
          setStatusKind('ended');
          setEmpty(
            'The companion API is not available on this server yet. ' +
              'Redeploy the latest backend to buddywalk.app.'
          );
          return;
        }
        if (res.status === 404) {
          setStatus('Sharing ended');
          setStatusKind('ended');
          setEmpty('This sharing link has ended or expired.');
          return;
        }
        if (!res.ok) {
          setStatus('Connection issue');
          setStatusKind('stale');
          return;
        }

        const data = (await res.json()) as Snapshot;
        if (cancelled) return;

        if (data.displayName) setTitle(`${data.displayName} – Live Location`);

        if (!data.active) {
          setStatus('Sharing ended');
          setStatusKind('ended');
          setUpdated(data.lastUpdate ? `last seen ${formatRelative(data.lastUpdate)}` : '');
          return;
        }

        if (data.lat == null || data.lon == null) {
          setStatus('Waiting for first GPS fix');
          setStatusKind('live');
          setUpdated('');
          setEmpty('Sharing is live, waiting for the first GPS update…');
          return;
        }

        setEmpty(null);
        const freshMs = Date.now() - new Date(data.lastUpdate ?? 0).getTime();
        if (freshMs > 60_000) {
          setStatus(`Last update ${formatRelative(data.lastUpdate)}`);
          setStatusKind('stale');
        } else {
          setStatus('Live');
          setStatusKind('live');
        }
        setUpdated(data.lastUpdate ? `updated ${formatRelative(data.lastUpdate)}` : '');

        const L = await loadLeaflet();
        if (cancelled || !mapRef.current) return;

        const latlng: [number, number] = [data.lat, data.lon];
        if (!mapLayerRef.current) {
          const map = L.map(mapRef.current).setView(latlng, 17);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
          }).addTo(map);
          const marker = L.marker(latlng).addTo(map) as {
            setLatLng: (c: unknown) => void;
          };
          let circle: { setLatLng: (c: unknown) => void; setRadius: (r: number) => void } | null = null;
          if (data.accuracy && data.accuracy > 0) {
            circle = L.circle(latlng, {
              radius: data.accuracy,
              color: '#2ecc71',
              fillColor: '#2ecc71',
              fillOpacity: 0.12,
              weight: 1,
            }).addTo(map);
          }
          mapLayerRef.current = { map, marker, circle, fitOnce: true };
        } else {
          mapLayerRef.current.marker.setLatLng(latlng);
          if (data.accuracy && data.accuracy > 0) {
            if (!mapLayerRef.current.circle) {
              mapLayerRef.current.circle = L.circle(latlng, {
                radius: data.accuracy,
                color: '#2ecc71',
                fillColor: '#2ecc71',
                fillOpacity: 0.12,
                weight: 1,
              }).addTo(mapLayerRef.current.map);
            } else {
              mapLayerRef.current.circle.setLatLng(latlng);
              mapLayerRef.current.circle.setRadius(data.accuracy);
            }
          }
          if (!mapLayerRef.current.fitOnce) {
            mapLayerRef.current.map.setView(latlng, 17);
            mapLayerRef.current.fitOnce = true;
          }
        }
      } catch {
        if (!cancelled) {
          setStatus('Cannot reach server');
          setEmpty(
            'This live map link cannot reach Buddy Walk right now. ' +
              'Ask them to open Companion Mode in the app and share a new Google Maps link.'
          );
        }
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      mapLayerRef.current?.map.remove();
      mapLayerRef.current = null;
    };
  }, [token]);

  const pillClass =
    statusKind === 'live' ? 'live' : statusKind === 'stale' ? 'stale' : statusKind === 'ended' ? 'ended' : '';

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.sub}>
          <span style={{ ...styles.pill, ...(pillClass === 'live' ? styles.pillLive : {}), ...(pillClass === 'stale' ? styles.pillStale : {}), ...(pillClass === 'ended' ? styles.pillEnded : {}) }}>
            <span style={styles.dot} />
            {status}
          </span>
          {updated ? <span style={styles.updated}> · {updated}</span> : null}
        </p>
      </header>
      {empty ? (
        <div style={styles.empty}>{empty}</div>
      ) : (
        <div ref={mapRef} style={styles.map} />
      )}
      <footer style={styles.footer}>
        Map data © OpenStreetMap contributors. Refreshes every 5 seconds.
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    margin: 0,
    background: '#0e1116',
    color: '#f6f7fb',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  header: {
    padding: '14px 18px',
    background: '#161b22',
    borderBottom: '1px solid #2a313c',
  },
  title: { margin: 0, fontSize: '1.05rem', fontWeight: 700 },
  sub: { margin: '4px 0 0', fontSize: '0.85rem', color: '#aab1bd' },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: '0.75rem',
    fontWeight: 600,
    background: '#2a313c',
  },
  pillLive: {},
  pillStale: {},
  pillEnded: {},
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#888',
    display: 'inline-block',
  },
  updated: { color: '#aab1bd' },
  map: { flex: 1, width: '100%', minHeight: 280, background: '#1a1f29' },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    textAlign: 'center',
    color: '#aab1bd',
    lineHeight: 1.5,
  },
  footer: {
    padding: '8px 14px',
    background: '#161b22',
    borderTop: '1px solid #2a313c',
    fontSize: '0.75rem',
    color: '#8a93a3',
    textAlign: 'center',
  },
};
