import { TelemetryController } from '../../server/controllers/telemetry';
import { createHandler } from '../_lib/vercelExpress';

const controller = new TelemetryController();

export default createHandler(
  (req, res) => controller.recordEvents(req, res),
  ['POST']
);
