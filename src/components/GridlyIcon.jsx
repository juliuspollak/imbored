export default function GridlyIcon({ size = 24, className = "", style, ...props }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={style}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M6 25V18h8V8h12v9h-6v9"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="25" r="3.2" fill="var(--color-surface, white)" stroke="currentColor" strokeWidth="2" />
      <circle cx="26" cy="8" r="3.2" fill="var(--color-surface, white)" stroke="currentColor" strokeWidth="2" />
      <rect x="17.2" y="22.8" width="5.6" height="5.6" rx="1.2" fill="currentColor" opacity=".32" />
      <text x="6" y="26.7" textAnchor="middle" fontSize="5" fontWeight="800" fill="currentColor">1</text>
      <text x="26" y="9.7" textAnchor="middle" fontSize="5" fontWeight="800" fill="currentColor">4</text>
    </svg>
  );
}
