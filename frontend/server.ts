import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const SCAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    document_type: {
      type: Type.STRING,
      description:
        "Type of image scanned: 'Prescription', 'Medicine Strip', or 'Unknown'",
    },
    doctor_or_clinic: {
      type: Type.STRING,
      description: "Doctor or clinic name if visible, otherwise empty string.",
    },
    general_warning: {
      type: Type.STRING,
      description:
        "Any brief overall readability note for the caregiver (e.g., blurred region or handwritten note detected).",
    },
    medicines: {
      type: Type.ARRAY,
      description: "List of extracted medicines from the image.",
      items: {
        type: Type.OBJECT,
        properties: {
          medicine_name: {
            type: Type.STRING,
            description: "Medicine brand or generic name.",
          },
          dosage: {
            type: Type.STRING,
            description: "Strength and dose per intake, e.g., '650 mg (1 tablet)'.",
          },
          frequency_code: {
            type: Type.STRING,
            description:
              "Standard 3-part Indian schedule code (Morning-Afternoon-Night), e.g., '1-0-1', '1-0-0', '0-0-1', or '1-1-1'. Default to '1-0-0' if unclear.",
          },
          meal_relation: {
            type: Type.STRING,
            description:
              "One of: 'Before Food', 'After Food', 'With Food', or 'Anytime'.",
          },
          duration_days: {
            type: Type.STRING,
            description: "Duration such as '5 days', '30 days', or 'Ongoing'.",
          },
          ai_accuracy: {
            type: Type.STRING,
            description:
              "Strict probability level of extraction accuracy: 'High', 'Medium', or 'Low'. Use 'Low' or 'Medium' whenever handwriting, smudge, blur, or missing schedule requires caregiver verification.",
          },
          ai_accuracy_reason: {
            type: Type.STRING,
            description:
              "Short plain-language reason why AI rated accuracy High, Medium, or Low (e.g. 'Clearly printed foil label' or 'Handwritten meal note needs caregiver confirmation').",
          },
          pill_appearance: {
            type: Type.STRING,
            description:
              "Visual description of the tablet/capsule/strip if visible or commonly known, e.g., 'White oval tablet in silver-blue strip'.",
          },
          simple_explanation_en: {
            type: Type.STRING,
            description:
              "Warm, clear single-sentence spoken instruction in English for an elderly grandparent.",
          },
          simple_explanation_hi: {
            type: Type.STRING,
            description:
              "Warm, natural spoken Hindi (Devanagari script) instruction for an elderly grandparent.",
          },
          simple_explanation_mr: {
            type: Type.STRING,
            description:
              "Warm, natural spoken Marathi (Devanagari script) instruction for an elderly grandparent.",
          },
        },
        required: [
          "medicine_name",
          "dosage",
          "frequency_code",
          "meal_relation",
          "duration_days",
          "ai_accuracy",
          "ai_accuracy_reason",
          "pill_appearance",
          "simple_explanation_en",
          "simple_explanation_hi",
          "simple_explanation_mr",
        ],
      },
    },
  },
  required: ["document_type", "doctor_or_clinic", "general_warning", "medicines"],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/scan", async (req, res) => {
    try {
      const { imageBase64, mimeType, scanHint } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        scanHint?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== "string") {
        res.status(400).json({
          error: "Please upload or capture an image of a prescription or medicine strip.",
        });
        return;
      }

      const cleanedBase64 = imageBase64.includes(",")
        ? imageBase64.split(",")[1]
        : imageBase64;
      const safeMimeType =
        typeof mimeType === "string" && mimeType.startsWith("image/")
          ? mimeType
          : "image/jpeg";

      const ai = getGeminiClient();

      const promptText = `You are a careful clinical prescription and pharmaceutical packaging reader assisting a family caregiver.
Analyze the provided image (${scanHint || "prescription or medicine strip"}) and extract every visible medicine into structured JSON.

CRITICAL SAFETY RULES:
1. Never guess recklessly. Rate each medicine's extraction accuracy strictly as "High", "Medium", or "Low".
2. Use "Low" if handwriting is ambiguous, dosage digits could be misread, or key timing is missing.
3. Use "Medium" if a handwritten note, partial glare, or assumed standard timing (like on a standalone blister strip without a doctor's frequency) needs the caregiver to confirm.
4. Use "High" only when the medicine name, strength, and timing are clearly printed and unambiguous.
5. Convert schedules into standard Morning-Afternoon-Night format (e.g., "1-0-1" for twice daily morning & night, "1-0-0" for morning only, "0-0-1" for bedtime/night only, "1-1-1" for three times daily).
6. Write warm, simple, easy-to-hear spoken instructions for an elderly grandparent in English, Hindi (Devanagari), and Marathi (Devanagari).
7. If the image is a standalone medicine strip without dosage schedule printed, extract the medicine name and strength accurately, set frequency_code to "1-0-0", set ai_accuracy to "Medium", and state in ai_accuracy_reason that schedule timing is not printed on the strip and must be verified by the caregiver.`;

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMimeType,
                data: cleanedBase64,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: SCAN_RESPONSE_SCHEMA,
        },
      });

      const rawText = (response.text ?? "").trim();
      if (!rawText) {
        res.status(502).json({
          error: "The scanner returned an empty response. Please try a clearer photo.",
        });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to scan image.";
      console.error("Scan API error:", err);

      const lower = message.toLowerCase();
      if (lower.includes("api_key") || lower.includes("permission_denied") || lower.includes("403")) {
        res.status(403).json({
          error:
            "Gemini API key is missing or invalid. Please check your key in Settings > Secrets.",
        });
        return;
      }
      if (lower.includes("429") || lower.includes("resource_exhausted")) {
        res.status(429).json({
          error:
            "API rate limit reached. Please wait a moment and try scanning again.",
        });
        return;
      }

      res.status(500).json({
        error: `Could not analyze prescription image: ${message}`,
      });
    }
  });

  const isProd = process.env.NODE_ENV === "production";
  const distDir = path.resolve(__dirname, "dist");

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`NaniCare server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
