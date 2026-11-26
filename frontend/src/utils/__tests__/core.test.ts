import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFrequencyToSlots, SLOT_TIME_LABELS } from "../scheduler.ts";
import {
  buildEmergencyWhatsAppUrl,
  buildSummaryText,
  buildWhatsAppSummaryUrl,
} from "../whatsapp.ts";
import { buildVerifiedSlotSpeech, getMedicineSpokenText } from "../tts.ts";
import type { EmergencyContact, VerifiedMedicine, VitalLogEntry } from "../../types/api.ts";

const SAMPLE_MED: VerifiedMedicine = {
  id: "med-1",
  share_code: "DEMO01",
  medicine_name: "Paracetamol 650mg",
  dosage: "650 mg (1 tablet)",
  frequency_code: "1-0-1",
  slots: [
    { slot: "Morning", time_label: SLOT_TIME_LABELS.Morning, dose_count: 1 },
    { slot: "Night", time_label: SLOT_TIME_LABELS.Night, dose_count: 1 },
  ],
  meal_relation: "After Food",
  duration_days: "5 days",
  ai_accuracy: "High",
  confidence_score: 0.95,
  ai_accuracy_reason: "Clear label",
  caregiver_verified: true,
  verified_at: "2026-11-25T08:00:00.000Z",
  verified_by: "Caregiver",
  pill_appearance: "White oval tablet",
  simple_explanation_en: "Please take 1 white oval tablet after food.",
  simple_explanation_hi: "कृपया खाने के बाद 1 सफेद गोली लीजिए।",
  simple_explanation_mr: "कृपया जेवणानंतर 1 पांढरी गोळी घ्या.",
  strip_image_url: "",
  taken_slots_today: ["Morning"],
};

const SAMPLE_CONTACT: EmergencyContact = {
  name: "Aarav Sharma",
  relation: "Son",
  phone: "+91 98201 44510",
  whatsapp_phone: "919820144510",
};

const SAMPLE_VITAL: VitalLogEntry = {
  id: "v-1",
  share_code: "DEMO01",
  recorded_at: "2026-11-25T09:00:00.000Z",
  temperature_f: 98.6,
  bp_systolic: 124,
  bp_diastolic: 78,
  weight_kg: 60.5,
  notes: "Feeling well",
};

describe("parseFrequencyToSlots", () => {
  it("parses Indian numeric M-A-N patterns", () => {
    const twice = parseFrequencyToSlots("1-0-1");
    assert.deepEqual(
      twice.map((s) => s.slot),
      ["Morning", "Night"]
    );

    const thrice = parseFrequencyToSlots("1-1-1");
    assert.deepEqual(
      thrice.map((s) => s.slot),
      ["Morning", "Afternoon", "Night"]
    );

    const nightOnly = parseFrequencyToSlots("0-0-1");
    assert.deepEqual(
      nightOnly.map((s) => s.slot),
      ["Night"]
    );
  });

  it("parses Latin dosage shorthand and defaults safely", () => {
    assert.deepEqual(
      parseFrequencyToSlots("BD").map((s) => s.slot),
      ["Morning", "Night"]
    );
    assert.deepEqual(
      parseFrequencyToSlots("TDS").map((s) => s.slot),
      ["Morning", "Afternoon", "Night"]
    );
    assert.deepEqual(
      parseFrequencyToSlots("HS").map((s) => s.slot),
      ["Night"]
    );
    assert.deepEqual(
      parseFrequencyToSlots("").map((s) => s.slot),
      ["Morning"]
    );
  });
});

describe("WhatsApp summary & SOS URL builders", () => {
  it("computes adherence and encodes WhatsApp URLs cleanly", () => {
    const summary = buildSummaryText("DEMO01", [SAMPLE_MED], [SAMPLE_VITAL]);
    assert.match(summary, /1\/2 doses taken/);
    assert.match(summary, /Paracetamol 650mg/);
    assert.match(summary, /124\/78 mmHg/);

    const url = buildWhatsAppSummaryUrl("DEMO01", [SAMPLE_MED], [SAMPLE_VITAL], SAMPLE_CONTACT);
    assert.ok(url.startsWith("https://wa.me/919820144510?text="));

    const sos = buildEmergencyWhatsAppUrl(SAMPLE_CONTACT);
    assert.ok(sos.startsWith("https://wa.me/919820144510?text="));
    assert.match(decodeURIComponent(sos), /Emergency Help/i);
  });
});

describe("Elder voiceover safety invariants", () => {
  it("returns localized speech for verified medicines", () => {
    assert.equal(getMedicineSpokenText(SAMPLE_MED, "en"), SAMPLE_MED.simple_explanation_en);
    assert.equal(getMedicineSpokenText(SAMPLE_MED, "hi"), SAMPLE_MED.simple_explanation_hi);
    assert.equal(getMedicineSpokenText(SAMPLE_MED, "mr"), SAMPLE_MED.simple_explanation_mr);
  });

  it("refuses to generate speech for unverified medicines", () => {
    const unverified = {
      ...SAMPLE_MED,
      caregiver_verified: false,
    } as unknown as VerifiedMedicine;
    assert.equal(getMedicineSpokenText(unverified, "en"), "");
    const script = buildVerifiedSlotSpeech([unverified], "Morning", "en");
    assert.match(script, /no caregiver-verified medicines/i);
  });
});

import { isImageFile } from "../image.ts";

describe("isImageFile", () => {
  it("accepts images by MIME type or extension and rejects others", () => {
    assert.equal(isImageFile({ type: "image/jpeg" }), true);
    assert.equal(isImageFile({ type: "", name: "scan.HEIC" }), true);
    assert.equal(isImageFile({ type: "application/pdf", name: "a.pdf" }), false);
  });
});

import { prepareImageFile } from "../image.ts";

describe("prepareImageFile", () => {
  it("rejects non-image files and passes small images through unchanged", async () => {
    const pdf = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });
    await assert.rejects(() => prepareImageFile(pdf), /image/i);

    const smallJpg = new File(["small-bytes"], "rx.jpg", { type: "image/jpeg" });
    const prepared = await prepareImageFile(smallJpg);
    assert.equal(prepared, smallJpg);
  });
});
