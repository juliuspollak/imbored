import BeeIcon from "./BeeIcon.jsx";

export default function HiveTileIcon({ size = 52, className = "", style, ...props }) {
  return (
    <span
      className={`hive-tile-icon ${className}`.trim()}
      style={{ width:size, height:size, ...style }}
      aria-hidden="true"
      {...props}
    >
      <span className="hive-tile-icon__cells" />
      <BeeIcon size={Math.round(size * 0.82)} className="hive-tile-icon__bee" />
    </span>
  );
}
