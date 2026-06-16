import express from "express";
import { FeedbackController } from "../controllers/feedback";

const route = express.Router();
const feedbackController = new FeedbackController();

route.post("/", feedbackController.create);
route.get("/export.csv", feedbackController.exportCsv);
route.get("/", feedbackController.list);

export default route;
