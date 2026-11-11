import handler from "../server/handlers/app-login.js";
import { endpoint } from "../server/http.js";
export default endpoint("app-login", 600, handler);
