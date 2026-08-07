import { scheduleScans } from "./schedule-scans";
import { scanBrand } from "./scan-brand";
import { notifySlack } from "./notify-slack";
import { syncSheetRow } from "./sync-sheet-row";
import { updateSheetStatus } from "./update-sheet-status";
import { weeklyDigest } from "./weekly-digest";

export const functions = [
  scheduleScans,
  scanBrand,
  notifySlack,
  syncSheetRow,
  updateSheetStatus,
  weeklyDigest,
];

export {
  scheduleScans,
  scanBrand,
  notifySlack,
  syncSheetRow,
  updateSheetStatus,
  weeklyDigest,
};
