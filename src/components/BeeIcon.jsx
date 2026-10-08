export default function BeeIcon({ size = 24, className = "", style, ...props }) {
  return (
    <svg
      className={`hive-bee-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={style}
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="10.8" cy="11" rx="5.3" ry="6.8" fill="rgba(255,255,255,.78)" stroke="currentColor" strokeWidth="1.35" transform="rotate(-29 10.8 11)" />
      <ellipse cx="21.2" cy="11" rx="5.3" ry="6.8" fill="rgba(255,255,255,.78)" stroke="currentColor" strokeWidth="1.35" transform="rotate(29 21.2 11)" />
      <ellipse cx="16" cy="18.2" rx="7.3" ry="8.9" fill="#F7B928" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.1 15.1h11.8M9.1 19.2h13.8M11 23.1h10" stroke="currentColor" strokeWidth="2.05" />
      <circle cx="13.5" cy="11.5" r="1.05" fill="currentColor" />
      <circle cx="18.5" cy="11.5" r="1.05" fill="currentColor" />
      <path d="M13 8.3 10.5 5M19 8.3 21.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <g className="hive-bee-halloween" aria-hidden="true">
        <path d="M8.2 8.2 15.7.8l4.1 7.4Z" fill="#27143d" stroke="#140a22" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M7.2 8.1h14.9c1.2 0 1.7.7 1 1.5-2.5 2.6-12.3 2.6-15.7 0-.8-.6-.8-1.5-.2-1.5Z" fill="#3a1c58" stroke="#140a22" strokeWidth="1" />
        <path d="M11.3 7.7h7.4" stroke="#f97316" strokeWidth="1.7" strokeLinecap="round" />
        <rect x="14.1" y="6.8" width="2.6" height="1.9" rx=".4" fill="#ffc857" />
        <path d="M13.5 14.5 15 16l1-1.6 1 1.6 1.5-1.5" fill="none" stroke="#5d2607" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m14.8 16.1.8 1.5M17.2 16.1l-.8 1.5" stroke="#fff8e7" strokeWidth=".9" strokeLinecap="round" />
      </g>
    </svg>
  );
}
