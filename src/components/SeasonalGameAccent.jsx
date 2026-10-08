import React from "react";

function SpiderWeb() {
  return (
    <svg className="seasonal-game-accent__svg" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".72">
        <path d="M5 5 31 31M59 5 33 31M5 59 31 33M59 59 33 33" />
        <path d="M32 1v62M1 32h62" opacity=".5" />
        <path d="M13 13c11 6 27 6 38 0M13 51c11-6 27-6 38 0M13 13c6 11 6 27 0 38M51 13c-6 11-6 27 0 38" opacity=".55" />
        <circle cx="32" cy="32" r="10" opacity=".45" />
      </g>
      <g className="seasonal-game-accent__spider" transform="translate(41 37)">
        <circle cx="0" cy="0" r="4.6" fill="#1f1635" />
        <circle cx="0" cy="-5.2" r="3" fill="#2c2145" />
        <g fill="none" stroke="#1f1635" strokeWidth="1.6" strokeLinecap="round">
          <path d="M-3-2-8-6M3-2 8-6M-4 1-9 3M4 1 9 3M-3 4-7 9M3 4 7 9" />
        </g>
        <circle cx="-1" cy="-5.7" r=".55" fill="#f97316" />
        <circle cx="1" cy="-5.7" r=".55" fill="#f97316" />
      </g>
    </svg>
  );
}

function Ghost() {
  return (
    <svg className="seasonal-game-accent__svg" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M17 54V29c0-11 6.7-19 15-19s15 8 15 19v25l-5-4-5 4-5-4-5 4-5-4-5 4Z" fill="#fff" stroke="#d8d5e6" strokeWidth="2" />
      <ellipse cx="27" cy="29" rx="2.4" ry="3.2" fill="#282139" />
      <ellipse cx="38" cy="29" rx="2.4" ry="3.2" fill="#282139" />
      <path d="M29 38c2 2 4 2 6 0" fill="none" stroke="#282139" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 20c3-5 7-8 13-9" fill="none" stroke="#f97316" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

function PumpkinPin() {
  return (
    <svg className="seasonal-game-accent__svg" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 5c2 5 1 8-2 11" fill="none" stroke="#47652e" strokeWidth="3" strokeLinecap="round" />
      <path d="M31 16c-11 0-18 7-18 17 0 12 9 19 19 26 10-7 19-14 19-26 0-10-8-17-20-17Z" fill="#f97316" stroke="#b84d08" strokeWidth="2" />
      <path d="M23 20c-4 6-4 17 1 26M41 20c4 6 4 17-1 26M32 18v34" fill="none" stroke="#dd5f0c" strokeWidth="1.8" opacity=".8" />
      <path d="m22 31 5-3 4 4-5 2Zm20 0-5-3-4 4 5 2Z" fill="#30243c" />
      <path d="M23 39c5 4 13 4 18 0l-4 6-5-3-5 3Z" fill="#30243c" />
    </svg>
  );
}

function Bats() {
  return (
    <svg className="seasonal-game-accent__svg" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="#2a1d3f">
        <path d="M9 24c5-8 11-7 15-3 2-4 6-6 9-4-1 5-4 8-8 10-4 2-9 2-16-3Z" />
        <path d="M35 39c4-6 9-6 12-3 2-3 5-4 8-3-1 4-3 7-7 8-4 2-8 1-13-2Z" opacity=".85" />
      </g>
      <circle cx="22" cy="23" r="1" fill="#f97316" />
      <circle cx="47" cy="38" r=".8" fill="#f97316" />
      <path d="M10 52c9-9 23-13 42-12" fill="none" stroke="#7c3aed" strokeWidth="1.4" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

export default function SeasonalGameAccent({ game }) {
  let artwork = null;
  if (game === "gridly") artwork = <SpiderWeb />;
  else if (game === "minisudoku") artwork = <Ghost />;
  else if (game === "geo") artwork = <PumpkinPin />;
  else if (game === "zoom") artwork = <Bats />;
  if (!artwork) return null;

  return (
    <span className={`seasonal-game-accent seasonal-game-accent--${game}`} aria-hidden="true">
      {artwork}
    </span>
  );
}
