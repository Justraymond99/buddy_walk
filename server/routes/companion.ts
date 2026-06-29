import express from "express";
import { CompanionController } from "../controllers/companion";

const route = express.Router();
const controller = new CompanionController();

route.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Mobile app creates a sharing session and gets back { token, ownerSecret }
route.post("/create", (req, res) => controller.createSession(req, res));

// Mobile app pushes a new location for a session it owns
route.post("/ping", (req, res) => {
  req.params = { ...req.params, token: String(req.body?.token ?? "") };
  controller.ping(req, res);
});
route.post("/stop", (req, res) => {
  req.params = { ...req.params, token: String(req.body?.token ?? "") };
  controller.stop(req, res);
});
route.get("/snapshot", (req, res) => {
  req.params = { ...req.params, token: String(req.query.token ?? "") };
  controller.snapshot(req, res);
});

route.post("/:token/ping", (req, res) => controller.ping(req, res));

// Mobile app cancels a session it owns
route.post("/:token/stop", (req, res) => controller.stop(req, res));

// Public read-only snapshot consumed by the web viewer (and by anyone with the link)
route.get("/:token/snapshot", (req, res) => controller.snapshot(req, res));

export default route;
