import express from "express";
import { OpenAIController } from "../controllers/openAI";
import { TranscribeController } from "../controllers/transcribe";
import axios from "axios";
import OpenAI from "openai";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const route = express.Router();
const openAIController = new OpenAIController();
const transcribeController = new TranscribeController();

route.post("/text", openAIController.textRequest)
route.post("/audio", openAIController.audioRequest)
route.post("/parseRequest", openAIController.parseUserRequest)
route.post("/last-mile", (req, res) => openAIController.lastMileRequest(req, res));
route.post(
  "/transcribe",
  express.raw({ type: "*/*", limit: "10mb" }),
  (req, res) => transcribeController.transcribe(req, res)
)

export default route;