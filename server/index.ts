import express, { Application } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import openAIRoute from "./routes/openAI"
import chatLogRoute from "./routes/chatLog"
import tokenRoute from "./routes/token"
import companionRoute from "./routes/companion"
import telemetryRoute from "./routes/telemetry"
import feedbackRoute from "./routes/feedback"
import mongoose from "mongoose";
import {databaseLink, config} from "./database";

dotenv.config();

(async function(){
  try {
    await mongoose.connect(config.link!, config.options);
    console.log("Connect to the MongoDB successfully!");
    console.log("DB LINK -> ", databaseLink);
  } catch (error) {
    console.log(new Error(`${error}`));
  }
  const app: Application = express();
  const port = process.env.PORT || 8000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.use("/api", openAIRoute)
  app.use("/api/db", chatLogRoute)
  app.use("/api/token", tokenRoute)
  app.use("/api/companion", companionRoute)
  app.use("/api/telemetry", telemetryRoute)
  app.use("/api/feedback", feedbackRoute)

  const viewerCandidates = [
    path.join(__dirname, 'views', 'companion.html'),
    path.join(__dirname, '..', 'views', 'companion.html'),
  ];
  let companionViewerTemplate = '';
  for (const candidate of viewerCandidates) {
    if (fs.existsSync(candidate)) {
      companionViewerTemplate = fs.readFileSync(candidate, 'utf8');
      break;
    }
  }

  app.get('/companion/:token', (req, res) => {
    const token = (req.params.token || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!companionViewerTemplate) {
      res.status(500).send('Companion viewer is not available right now.');
      return;
    }
    const html = companionViewerTemplate.replace(
      'window.__COMPANION_TOKEN__ || ""',
      `${JSON.stringify(token)}`
    );
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  });

  // Internal usage dashboard. The page is a shell; the data it loads is gated by
  // ADMIN_TOKEN, so pass the token through ?token=... in the URL.
  const usageCandidates = [
    path.join(__dirname, 'views', 'usage.html'),
    path.join(__dirname, '..', 'views', 'usage.html'),
  ];
  let usageViewerTemplate = '';
  for (const candidate of usageCandidates) {
    if (fs.existsSync(candidate)) {
      usageViewerTemplate = fs.readFileSync(candidate, 'utf8');
      break;
    }
  }

  app.get('/usage', (req, res) => {
    if (!usageViewerTemplate) {
      res.status(500).send('Usage dashboard is not available right now.');
      return;
    }
    const token = String(req.query.token || '').replace(/[^a-zA-Z0-9_\-.]/g, '');
    const html = usageViewerTemplate.replace('__ADMIN_TOKEN__', token);
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  });

  app.use(express.static(path.join(__dirname, '../dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
  });

  app.listen(port, () => {
    console.log(`Server is live at http://localhost:${port}`);
  });

})()
