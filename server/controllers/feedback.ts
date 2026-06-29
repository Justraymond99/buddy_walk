import { Request, Response } from "express";
import { FeedbackService } from "../services/feedback";
import { buildDateFilter, isAdminAuthorized, parseLimit } from "../utils/adminAuth";
import { toCsv } from "../utils/csv";

const feedbackService = new FeedbackService();

const FEEDBACK_CSV_COLUMNS = [
  "date",
  "installId",
  "sessionId",
  "type",
  "rating",
  "message",
  "platform",
  "appVersion",
  "context",
];

export class FeedbackController {
  async create(req: Request, res: Response): Promise<void> {
    const body = req.body;
    if (!body || typeof body.installId !== "string") {
      res.status(400).json({ error: "installId is required" });
      return;
    }
    if (
      (body.rating === undefined || body.rating === null) &&
      (typeof body.message !== "string" || body.message.trim().length === 0)
    ) {
      res.status(400).json({ error: "Provide a rating or a message" });
      return;
    }
    await feedbackService.create({ req, res }, body);
  }

  async list(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200;
    await feedbackService.list({ req, res }, limit);
  }

  async exportCsv(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const limit = parseLimit(req, 5000, 10000);
    const { data } = await feedbackService.getFeedbackData(limit, buildDateFilter(req, "date"));
    const csv = toCsv(data as Record<string, unknown>[], FEEDBACK_CSV_COLUMNS);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="feedback.csv"');
    res.status(200).send(csv);
  }
}
