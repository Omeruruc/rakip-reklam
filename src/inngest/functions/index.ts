import { scheduleScans } from "./schedule-scans";
import { scanBrand } from "./scan-brand";
import { notifySlack } from "./notify-slack";
import { weeklyDigest } from "./weekly-digest";

export const functions = [
  scheduleScans,
  scanBrand,
  notifySlack,
  weeklyDigest,
];

export { scheduleScans, scanBrand, notifySlack, weeklyDigest };
