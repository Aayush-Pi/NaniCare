import {
  EmergencyContact,
  VerifiedMedicine,
  VitalLogEntry,
} from "../types/api";

export function buildSummaryText(
  shareCode: string,
  medicines: VerifiedMedicine[],
  vitals: VitalLogEntry[]
): string {
  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const verified = medicines.filter((m) => m.caregiver_verified);
  let totalDoses = 0;
  let takenDoses = 0;

  const medLines = verified.map((med) => {
    totalDoses += med.slots.length;
    takenDoses += med.taken_slots_today.length;
    const slotDetails = med.slots
      .map((s) => {
        const done = med.taken_slots_today.includes(s.slot);
        return `${s.slot} (${s.time_label}): ${done ? "Taken" : "Pending"}`;
      })
      .join(", ");
    return `- ${med.medicine_name} (${med.dosage}, ${med.meal_relation}) -> ${slotDetails}`;
  });

  const latestVital = vitals[0];
  const vitalSection = latestVital
    ? [
        `Latest Vitals (${new Date(latestVital.recorded_at).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        })}):`,
        `- Temperature: ${latestVital.temperature_f.toFixed(1)} °F`,
        `- Blood Pressure: ${latestVital.bp_systolic}/${latestVital.bp_diastolic} mmHg`,
        `- Weight: ${latestVital.weight_kg.toFixed(1)} kg`,
        latestVital.notes ? `- Note: ${latestVital.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Latest Vitals: No readings logged yet.";

  return [
    `NaniCare Daily Care Report · Profile ${shareCode} (${today})`,
    `Caregiver-Verified Adherence: ${takenDoses}/${totalDoses} doses taken`,
    "",
    "Verified Medicines:",
    medLines.length ? medLines.join("\n") : "- No verified medicines scheduled.",
    "",
    vitalSection,
  ].join("\n");
}

export function buildWhatsAppSummaryUrl(
  shareCode: string,
  medicines: VerifiedMedicine[],
  vitals: VitalLogEntry[],
  contact?: EmergencyContact
): string {
  const message = buildSummaryText(shareCode, medicines, vitals);
  const digits = contact?.whatsapp_phone.replace(/[^\d]/g, "") || "";
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function buildEmergencyWhatsAppUrl(contact: EmergencyContact): string {
  const digits = contact.whatsapp_phone.replace(/[^\d]/g, "") || "";
  const message = `URGENT from NaniCare: Grandparent tapped the Emergency Help button right now. Please call back immediately.`;
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}
