import {ChatLogService} from "../services/chatLog";
import {Request, Response} from "express";
import {messageInterface, chatLogInterface} from "../database/models/chatLog";

const chatLogService = new ChatLogService();

export class ChatLogController {
  async createChatLog(req: Request, res: Response): Promise<void> {
    const body: chatLogInterface = req.body;
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: 'messages must be a non-empty array' });
      return;
    }
    await chatLogService.newChatLog({req, res}, body);
  }

  async updateChatLog(req: Request, res: Response): Promise<void> {
    const body: {chat: messageInterface, id: string} = req.body;
    if (!body.id || typeof body.id !== 'string') {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    if (!body.chat || typeof body.chat.input !== 'string' || typeof body.chat.output !== 'string') {
      res.status(400).json({ error: 'chat.input and chat.output are required strings' });
      return;
    }
    await chatLogService.addChat({req, res}, body);
  }

  async flagMessage(req: Request, res: Response): Promise<void> {
    const body: {messageId: string, flagReason: string, chatlogId: string} = req.body;
    if (!body.messageId || !body.chatlogId) {
      res.status(400).json({ error: 'messageId and chatlogId are required' });
      return;
    }
    await chatLogService.flagMessage({req, res}, body);
  }
}
