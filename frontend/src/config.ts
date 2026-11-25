import {
  EmergencyContact,
  LanguageCode,
  VerifiedMedicine,
  VitalLogEntry,
} from "./types/api";
import { parseFrequencyToSlots } from "./utils/scheduler";

export const DEFAULT_SHARE_CODE = "DEMO01";

export const GENERATED_ASSETS = {
  stripParacetamol: "/src/assets/images/strip_dolo_650_1795586273226.jpg",
  stripCapsule: "/src/assets/images/strip_pan_d_1795586270413.jpg",
  stripAtorvastatin: "/src/assets/images/strip_atorvastatin_1795586272394.jpg",
  samplePrescription: "/src/assets/images/sample_prescription_india_1795586275180.jpg",
} as const;

export const STRIP_PRESET_LIBRARY = [
  {
    id: "paracetamol-strip",
    label: "White Oval Tablets (Paracetamol 650mg Strip)",
    imageUrl: GENERATED_ASSETS.stripParacetamol,
    appearance: "White oval tablet in blue-and-silver foil strip",
  },
  {
    id: "capsule-strip",
    label: "Blue & White Capsules (Copper/Silver Strip)",
    imageUrl: GENERATED_ASSETS.stripCapsule,
    appearance: "Blue and white capsule in copper-silver blister strip",
  },
  {
    id: "small-white-strip",
    label: "Small Round White Tablets (Teal-Line Silver Strip)",
    imageUrl: GENERATED_ASSETS.stripAtorvastatin,
    appearance: "Small round white tablet in silver strip with teal band",
  },
] as const;

export const LANGUAGES: Record<
  LanguageCode,
  {
    code: LanguageCode;
    label: string;
    nativeLabel: string;
    speechLocale: string;
    recognitionLocale: string;
  }
> = {
  en: {
    code: "en",
    label: "English",
    nativeLabel: "English",
    speechLocale: "en-IN",
    recognitionLocale: "en-IN",
  },
  hi: {
    code: "hi",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    speechLocale: "hi-IN",
    recognitionLocale: "hi-IN",
  },
  mr: {
    code: "mr",
    label: "Marathi",
    nativeLabel: "मराठी",
    speechLocale: "mr-IN",
    recognitionLocale: "mr-IN",
  },
};

export const VITALS_RANGES = {
  temperature_f: { min: 97.0, max: 99.5, unit: "°F", label: "Temperature" },
  bp_systolic: { min: 95, max: 135, unit: "mmHg", label: "Systolic BP" },
  bp_diastolic: { min: 60, max: 85, unit: "mmHg", label: "Diastolic BP" },
  weight_kg: { min: 40, max: 110, unit: "kg", label: "Weight" },
} as const;

export const DEFAULT_EMERGENCY_CONTACT: EmergencyContact = {
  name: "Aarav Sharma",
  relation: "Son (Primary Caregiver)",
  phone: "+91 98201 44510",
  whatsapp_phone: "919820144510",
};

