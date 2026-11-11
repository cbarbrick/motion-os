import { relayLogin, reply } from "../home-login.js";
import { homeLoginStore } from "../home-login-store.js";
export default async (request: Request) => {
  try {
    return await relayLogin(request, homeLoginStore());
  } catch {
    return reply({ error: "Sign-in is unavailable. Try again." }, 503);
  }
};
