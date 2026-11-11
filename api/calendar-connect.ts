import handler from "../server/handlers/calendar-connect.js";
import { endpoint } from "../server/http.js";
export default endpoint("calendar-connect", 60, handler);
