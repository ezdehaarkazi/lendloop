import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("re-drive stuck webhook deliveries", { minutes: 5 }, internal.webhooks.sweep, {});

export default crons;
