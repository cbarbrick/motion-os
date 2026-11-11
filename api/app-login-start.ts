import handler from "../server/handlers/app-login-start.js";
import { endpoint } from "../server/http.js";
export default endpoint("app-login-start", 25, handler);
