import handler from "../server/handlers/calendar-sync.js";
import { endpoint } from "../server/http.js";
export default endpoint("calendar-sync", 60, handler);
