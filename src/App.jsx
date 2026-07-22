import { useState } from "react";
import Home from "./Home.jsx";
import QueensGame from "./games/Queens.jsx";
import TangoGame from "./games/Tango.jsx";
import ZipGame from "./games/Zip.jsx";
import { ArrowLeft } from "lucide-react";

const GAME_COMPONENTS = {
  queens: QueensGame,
  tango: TangoGame,
  zip: ZipGame,
};

export default function App() {
  const [active, setActive] = useState(null); // null = home

  if (!active) {
    return <Home onSelect={setActive} />;
  }

  const Current = GAME_COMPONENTS[active];

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setActive(null)}
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 50,
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(16,24,40,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#1B2129",
        }}
        aria-label="Back to all games"
      >
        <ArrowLeft size={18} />
      </button>
      <Current />
    </div>
  );
}
