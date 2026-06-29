import { FeedbackController } from '../server/controllers/feedback';
import { createHandler } from './_lib/vercelExpress';

const controller = new FeedbackController();

export default createHandler(
  (req, res) => controller.create(req, res),
  ['POST']
);
