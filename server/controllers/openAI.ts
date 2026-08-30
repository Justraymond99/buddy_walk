import {OpenAIService} from "../services/openAI";
import { GeminiService } from "../services/gemini";
import { LastMileService } from "../services/lastMile";
import {textRequestBody} from "../types";
import { Request, Response } from "express";
import { getPanoramaData } from "../services/doorfront"

const openAIService = new OpenAIService();
const lastMileService = new LastMileService();
// const openAIService = new GeminiService();

export class OpenAIController {

  async parseUserRequest(req:Request, res:Response) {
    const {text, lat, lng} = req.body
    await openAIService.parseUserRequest({req,res}, text, lat, lng)
  }

  async textRequest(req: Request,
                    res: Response): Promise<void> {
    const body: textRequestBody = req.body
    await openAIService.textRequest({req,res}, body)

  }

  async audioRequest(req: Request,
                     res: Response): Promise<void> {
    const {text}= req.body

    await openAIService.audioRequest({req,res}, text)
  }

  async doorfrontPanorama(req: Request,
                     res: Response): Promise<void> {
    const {address}= req.body

    await getPanoramaData({req,res}, address)
  }

  async lastMileRequest(req: Request, res: Response) {
    try {
      const { lat, lng, image, destination } = req.body;
      const validCoordinates = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
      if (!validCoordinates || !image || !destination?.trim()) {
        return res.status(400).json({ error: "Missing or invalid required fields" });
      }
      if (!process.env.OPENAI_API_KEY?.trim() || !process.env.GOOGLE_API_KEY?.trim()) {
        return res.status(503).json({
          error: "Last Meters requires OPENAI_API_KEY and GOOGLE_API_KEY on this backend.",
        });
      }
      await lastMileService.handle(
        { req, res },
        Number(lat),
        Number(lng),
        image,
        destination.trim(),
      );
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
