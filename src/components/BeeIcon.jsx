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
    </svg>
  );
}
