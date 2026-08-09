import { Calculator } from "lucide-react";
import { priceGuide } from "../lib/rewardPricing.js";

// Turns the live scoring rules into "what should this reward cost?".
//
// Derived rather than hardcoded, so an admin who edits the rules sees the
// prices move with them instead of following a stale note. AdminRewards passes
// its unsaved edits straight in, which makes it a what-if calculator too.
export default function RewardPricingGuide({ rules, challengeGames = 6, compact = false }) {
  const guide = priceGuide(rules, challengeGames);
  const weekly = guide.weekly.total;

  return (
    <section
      style={{
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--color-border)",
        background: "var(--color-surface-elevated)",
        padding: compact ? "var(--space-3)" : "var(--space-4)",
      }}
    >
      <h3 style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: `0 0 ${compact ? "var(--space-2)" : "var(--space-3)"}`, color: "var(--color-text-primary)", fontSize: "var(--text-body-secondary-size)", fontWeight: 700 }}>
        <Calculator size={15} style={{ color: "var(--color-primary)" }} />
        What should this cost?
      </h3>

      <p style={{ margin: "0 0 var(--space-3)", color: "var(--color-text-secondary)", fontSize: "var(--text-caption-size)", lineHeight: "var(--text-body-line)" }}>
        Playing well every day for a week — all {guide.weekly.challengeGames} challenge games plus the rewarded practice rounds — earns about{" "}
        <strong style={{ color: "var(--color-text-primary)" }}>{weekly.toLocaleString()} points</strong>.
        That week is worth a <strong style={{ color: "var(--color-text-primary)" }}>$5 chocolate</strong>, so price everything else at
        roughly <strong style={{ color: "var(--color-text-primary)" }}>{guide.perDollar} points per dollar</strong>.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-caption-size)" }}>
          <thead>
            <tr style={{ color: "var(--color-text-secondary)", textAlign: "left" }}>
              <th scope="col" style={{ padding: "4px 8px 4px 0", fontWeight: 600 }}>Real value</th>
              <th scope="col" style={{ padding: "4px 8px", fontWeight: 600, textAlign: "right" }}>Points</th>
              <th scope="col" style={{ padding: "4px 0 4px 8px", fontWeight: 600, textAlign: "right" }}>Typical wait</th>
            </tr>
          </thead>
          <tbody>
            {guide.rows.map((row) => {
              const isAnchor = row.dollars === 5;
              return (
                <tr
                  key={row.dollars}
                  style={{
                    borderTop: "1px solid var(--color-border)",
                    background: isAnchor ? "var(--color-primary-subtle)" : "transparent",
                    color: "var(--color-text-primary)",
                  }}
                >
                  <td style={{ padding: "6px 8px 6px 0", fontWeight: isAnchor ? 700 : 500 }}>
                    ${row.dollars}
                    {isAnchor && <span style={{ marginLeft: 6, color: "var(--color-primary)", fontWeight: 600 }}>chocolate</span>}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: isAnchor ? 700 : 500 }}>
                    {row.points.toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 0 6px 8px", textAlign: "right", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {row.averageDays} days
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ margin: "var(--space-3) 0 0", color: "var(--color-text-muted)", fontSize: "var(--text-caption-size)", lineHeight: "var(--text-body-line)" }}>
        Wait times assume an average player, who earns about 80% of a good week. These figures follow the scoring rules,
        so they move if you change them.
      </p>
    </section>
  );
}
