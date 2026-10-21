/** "Online now" (green, pulsing) or "Last seen 12m ago" / "Never opened", with the exact time on hover. */
export function lastSeenText(at: string | null) {
  if (!at) return 'Never opened';
  const m = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (m < 1) return 'Last seen just now';
  if (m < 60) return `Last seen ${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `Last seen ${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `Last seen ${d}d ago`;
  return `Last seen ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
export function Presence({ online, lastSeen, className = '' }: { online: boolean; lastSeen: string | null; className?: string }) {
  if (online) return <span className={`bf-online ${className}`} title="Their portal is open right now">Online now</span>;
  return <span className={`bf-offline ${className}`} title={lastSeen ? `Last online ${new Date(lastSeen).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Has not opened their portal yet'}>{lastSeenText(lastSeen)}</span>;
}
