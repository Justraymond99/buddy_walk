import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

/** Legacy share links used /companion/:token — redirect to the static map viewer. */
export default function CompanionLinkRedirect() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    const safe = token.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return;
    const target = `/companion-viewer.html?token=${encodeURIComponent(safe)}`;
    window.location.replace(target);
  }, [token]);

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      Opening live location map…
    </div>
  );
}
