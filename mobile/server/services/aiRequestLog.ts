import aiRequestLogModel, { aiRequestLogInterface } from "../database/models/aiRequestLog";
import {
  isMongoConnected,
  memoryAiRequests,
  pushMemoryAiRequest,
} from "../database/usageStore";

export interface AiRequestLogInput {
  requestId?: string;
  installId?: string;
  sessionId?: string;
  platform?: string;
  appVersion?: string;
  feature?: string;
  toolUsed?: string;
  inputLength: number;
  inputText?: string;
  outputText?: string;
  hasImage?: boolean;
  imageCount?: number;
  hasCoords?: boolean;
  success: boolean;
  errorCode?: string;
  latencyMs: number;
  outputLength?: number;
  tokenCount?: number;
}

export class AiRequestLogService {
  async record(input: AiRequestLogInput): Promise<void> {
    const doc: aiRequestLogInterface = {
      ...input,
      hasImage: !!input.hasImage,
      imageCount: input.imageCount ?? 0,
      hasCoords: !!input.hasCoords,
      serverTs: new Date(),
    };
    try {
      if (isMongoConnected()) {
        await aiRequestLogModel.create(doc);
      } else {
        pushMemoryAiRequest(doc);
      }
    } catch (e) {
      console.error("[AiRequestLogService] record failed:", e);
    }
  }

  async getData(
    limit: number,
    dateFilter?: Record<string, unknown>
  ): Promise<{ source: string; data: aiRequestLogInterface[] }> {
    if (isMongoConnected()) {
      const data = await aiRequestLogModel
        .find(dateFilter ?? {})
        .sort({ serverTs: -1 })
        .limit(limit)
        .lean();
      return { source: "mongo", data };
    }
    let rows = [...memoryAiRequests].reverse();
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

  async summary(dateFilter?: Record<string, unknown>) {
    if (isMongoConnected()) {
      const match = dateFilter ?? {};
      const byFeature = await aiRequestLogModel.aggregate([
        { $match: match },
        { $group: { _id: "$feature", count: { $sum: 1 }, avgLatency: { $avg: "$latencyMs" } } },
        { $sort: { count: -1 } },
      ]);
      const byTool = await aiRequestLogModel.aggregate([
        { $match: match },
        { $group: { _id: "$toolUsed", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
      const totals = await aiRequestLogModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            success: { $sum: { $cond: ["$success", 1, 0] } },
            avgLatency: { $avg: "$latencyMs" },
          },
        },
      ]);
      const t = totals[0] ?? { total: 0, success: 0, avgLatency: 0 };
      return {
        source: "mongo",
        totalRequests: t.total,
        successRate: t.total ? Math.round((t.success / t.total) * 100) : 0,
        avgLatencyMs: Math.round(t.avgLatency ?? 0),
        byFeature: byFeature.map((r: any) => ({
          feature: r._id || "unknown",
          count: r.count,
          avgLatencyMs: Math.round(r.avgLatency ?? 0),
        })),
        byTool: byTool.map((r: any) => ({ tool: r._id || "none", count: r.count })),
      };
    }

    let rows = memoryAiRequests;
    if (dateFilter?.serverTs) {
      const range = dateFilter.serverTs as { $gte?: Date; $lte?: Date };
      rows = rows.filter((row) => {
        const ts = new Date(row.serverTs).getTime();
        if (range.$gte && ts < range.$gte.getTime()) return false;
        if (range.$lte && ts > range.$lte.getTime()) return false;
        return true;
      });
    }
    const featureCounts = new Map<string, { count: number; latency: number }>();
    const toolCounts = new Map<string, number>();
    let success = 0;
    let latencySum = 0;
    for (const row of rows) {
      if (row.success) success += 1;
      latencySum += row.latencyMs;
      const f = row.feature || "unknown";
      const cur = featureCounts.get(f) ?? { count: 0, latency: 0 };
      cur.count += 1;
      cur.latency += row.latencyMs;
      featureCounts.set(f, cur);
      const tool = row.toolUsed || "none";
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    }
    return {
      source: "memory",
      totalRequests: rows.length,
      successRate: rows.length ? Math.round((success / rows.length) * 100) : 0,
      avgLatencyMs: rows.length ? Math.round(latencySum / rows.length) : 0,
      byFeature: [...featureCounts.entries()]
        .map(([feature, v]) => ({
          feature,
          count: v.count,
          avgLatencyMs: Math.round(v.latency / v.count),
        }))
        .sort((a, b) => b.count - a.count),
      byTool: [...toolCounts.entries()]
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

export const aiRequestLogService = new AiRequestLogService();
