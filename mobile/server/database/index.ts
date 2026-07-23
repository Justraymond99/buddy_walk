import dotenv from "dotenv";

dotenv.config();

const localLink = "mongodb://127.0.0.1/vlm_dev";
const configuredLink =
  process.env.MONGODB_URI?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.WEB_LINK?.trim();
export const databaseLink =
  process.env.NODE_ENV === "production" ? configuredLink : configuredLink || localLink;

export const config = {
  link: databaseLink,
  options: {
    autoIndex: false,
  },
};

export const TEST_CONTEXT =
  process.env.NODE_ENV === "production" ? "Production Mode" : process.env.TEST;


export const ENV_CHECK =
  process.env.NODE_ENV === "production"
    ? "Production Mode"
    : "Development Mode";

console.log("ENV MODE -> ", ENV_CHECK);
