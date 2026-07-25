import React, { useState } from "react";

export default function FlagImage({ countryCode, countryName, emoji }) {
  const [failed, setFailed] = useState(false);
  const code = String(countryCode || "").toLowerCase();
  if (!code || failed) {
    return <span role="img" aria-label={`Flag of ${countryName || "country"}`} className="text-5xl leading-none">{emoji || countryName}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/w160/${code}.png`}
      srcSet={`https://flagcdn.com/w320/${code}.png 2x`}
      width="112"
      height="74"
      loading="eager"
      alt={`Flag of ${countryName}`}
      onError={() => setFailed(true)}
      style={{ objectFit: "cover", borderRadius: 8, border: "1px solid rgba(16,24,40,0.14)", boxShadow: "0 4px 12px rgba(16,24,40,0.12)" }}
    />
  );
}
