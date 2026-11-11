import handler from "../server/handlers/calendar-events.js";
import { endpoint } from "../server/http.js";
export default endpoint("calendar-events", 60, handler);
