/**
 * Overlapping avatar group (max 3 visible).
 * Props: members (array of {id, name, icon}), size (px), overlap (px, negative).
 */
export default function AvatarGroup({ members = [], size = 22, overlap = -6 }) {
  return (
    <div className="design-avatar-group" style={{ display: "flex", flexShrink: 0 }}>
      {members.slice(0, 3).map((member, index) => (
        <span
          key={member.id}
          title={member.name}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--color-avatar-bg)",
            border: `2px solid var(--color-avatar-border)`,
            marginLeft: index ? overlap : 0,
            zIndex: 3 - index,
            fontSize: Math.round(size * 0.5),
            display: "grid",
            placeItems: "center",
          }}
        >
          {member.icon || "🙂"}
        </span>
      ))}
    </div>
  );
}