import { privateStore } from "./private-store.js";
export function homeLoginStore() {
  return privateStore("motion-app-login");
}
