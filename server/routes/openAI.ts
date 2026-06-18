import express from "express"
import {OpenAIController} from "../controllers/openAI";
import { TranscribeController } from "../controllers/transcribe";
const route = express.Router()

const openAIController = new OpenAIController();
const transcribeController = new TranscribeController();

route.post("/text", openAIController.textRequest)
route.post("/audio", openAIController.audioRequest)
route.post("/parseRequest", openAIController.parseUserRequest)
route.post(
  "/transcribe",
  express.raw({ type: "*/*", limit: "10mb" }),
  (req, res) => transcribeController.transcribe(req, res)
)
// route.post("/doorfrontPanorama", openAIController.doorfrontPanorama)

export default route;