export const INITIAL_VERIFIED_MEDICINES: VerifiedMedicine[] = [
  {
    id: "med-paracetamol-650",
    share_code: DEFAULT_SHARE_CODE,
    medicine_name: "Paracetamol 650mg",
    dosage: "650 mg (1 tablet)",
    frequency_code: "1-0-1",
    slots: parseFrequencyToSlots("1-0-1"),
    meal_relation: "After Food",
    duration_days: "5 days",
    ai_accuracy: "High",
    confidence_score: 0.96,
    ai_accuracy_reason: "Clearly printed foil blister label and dosage schedule.",
    caregiver_verified: true,
    verified_at: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
    verified_by: "Aarav Sharma",
    pill_appearance: "White oval tablet from the silver strip with blue band",
    simple_explanation_en:
      "Take 1 white oval Paracetamol 650mg tablet after breakfast and after dinner for mild fever or body ache.",
    simple_explanation_hi:
      "नाश्ते और रात के खाने के बाद नीली पट्टी वाली पैरासिटामोल 650 मिलीग्राम की 1 सफेद गोली पानी के साथ लें।",
    simple_explanation_mr:
      "नाश्त्यानंतर आणि रात्रीच्या जेवणानंतर निळ्या पट्टीतील पॅरासिटामॉल 650 एमजी ची 1 पांढरी गोळी पाण्यासोबत घ्या.",
    strip_image_url: GENERATED_ASSETS.stripParacetamol,
    taken_slots_today: ["Morning"],
    doctor_or_clinic: "Sunrise Family Clinic",
  },
  {
    id: "med-metaglyp-10",
    share_code: DEFAULT_SHARE_CODE,
    medicine_name: "Metaglyp 10mg",
    dosage: "10 mg (1 tablet)",
    frequency_code: "0-0-1",
    slots: parseFrequencyToSlots("0-0-1"),
    meal_relation: "After Food",
    duration_days: "30 days",
    ai_accuracy: "Medium",
    confidence_score: 0.78,
    ai_accuracy_reason: "Handwritten meal note reviewed and confirmed by caregiver.",
    caregiver_verified: true,
    verified_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    verified_by: "Aarav Sharma",
    pill_appearance: "Small round white tablet in silver strip with teal stripe",
    simple_explanation_en:
      "Take 1 small round white Metaglyp 10mg tablet at night after dinner.",
    simple_explanation_hi:
      "रात के खाने के बाद हरे-नीले निशान वाली पट्टी से 1 छोटी सफेद मेटाग्लिप 10 मिलीग्राम गोली लें।",
    simple_explanation_mr:
      "रात्रीच्या जेवणानंतर हिरव्या पट्टीतील 1 लहान पांढरी मेटाग्लिप 10 एमजी गोळी घ्या.",
    strip_image_url: GENERATED_ASSETS.stripAtorvastatin,
    taken_slots_today: [],
    doctor_or_clinic: "Sunrise Family Clinic",
  },
  {
    id: "med-neurosyn-200",
    share_code: DEFAULT_SHARE_CODE,
    medicine_name: "Neurosyn-200 Capsule",
    dosage: "200 mg (1 capsule)",
    frequency_code: "0-1-0",
    slots: parseFrequencyToSlots("0-1-0"),
    meal_relation: "After Food",
    duration_days: "14 days",
    ai_accuracy: "High",
    confidence_score: 0.94,
    ai_accuracy_reason: "Printed strip strength and doctor schedule verified.",
    caregiver_verified: true,
    verified_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
    verified_by: "Aarav Sharma",
    pill_appearance: "Blue and white capsule from the copper-colored blister strip",
    simple_explanation_en:
      "Take 1 blue and white Neurosyn capsule in the afternoon after lunch.",
    simple_explanation_hi:
      "दोपहर के खाने के बाद तांबे के रंग की पट्टी से 1 नीला-सफेद न्यूरोसिन कैप्सूल लें।",
    simple_explanation_mr:
      "दुपारच्या जेवणानंतर तांब्याच्या रंगाच्या पट्टीतील 1 निळे-पांढरे न्युरोसिन कॅप्सूल घ्या.",
    strip_image_url: GENERATED_ASSETS.stripCapsule,
    taken_slots_today: [],
    doctor_or_clinic: "Sunrise Family Clinic",
  },
];

export const INITIAL_VITALS: VitalLogEntry[] = [
  {
    id: "vital-1",
    share_code: DEFAULT_SHARE_CODE,
    recorded_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    temperature_f: 98.4,
    bp_systolic: 124,
    bp_diastolic: 78,
    weight_kg: 61.5,
    notes: "Morning check after light breakfast, feeling energetic.",
    flagged: false,
  },
  {
    id: "vital-2",
    share_code: DEFAULT_SHARE_CODE,
    recorded_at: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
    temperature_f: 98.9,
    bp_systolic: 130,
    bp_diastolic: 82,
    weight_kg: 61.8,
    notes: "Evening reading before dinner.",
    flagged: false,
  },
];
