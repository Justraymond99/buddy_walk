import sharp from "sharp";
import lastMileTestLogModel, {
  lastMileTestLogInterface,
} from "../database/models/lastMileTestLog";
import {
  isMongoConnected,
  memoryLastMileTests,
  pushMemoryLastMileTest,
} from "../database/usageStore";

export async function compressUserPhoto(dataUrl: string): Promise<string> {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const outputBuffer = await sharp(Buffer.from(base64Data, "base64"))
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 76 })
      .toBuffer();
    return `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;
  } catch (error) {
    console.error("[LastMileTestLog] failed to compress user photo for storage:", error);
    return dataUrl;
  }
}

export class LastMileTestLogService {
  async record(input: Omit<lastMileTestLogInterface, "serverTs">): Promise<string | undefined> {
    const doc: lastMileTestLogInterface = {
      ...input,
      serverTs: new Date(),
    };
    try {
      if (isMongoConnected()) {
        const created = await lastMileTestLogModel.create(doc);
        return String(created._id);
      }
      const memoryDoc = {
        ...doc,
        _id: `last_mile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      } as lastMileTestLogInterface & { _id: string };
      pushMemoryLastMileTest(memoryDoc);
      return memoryDoc._id;
    } catch (e) {
      console.error("[LastMileTestLogService] record failed:", e);
      return undefined;
    }
  }

  async getData(
    limit: number,
    dateFilter?: Record<string, unknown>
  ): Promise<{ source: string; data: lastMileTestLogInterface[] }> {
    if (isMongoConnected()) {
      const data = await lastMileTestLogModel
        .find(dateFilter ?? {})
        .sort({ serverTs: -1 })
        .limit(limit)
        .allowDiskUse(true)
        .lean();
      return { source: "mongo", data };
    }

    let rows = [...memoryLastMileTests].reverse();
    if (dateFilter?.serverTs) {
      const range = dateFilter.serverTs as { $gte?: Date; $lte?: Date };
      rows = rows.filter((row) => {
        const ts = new Date(row.serverTs).getTime();
        if (range.$gte && ts < range.$gte.getTime()) return false;
        if (range.$lte && ts > range.$lte.getTime()) return false;
        return true;
      });
    }
    return { source: "memory", data: rows.slice(0, limit) };
  }

  async updateReview(
    id: string,
    review: { reviewerStatus?: lastMileTestLogInterface["reviewerStatus"]; reviewerNotes?: string }
  ): Promise<{ source: string; data: lastMileTestLogInterface | null }> {
    const update = {
      reviewerStatus: review.reviewerStatus ?? "untested",
      reviewerNotes: review.reviewerNotes ?? "",
      reviewedAt: new Date(),
    };

    if (isMongoConnected()) {
      const data = await lastMileTestLogModel
        .findByIdAndUpdate(id, update, { new: true })
        .lean();
      return { source: "mongo", data };
    }

    const row = memoryLastMileTests.find((entry) => {
      const maybeId = (entry as lastMileTestLogInterface & { _id?: unknown })._id;
      return String(maybeId ?? "") === id;
    });
    if (!row) return { source: "memory", data: null };
    row.reviewerStatus = update.reviewerStatus;
    row.reviewerNotes = update.reviewerNotes;
    row.reviewedAt = update.reviewedAt;
    return { source: "memory", data: row };
  }
}

export const lastMileTestLogService = new LastMileTestLogService();
