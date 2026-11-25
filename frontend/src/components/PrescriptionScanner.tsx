import { ChangeEvent, useRef } from "react";
import {
  Camera,
  FileText,
  Loader2,
  Plus,
  ScanLine,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { GENERATED_ASSETS } from "../config";
import { StripImage } from "./StripImage";

interface PrescriptionScannerProps {
  previewImage: string;
  scanLabel: string;
  doctorOrClinic: string;
  isScanning: boolean;
  scanError: string;
  onUploadFile: (file: File, base64: string) => void;
  onRunDemoScan: (kind: "prescription" | "strip") => void;
  onAddManual: () => void;
}

export function PrescriptionScanner({
  previewImage,
  scanLabel,
  doctorOrClinic,
  isScanning,
  scanError,
  onUploadFile,
  onRunDemoScan,
  onAddManual,
}: PrescriptionScannerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        onUploadFile(file, reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
            Step 1 of 2 · AI Prescription &amp; Strip Scanner
          </p>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Upload Prescription Photo or Blister Strip
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            AI extracts dosage and timing and reports only Low, Medium, or High accuracy.
            Low and medium confidence items are highlighted in yellow for mandatory caregiver
            verification before anything appears in Grandparents Mode.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isScanning}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 min-h-[46px] px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
            <span>Upload or Capture Photo</span>
          </button>

          <button
            type="button"
            disabled={isScanning}
            onClick={onAddManual}
            className="inline-flex items-center gap-2 min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-800 dark:text-slate-100 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add Medicine Manually</span>
          </button>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Quick Demo Scans (sends sample image to POST /scan)
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => onRunDemoScan("prescription")}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-sm font-medium hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer disabled:opacity-60"
            >
              <FileText
                className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0"
                aria-hidden="true"
              />
              <span>Scan Sample Clinic Prescription</span>
            </button>

            <button
              type="button"
              disabled={isScanning}
              onClick={() => onRunDemoScan("strip")}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 text-sm font-medium hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer disabled:opacity-60"
            >
              <ScanLine
                className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0"
                aria-hidden="true"
              />
              <span>Scan Sample Blister Strip</span>
            </button>
          </div>
        </div>

        {isScanning && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 p-4 text-sm font-medium text-teal-900 dark:text-teal-200"
          >
            <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
            <span>
              Scanning image and assessing Low, Medium, or High accuracy probabilities...
            </span>
          </div>
        )}

        {scanError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-900 dark:text-red-200"
          >
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{scanError}</span>
          </div>
        )}
      </div>

      {/* Side-by-Side Source Reference */}
      <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Scanned Source Image
          </h3>
          {doctorOrClinic && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
              {doctorOrClinic}
            </span>
          )}
        </div>

        {previewImage ? (
          <div className="space-y-2">
            <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 aspect-[4/3]">
              <StripImage
                src={previewImage}
                alt={scanLabel || "Scanned prescription"}
                title={scanLabel || "Prescription Image"}
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">{scanLabel}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 flex flex-col items-center justify-center gap-3 p-6 text-center hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer"
          >
            <Upload className="w-8 h-8 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Upload a photo to compare while verifying
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Or test immediately with Sample Clinic Prescription ({GENERATED_ASSETS.samplePrescription ? "ready" : ""})
              </p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}
