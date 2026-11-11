import handler from "../server/handlers/push-notifications.js";
import { endpoint } from "../server/http.js";
export default endpoint("push-notifications", 60, handler);
