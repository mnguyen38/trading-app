import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        <span
          style={{
            color: "#fb923c",
            fontSize: 88,
            fontWeight: 700,
            fontFamily: "sans-serif",
            letterSpacing: -3,
          }}
        >
          TL
        </span>
      </div>
    ),
    { ...size },
  );
}
