import express, { Application } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import openAIRoute from "./routes/openAI"
import chatLogRoute from "./routes/chatLog"
import tokenRoute from "./routes/token"
import mongoose from "mongoose";
import {databaseLink, config} from "./database";

dotenv.config();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:8000'];

(async function(){
  try {
    await mongoose.connect(config.link!, config.options);
    console.log("Connect to the MongoDB successfully!");
    console.log("DB LINK -> ", databaseLink);
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
  const app: Application = express();
  const port = process.env.PORT || 8000;

  app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  }));
  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(express.static(path.join(__dirname, '../dist')));

  app.use("/api", openAIRoute)
  app.use("/api/db", chatLogRoute)
  app.use("/api/token", tokenRoute)

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
  });

  app.listen(port, () => {
    console.log(`Server is live at http://localhost:${port}`);
  });

})()
