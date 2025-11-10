import { CircleWallpaper } from "./components/CircleWallpaper";

export default function Home() {
  return (
    <main
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {[1, 2].map((index) => (
        <section
          key={index}
          style={{
            position: "relative",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "3rem 1.5rem",
            overflow: "hidden",
          }}
        >
          <CircleWallpaper
            cameraDistance={20}
            waveHeight={3}
            blurIntensity={.8}
            cameraRotation={{x: 0, y: 0, z: 0}}
            cameraTranslation={{x: 0, y: 0, z: 0}}
            style={{
              position: "absolute",
              inset: 0,
            }}
          />
        </section>
      ))}
    </main>
  );
}
