import express from "express";
import { TelemetryController } from "../controllers/telemetry";

const route = express.Router();
const telemetryController = new TelemetryController();

route.post("/events", telemetryController.recordEvents);
route.get("/summary", telemetryController.summary);
route.get("/events.csv", telemetryController.exportCsv);
route.get("/ai-requests.csv", telemetryController.exportAiRequestsCsv);

export default route;
