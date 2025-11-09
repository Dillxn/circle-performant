import { CircleWallpaper } from "./components/CircleWallpaper";

export default function Home() {
  return (
    <main
      style={{
        position: "relative",
        width: "100%",
        minHeight: "100vh",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CircleWallpaper />
    </main>
  );
}
