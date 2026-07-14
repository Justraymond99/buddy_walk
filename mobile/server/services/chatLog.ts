import chatLogModel, {messageInterface, chatLogInterface} from "../database/models/chatLog";
import {AppContext} from "../types";
import {
  appendMemoryChatMessage,
  createMemoryChatLog,
  flagMemoryChatMessage,
  isMongoConnected,
  memoryChatLogs,
} from "../database/usageStore";

function withMessageIds(messages: messageInterface[]): (messageInterface & { _id: string })[] {
  return messages.map((msg) => {
    const existing = msg as messageInterface & { _id?: string };
    return {
      ...msg,
      _id: existing._id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    };
  });
}

export class ChatLogService {
  async newChatLog(ctx: AppContext, body: chatLogInterface) {
    const {res} = ctx;
    try {
      if (isMongoConnected()) {
        const result = await chatLogModel.create({user: body.user, messages: body.messages});
        if (result) {
          res.status(200).json({
            message: "Created new chat log!",
            data: result
          });
        }
        return;
      }

      const entry = createMemoryChatLog({
        ...body,
        messages: withMessageIds(body.messages ?? []),
        date: body.date ?? new Date(),
      });
      res.status(200).json({
        message: "Created new chat log (memory)!",
        data: entry,
      });
    } catch (e) {
      const error = new Error(`${e}`);
      res.json({
        code: 500,
        message: error.message
      })
    }
  }

  async addChat(ctx: AppContext, body: { chat: messageInterface, id: string }) {
    const {res} = ctx
    try {
      if (isMongoConnected()) {
        const result = await chatLogModel.findByIdAndUpdate(body.id, {$push: {messages: body.chat}}, {new: true})
        if (result) {
          res.status(200).json({
            message: "Added chat to existing log!",
            data: result
          });
        }
        return;
      }

      const chat = withMessageIds([body.chat])[0];
      const result = appendMemoryChatMessage(body.id, chat);
      if (result) {
        res.status(200).json({
          message: "Added chat to existing log (memory)!",
          data: result
        });
        return;
      }
      res.status(404).json({ error: "Chat log not found" });
    } catch (e) {
      const error = new Error(`${e}`);
      res.json({
        code: 500,
        message: error.message
      })
    }
  }

  async flagMessage(ctx:AppContext, body: {flagReason?: string, messageId: string, chatlogId: string}) {
    const {res} = ctx
    try{
      if (isMongoConnected()) {
        const result = await chatLogModel.findOneAndUpdate(
          {_id:body.chatlogId,"messages._id": body.messageId}, 
          {$set:{"messages.$.flag": true, "messages.$.flag_reason": body.flagReason}},
          {new:true})
        if(result){
          res.status(200).json({
            message: "Added flag to message",
            data: result
          }); 
        }
        return;
      }

      const result = flagMemoryChatMessage(body.chatlogId, body.messageId, body.flagReason);
      if (result) {
        res.status(200).json({
          message: "Added flag to message (memory)",
          data: result
        });
        return;
      }
      res.status(404).json({ error: "Chat log or message not found" });
    }catch (e) {
      const error = new Error(`${e}`);
      res.json({
        code: 500,
        message: error.message
      })
    }
  }

  /** Flatten chat logs into rows for CSV export (internal analysis). */
  async exportRows(limit: number, dateFilter?: Record<string, unknown>) {
    if (isMongoConnected()) {
      const logs = await chatLogModel
        .find(dateFilter ?? {})
        .sort({ date: -1 })
        .limit(Math.min(limit, 500))
        .lean();

      const rows: Record<string, unknown>[] = [];
      for (const log of logs) {
        const when = log.date ? new Date(log.date).toISOString() : "";
        for (const msg of log.messages ?? []) {
          rows.push({
            date: when,
            user: log.user ?? "",
            input: msg.input ?? "",
            output: msg.output ?? "",
            hasImage: Boolean(msg.imageURL),
            lat: msg.location?.lat ?? "",
            lon: msg.location?.lon ?? "",
            flagged: msg.flag ? "yes" : "no",
            flag_reason: msg.flag_reason ?? "",
          });
          if (rows.length >= limit) break;
        }
        if (rows.length >= limit) break;
      }
      return { source: "mongo", rows };
    }

    let logs = [...memoryChatLogs].reverse();
    if (dateFilter?.date) {
      const range = dateFilter.date as { $gte?: Date; $lte?: Date };
      logs = logs.filter((log) => {
        const ts = new Date(log.date).getTime();
        if (range.$gte && ts < range.$gte.getTime()) return false;
        if (range.$lte && ts > range.$lte.getTime()) return false;
        return true;
      });
    }

    const rows: Record<string, unknown>[] = [];
    for (const log of logs) {
      const when = log.date ? new Date(log.date).toISOString() : "";
      for (const msg of log.messages ?? []) {
        rows.push({
          date: when,
          user: log.user ?? "",
          input: msg.input ?? "",
          output: msg.output ?? "",
          hasImage: Boolean(msg.imageURL),
          lat: msg.location?.lat ?? "",
          lon: msg.location?.lon ?? "",
          flagged: msg.flag ? "yes" : "no",
          flag_reason: msg.flag_reason ?? "",
        });
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }
    return { source: "memory", rows };
  }
}