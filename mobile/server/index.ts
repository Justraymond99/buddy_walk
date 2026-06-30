import express, { Application, Request, Response } from 'express';
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
import mtaRoute from "./routes/mta"
import mongoose from "mongoose";
import {databaseLink, config} from "./database";
import { setCompanionMemoryStore } from "./database/companionStoreMode";

dotenv.config();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      'http://localhost:5173',
      'http://localhost:8000',
      'https://buddywalk.app',
      'https://justraymond99.github.io',
    ];

(async function(){
  const app: Application = express();
  const port = process.env.PORT || 8000;

  try {
    await mongoose.connect(config.link!, {
      ...config.options,
      serverSelectionTimeoutMS: 4000,
    });
    console.log("Connect to the MongoDB successfully!");
    console.log("DB LINK -> ", databaseLink);
  } catch (error) {
    console.warn("MongoDB unavailable — companion uses in-memory store (chat logs disabled):", error);
    setCompanionMemoryStore(true);
  }


  app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  }));
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.use("/api", openAIRoute)
  app.use("/api/db", chatLogRoute)
  app.use("/api/token", tokenRoute)
  app.use("/api/companion", companionRoute)
  app.use("/api/telemetry", telemetryRoute)
  app.use("/api/feedback", feedbackRoute)
  app.use("/api", mtaRoute)

  // Public companion viewer page. Loads a tiny HTML shell with the token
  // injected as a global so the page can poll the snapshot endpoint.
  const viewerCandidates = [
    path.join(__dirname, 'views', 'companion.html'),
    path.join(__dirname, '..', 'views', 'companion.html'),
    path.join(__dirname, '..', 'server', 'views', 'companion.html'),
  ];
  let companionViewerTemplate = '';
  for (const candidate of viewerCandidates) {
    if (fs.existsSync(candidate)) {
      companionViewerTemplate = fs.readFileSync(candidate, 'utf8');
      break;
    }
  }
  if (!companionViewerTemplate) {
    console.warn('[companion] viewer template not found in any of:', viewerCandidates);
  }

  function sendCompanionViewer(res: Response, rawToken: string): void {
    const token = rawToken.replace(/[^a-zA-Z0-9_-]/g, '');
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
  }

  app.get('/companion-viewer.html', (req, res) => {
    sendCompanionViewer(res, String(req.query.token ?? ''));
  });

  app.get('/companion/:token', (req, res) => {
    sendCompanionViewer(res, req.params.token ?? '');
  });

  // Internal usage dashboard. The page is a shell; the data it loads is gated by
  // ADMIN_TOKEN, so pass the token through ?token=... in the URL.
  const usageCandidates = [
    path.join(__dirname, 'views', 'usage.html'),
    path.join(__dirname, '..', 'views', 'usage.html'),
    path.join(__dirname, '..', 'server', 'views', 'usage.html'),
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

  const rootDir = __dirname.includes('dist') 
  ? path.join(__dirname, '..')       // Production: go up 1 level to /dist
  : path.join(__dirname, '../dist'); // Development: go up 2 levels to /dist

  app.use(express.static(rootDir));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });
  
  app.listen(Number(port), '0.0.0.0', () => {
      console.log(`Server is live at http://localhost:${port}`);
    });

})()
