import chatLogModel, {messageInterface, chatLogInterface} from "../database/models/chatLog";
import {AppContext} from "../types";

export class ChatLogService {
  async newChatLog(ctx: AppContext, body: chatLogInterface) {
    const {res} = ctx;
    try {
      console.log("[ChatLogService] newChatLog payload:", body);
      const result = await chatLogModel.create({user: body?.user, messages: body?.messages});
      if (result) {
        res.status(200).json({
          message: "Created new chat log!",
          data: result
        });
      }
    } catch (e: any) {
      console.error("[ChatLogService] Error in newChatLog:", e);
      res.status(500).json({
        code: 500,
        message: e.message || "Internal Server Error",
        details: e.errors || null
      });
    }
  }

  async addChat(ctx: AppContext, body: { chat: messageInterface, id: string }) {
    const {res} = ctx
    try {
      const result = await chatLogModel.findByIdAndUpdate(body.id, {$push: {messages: body.chat}}, {new: true})
      if (result) {
        res.status(200).json({
          message: "Added chat to existing log!",
          data: result
        });
      }
    } catch (e: any) {
      console.error("[ChatLogService] Error in addChat:", e);
      res.status(500).json({
        code: 500,
        message: e.message || "Internal Server Error",
        details: e.errors || null
      });
    }
  }
  // find message with matching id, flip flag, and add flag reason
  async flagMessage(ctx:AppContext, body: {flagReason?: string, messageId: string, chatlogId: string}) {
    const {res} = ctx
    try{
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
    } catch (e: any) {
      console.error("[ChatLogService] Error in flagMessage:", e);
      res.status(500).json({
        code: 500,
        message: e.message || "Internal Server Error",
        details: e.errors || null
      });
    }
  }
}