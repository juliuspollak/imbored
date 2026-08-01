import BeeIcon from "./BeeIcon.jsx";

export default function HiveTileIcon({ size = 52, className = "", ...props }) {
  return (
    <span
      className={`hive-tile-icon ${className}`.trim()}
      style={{ width:size, height:size }}
      aria-hidden="true"
      {...props}
    >
      <span className="hive-tile-icon__cells" />
      <BeeIcon size={Math.round(size * 0.58)} className="hive-tile-icon__bee" />
    </span>
  );
}
