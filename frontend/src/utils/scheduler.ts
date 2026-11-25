import { ScheduledSlot, TimeSlotKey } from "../types/api";

export const SLOT_TIME_LABELS: Record<TimeSlotKey, string> = {
  Morning: "8:00 AM",
  Afternoon: "1:30 PM",
  Night: "8:30 PM",
};

export const SLOT_LOCALIZED_LABELS: Record<
  "en" | "hi" | "mr",
  Record<TimeSlotKey, string>
> = {
  en: {
    Morning: "Morning · 8:00 AM",
    Afternoon: "Afternoon · 1:30 PM",
    Night: "Night · 8:30 PM",
  },
  hi: {
    Morning: "सुबह · 8:00 बजे",
    Afternoon: "दोपहर · 1:30 बजे",
    Night: "रात · 8:30 बजे",
  },
  mr: {
    Morning: "सकाळ · 8:00 वाजता",
    Afternoon: "दुपार · 1:30 वाजता",
    Night: "रात्र · 8:30 वाजता",
  },
};

export function parseFrequencyToSlots(frequencyCode: string): ScheduledSlot[] {
  const cleaned = (frequencyCode || "").trim().replace(/\s+/g, "");
  const parts = cleaned.split("-").map((part) => Number.parseFloat(part));

  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n) && n >= 0)) {
    const slotOrder: TimeSlotKey[] = ["Morning", "Afternoon", "Night"];
    const result: ScheduledSlot[] = [];

    parts.forEach((doseCount, index) => {
      if (doseCount > 0) {
        const slot = slotOrder[index];
        result.push({
          slot,
          time_label: SLOT_TIME_LABELS[slot],
          dose_count: doseCount,
        });
      }
    });

    if (result.length > 0) {
      return result;
    }
  }

  const lower = cleaned.toLowerCase();
  if (lower.includes("twice") || lower.includes("bd")) {
    return [
      { slot: "Morning", time_label: SLOT_TIME_LABELS.Morning, dose_count: 1 },
      { slot: "Night", time_label: SLOT_TIME_LABELS.Night, dose_count: 1 },
    ];
  }
  if (lower.includes("thrice") || lower.includes("tds")) {
    return [
      { slot: "Morning", time_label: SLOT_TIME_LABELS.Morning, dose_count: 1 },
      { slot: "Afternoon", time_label: SLOT_TIME_LABELS.Afternoon, dose_count: 1 },
      { slot: "Night", time_label: SLOT_TIME_LABELS.Night, dose_count: 1 },
    ];
  }
  if (lower.includes("night") || lower.includes("hs") || lower.includes("bed")) {
    return [{ slot: "Night", time_label: SLOT_TIME_LABELS.Night, dose_count: 1 }];
  }

  return [{ slot: "Morning", time_label: SLOT_TIME_LABELS.Morning, dose_count: 1 }];
}

export function getCurrentTimeSlot(): TimeSlotKey {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Night";
}
