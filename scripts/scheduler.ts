/**
 * Node.js Cron Scheduler for Daily Lead Pipeline
 *
 * This script schedules the Python pipeline to run daily at 7am ET.
 * Run with: npx ts-node scripts/scheduler.ts
 *
 * For production, consider using:
 * - Windows Task Scheduler with run-pipeline.ps1
 * - A process manager like PM2
 * - A cloud scheduler (Railway, Render, etc.)
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";

// Use dynamic import for node-cron (ESM module)
const startScheduler = async () => {
  const cron = await import("node-cron");

  const PROJECT_ROOT = path.resolve(__dirname, "..");
  const PIPELINE_SCRIPT = path.join(
    PROJECT_ROOT,
    "scripts",
    "pipeline",
    "daily_lead_pipeline.py"
  );
  const LOG_DIR = path.join(PROJECT_ROOT, "logs");

  // Ensure log directory exists
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  function getLogFile(): string {
    const date = new Date().toISOString().split("T")[0];
    return path.join(LOG_DIR, `pipeline_${date}.log`);
  }

  function log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);

    const logFile = getLogFile();
    fs.appendFileSync(logFile, logMessage + "\n");
  }

  function runPipeline(testMode: boolean = false): Promise<number> {
    return new Promise((resolve, reject) => {
      log(`Starting pipeline (test mode: ${testMode})...`);

      const args = [PIPELINE_SCRIPT];
      if (testMode) {
        args.push("--test");
      }

      const process = spawn("python", args, {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const logFile = getLogFile();

      process.stdout.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          fs.appendFileSync(logFile, message + "\n");
          console.log(message);
        }
      });

      process.stderr.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          fs.appendFileSync(logFile, `[STDERR] ${message}\n`);
          console.error(message);
        }
      });

      process.on("close", (code) => {
        const exitCode = code ?? 1;
        log(`Pipeline completed with exit code: ${exitCode}`);
        resolve(exitCode);
      });

      process.on("error", (err) => {
        log(`Pipeline error: ${err.message}`);
        reject(err);
      });
    });
  }

  // Schedule: Run at 7:00 AM Eastern Time daily
  // Note: Cron uses server timezone. Adjust based on your server's timezone.
  // For UTC server: 12:00 (EST) or 11:00 (EDT)
  // For EST server: 07:00
  const CRON_SCHEDULE = process.env.PIPELINE_CRON || "0 7 * * *";

  log("=".repeat(60));
  log("Daily Lead Pipeline Scheduler Started");
  log(`Schedule: ${CRON_SCHEDULE}`);
  log(`Pipeline script: ${PIPELINE_SCRIPT}`);
  log(`Log directory: ${LOG_DIR}`);
  log("=".repeat(60));

  // Schedule the pipeline
  cron.default.schedule(
    CRON_SCHEDULE,
    async () => {
      log("Scheduled run triggered");
      try {
        const exitCode = await runPipeline(false);
        if (exitCode === 0) {
          log("Scheduled run completed successfully");
        } else {
          log(`Scheduled run failed with exit code: ${exitCode}`);
        }
      } catch (error) {
        log(`Scheduled run error: ${error}`);
      }
    },
    {
      timezone: "America/New_York", // Eastern Time
    }
  );

  log("Scheduler is running. Press Ctrl+C to stop.");

  // Handle manual trigger via environment variable
  if (process.env.RUN_IMMEDIATELY === "true") {
    log("Running pipeline immediately (RUN_IMMEDIATELY=true)");
    runPipeline(process.env.TEST_MODE === "true");
  }
};

// Start the scheduler
startScheduler().catch((err) => {
  console.error("Failed to start scheduler:", err);
  process.exit(1);
});
