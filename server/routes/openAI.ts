import express from "express"
import {OpenAIController} from "../controllers/openAI";
const route = express.Router()

const openAIController = new OpenAIController();

route.post("/text", openAIController.textRequest)
route.post("/audio", openAIController.audioRequest)
route.post("/parseRequest", openAIController.parseUserRequest)
route.post("/last-mile", (req, res) => openAIController.lastMileRequest(req, res))
// route.post("/doorfrontPanorama", openAIController.doorfrontPanorama)

export default route;
