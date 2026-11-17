
import { MongoClient, Db } from "mongodb";
import process from "process";

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

if (!mongoUri) {
  throw new Error("MONGODB_URI is missing from environment variables");
}

if (!dbName) {
  throw new Error("DB_NAME is missing from environment variables");
}

const client = new MongoClient(mongoUri);

let database: Db;

export async function connectDB(): Promise<void> {
  try {
    await client.connect();

    database = client.db(dbName);

    await database.command({ ping: 1 });

    console.log("MongoDB connected successfully!");
    console.log(`Database: ${dbName}`);
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

export function getDB(): Db {
  if (!database) {
    throw new Error("Database is not connected yet");
  }

  return database;
}
