import { OpenAIController } from '../server/controllers/openAI';
import { createHandler } from './_lib/vercelExpress';

const controller = new OpenAIController();

export default createHandler(
  (req, res) => controller.parseUserRequest(req, res),
  ['POST']
);
