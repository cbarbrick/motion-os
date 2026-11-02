import { createRoot } from "react-dom/client";
import { App } from "./app";
import { homeLoginLaunch, homeLoginReturn } from "./home-login";
import { HomeLoginWindow } from "./home-login-view";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  homeLoginLaunch || homeLoginReturn ? <HomeLoginWindow /> : <App />,
);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
}
