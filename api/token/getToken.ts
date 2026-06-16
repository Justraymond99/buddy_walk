import { TokenController } from '../../server/controllers/token';
import { createHandler } from '../_lib/vercelExpress';

const controller = new TokenController();

export default createHandler(
  (req, res) => controller.getToken(req, res),
  ['GET']
);
