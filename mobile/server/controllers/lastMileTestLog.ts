import { Request, Response } from "express";
import { lastMileTestLogService } from "../services/lastMileTestLog";
import { toCsv } from "../utils/csv";
import { buildDateFilter, isAdminAuthorized, parseLimit } from "../utils/adminAuth";
import { isMongoConnected } from "../database/usageStore";

const LAST_MILE_TEST_CSV_COLUMNS = [
  "serverTs",
  "destination",
  "lat",
  "lng",
  "panoramaDate",
  "panoramaStatus",
  "destinationPhotoDate",
  "destinationPhotoStatus",
  "destinationPlaceName",
  "destinationPlaceAddress",
  "destinationTypes",
  "destinationDistanceMeters",
  "gpsAccuracyMeters",
  "destinationBearing",
  "deviceHeading",
  "headingDifferenceDegrees",
  "headingAligned",
  "compassHeading",
  "panoramaMatchedHeading",
  "headingComparisonDifference",
  "headingComparisonAgrees",
  "confidenceScore",
  "confidenceLevel",
  "confidenceReasons",
  "destinationReferenceUsed",
  "navigationMode",
  "testScenario",
  "currentHeading",
  "targetHeading",
  "turnInstruction",
  "finalOutput",
  "reviewerStatus",
  "reviewerNotes",
  "reviewedAt",
  "success",
  "error",
  "latencyMs",
  "panoramaHeadings",
  "steps",
  "userPhoto",
  "panoramaPhoto",
  "destinationPhoto",
];

export class LastMileTestLogController {
  async list(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const limit = parseLimit(req, 25, 500);
    const includeImages = req.query.includeImages === "true";
    const { source, data } = await lastMileTestLogService.getData(limit, buildDateFilter(req));
    const rows = includeImages
      ? data
      : data.map((row) => ({
          ...row,
          userPhoto: row.userPhoto ? `[base64 image ${row.userPhoto.length} chars]` : "",
          panoramaPhoto: row.panoramaPhoto ? `[base64 image ${row.panoramaPhoto.length} chars]` : "",
          destinationPhoto: row.destinationPhoto
            ? `[base64 image ${row.destinationPhoto.length} chars]`
            : "",
        }));

    res.status(200).json({ source, data: rows });
  }

  async getOne(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const data = await lastMileTestLogService.getById(req.params.id);
    if (!data) {
      res.status(404).json({ error: "Last Meters test log not found" });
      return;
    }

    const includeImages = req.query.includeImages === "true";
    if (!includeImages) {
      res.status(200).json({
        source: isMongoConnected() ? "mongo" : "memory",
        data: {
          ...data,
          userPhoto: data.userPhoto ? `[base64 image ${data.userPhoto.length} chars]` : "",
          panoramaPhoto: data.panoramaPhoto
            ? `[base64 image ${data.panoramaPhoto.length} chars]`
            : "",
          destinationPhoto: data.destinationPhoto
            ? `[base64 image ${data.destinationPhoto.length} chars]`
            : "",
        },
      });
      return;
    }

    res.status(200).json({ source: isMongoConnected() ? "mongo" : "memory", data });
  }

  async exportCsv(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const limit = parseLimit(req, 500, 5000);
    const includeImages = req.query.includeImages === "true";
    const { data } = await lastMileTestLogService.getData(limit, buildDateFilter(req));
    const csv = toCsv(
      data.map((row) => ({
        ...row,
        serverTs: row.serverTs ? new Date(row.serverTs).toISOString() : "",
        reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : "",
        panoramaHeadings: row.panoramaHeadings.join("|"),
        destinationTypes: (row.destinationTypes || []).join("|"),
        confidenceReasons: (row.confidenceReasons || []).join("|"),
        steps: JSON.stringify(row.steps),
        userPhoto: includeImages ? row.userPhoto : row.userPhoto ? `[base64 image ${row.userPhoto.length} chars]` : "",
        panoramaPhoto: includeImages
          ? row.panoramaPhoto
          : row.panoramaPhoto
            ? `[base64 image ${row.panoramaPhoto.length} chars]`
            : "",
        destinationPhoto: includeImages
          ? row.destinationPhoto
          : row.destinationPhoto
            ? `[base64 image ${row.destinationPhoto.length} chars]`
            : "",
      })) as Record<string, unknown>[],
      LAST_MILE_TEST_CSV_COLUMNS
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="last_mile_tests.csv"');
    res.status(200).send(csv);
  }

  async updateReview(req: Request, res: Response): Promise<void> {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const status = req.body?.reviewerStatus;
    if (
      status !== undefined &&
      !["untested", "pass", "partial", "fail"].includes(status)
    ) {
      res.status(400).json({ error: "reviewerStatus must be untested, pass, partial, or fail" });
      return;
    }

    const reviewerNotes =
      typeof req.body?.reviewerNotes === "string"
        ? req.body.reviewerNotes.slice(0, 4000)
        : "";

    const { source, data } = await lastMileTestLogService.updateReview(req.params.id, {
      reviewerStatus: status,
      reviewerNotes,
    });
    if (!data) {
      res.status(404).json({ error: "Last Meters test log not found" });
      return;
    }
    res.status(200).json({ source, data });
  }
}
