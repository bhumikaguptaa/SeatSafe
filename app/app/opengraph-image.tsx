// OG image for every page: logo + tagline on the dark background (next/og, rendered at build time).
import { ImageResponse } from "next/og";

export const alt = "SeatSafe: your money only moves when the ticket does.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 88, background: "#0B0B0F", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #f16001, #fe1c80)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 800, color: "#0B0B0F" }}>S</div>
          <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1 }}>SeatSafe</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 64, fontWeight: 800, lineHeight: 1.1, maxWidth: 960 }}>Your money only moves when the ticket does.</div>
        <div style={{ marginTop: 28, fontSize: 28, color: "#A1A1AA" }}>Resale capped by the artist · Outside tickets held in escrow · Built on Solana</div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: "linear-gradient(90deg, #E5383B, #f16001, #fe1c80)" }} />
      </div>
    ),
    size,
  );
}
