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
        d="M6 7h12.5c4.8 0 6.2 6.1 1.8 8.2l-8.6 4.1c-4.2 2-2.7 6.7 1.5 6.7H26"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="7" r="3.4" fill="var(--color-surface, white)" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="26" cy="26" r="3.4" fill="currentColor" />
      <circle cx="26" cy="26" r="1.25" fill="var(--color-surface, white)" opacity=".9" />
      <rect x="21.5" y="10.5" width="5.8" height="5.8" rx="1.6" fill="var(--color-surface, white)" stroke="currentColor" strokeWidth="1.8" transform="rotate(12 24.4 13.4)" />
    </svg>
  );
}
