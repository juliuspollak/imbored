export default function HiveTileIcon({ size = 52, className = "", style, ...props }) {
  const cells = [
    [26, 12],
    [15, 19], [37, 19],
    [26, 26],
    [15, 33], [37, 33],
    [26, 40],
  ];

  return (
    <span
      className={`hive-tile-icon ${className}`.trim()}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
      {...props}
    >
      <svg className="hive-tile-icon__art" viewBox="0 0 52 52" role="presentation">
        <defs>
          <linearGradient id="hive-cell-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd95b" />
            <stop offset="0.58" stopColor="#f7b916" />
            <stop offset="1" stopColor="#d88a00" />
          </linearGradient>
          <linearGradient id="hive-cell-centre" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c97a00" />
            <stop offset="1" stopColor="#8e4b00" />
          </linearGradient>
          <filter id="hive-soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="2.2" stdDeviation="1.8" floodColor="#704000" floodOpacity="0.34" />
          </filter>
        </defs>

        <g className="hive-tile-icon__cluster" filter="url(#hive-soft-shadow)">
          {cells.map(([cx, cy], index) => {
            const points = Array.from({ length: 6 }, (_, pointIndex) => {
              const angle = (Math.PI / 180) * (60 * pointIndex - 30);
              return `${cx + 7.1 * Math.cos(angle)},${cy + 7.1 * Math.sin(angle)}`;
            }).join(" ");
            return (
              <polygon
                key={`${cx}-${cy}`}
                points={points}
                fill={index === 3 ? "url(#hive-cell-centre)" : "url(#hive-cell-gold)"}
                stroke="#6f4100"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
            );
          })}
          <path d="M22 7.5h8" stroke="#fff4b8" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
          <path d="M10.5 17.5l3.8-2.3" stroke="#fff4b8" strokeWidth="1.25" strokeLinecap="round" opacity="0.72" />
        </g>
      </svg>
    </span>
  );
}
