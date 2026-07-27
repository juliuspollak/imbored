import { animalById } from "./engine.js";

function FaceFrame({ animalId, size, children }) {
  const animal = animalById(animalId);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="50" cy="50" r="44" fill={`${animal.colour}20`} />
      <g stroke={animal.colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export default function AnimalFace({ animalId, size = 72 }) {
  switch (animalId) {
    case "fox":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <path fill="#FFF7ED" d="M25 28 39 37a32 32 0 0 1 22 0l14-9-5 25c0 18-9 29-20 29S30 71 30 53l-5-25Z" />
          <path d="m36 51 8 4m20-4-8 4M45 67h10m-5 0v5" />
          <circle cx="41" cy="52" r="2.5" fill="currentColor" stroke="none" />
          <circle cx="59" cy="52" r="2.5" fill="currentColor" stroke="none" />
        </FaceFrame>
      );
    case "panda":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <circle cx="32" cy="31" r="11" fill="#374151" />
          <circle cx="68" cy="31" r="11" fill="#374151" />
          <circle cx="50" cy="54" r="30" fill="#F9FAFB" />
          <ellipse cx="39" cy="51" rx="9" ry="12" fill="#374151" />
          <ellipse cx="61" cy="51" rx="9" ry="12" fill="#374151" />
          <circle cx="40" cy="50" r="2.5" fill="#F9FAFB" stroke="none" />
          <circle cx="60" cy="50" r="2.5" fill="#F9FAFB" stroke="none" />
          <path d="M45 66q5 5 10 0" />
        </FaceFrame>
      );
    case "owl":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <path fill="#FFF7ED" d="M27 32 39 38a28 28 0 0 1 22 0l12-6-3 20c0 18-8 31-20 31S30 70 30 52l-3-20Z" />
          <circle cx="39" cy="52" r="11" fill="#FDE68A" />
          <circle cx="61" cy="52" r="11" fill="#FDE68A" />
          <circle cx="39" cy="52" r="3" fill="#4B3621" stroke="none" />
          <circle cx="61" cy="52" r="3" fill="#4B3621" stroke="none" />
          <path fill="#E9A23B" d="m45 64 5 7 5-7Z" />
        </FaceFrame>
      );
    case "rabbit":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <ellipse cx="39" cy="27" rx="10" ry="23" fill="#F5F3FF" transform="rotate(-8 39 27)" />
          <ellipse cx="61" cy="27" rx="10" ry="23" fill="#F5F3FF" transform="rotate(8 61 27)" />
          <circle cx="50" cy="58" r="27" fill="#F5F3FF" />
          <circle cx="41" cy="55" r="2.5" fill="#55496E" stroke="none" />
          <circle cx="59" cy="55" r="2.5" fill="#55496E" stroke="none" />
          <path fill="#D99AB7" d="m45 64 5 4 5-4-5-3Z" />
          <path d="M50 68v5m0 0-5 3m5-3 5 3" />
        </FaceFrame>
      );
    case "lion":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <path fill="#F4C967" d="M50 16 60 24l13-1 3 13 9 9-7 11 1 13-13 4-8 10-12-6-12 6-8-10-13-4 1-13-7-11 9-9 3-13 13 1 8-8Z" />
          <circle cx="50" cy="53" r="25" fill="#FFF3D6" />
          <circle cx="41" cy="51" r="2.5" fill="#704A19" stroke="none" />
          <circle cx="59" cy="51" r="2.5" fill="#704A19" stroke="none" />
          <path d="m45 63 5 4 5-4m-5 4v6" />
        </FaceFrame>
      );
    case "frog":
      return (
        <FaceFrame animalId={animalId} size={size}>
          <circle cx="34" cy="38" r="13" fill="#DDF6E9" />
          <circle cx="66" cy="38" r="13" fill="#DDF6E9" />
          <path fill="#DDF6E9" d="M24 55c0-19 12-30 26-30s26 11 26 30c0 17-11 27-26 27S24 72 24 55Z" />
          <circle cx="34" cy="38" r="3" fill="#236247" stroke="none" />
          <circle cx="66" cy="38" r="3" fill="#236247" stroke="none" />
          <path d="M36 63q14 12 28 0" />
        </FaceFrame>
      );
    default:
      return null;
  }
}
