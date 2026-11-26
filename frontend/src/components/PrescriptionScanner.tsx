import { prepareImageFile } from "../utils/image";
import { ChangeEvent, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Loader2,
  Plus,
  ScanLine,
  ShieldAlert,
  Upload,
} from "lucide-react";
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
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [localFileError, setLocalFileError] = useState("");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const original = event.target.files?.[0];
    event.target.value = "";
    setShowSourceMenu(false);
    setLocalFileError("");
    if (!original) return;

    let file: File;
    try {
      file = await prepareImageFile(original);
    } catch (err: unknown) {
      setLocalFileError(
        err instanceof Error ? err.message : "Please choose an image file.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        onUploadFile(file, reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            Step 1 of 2 · Prescription &amp; Strip Scanner
          </p>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Upload Prescription Photo or Blister Strip
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Extracts medicine names, dosage, and timing with Low, Medium, or High
            confidence ratings. Unclear items are highlighted in yellow so a
            caregiver confirms every dose before it appears in Grandparents Mode.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          aria-label="Choose prescription or pill strip photo from files or gallery"
          className="hidden"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          aria-label="Take a photo of the prescription or pill strip"
          className="hidden"
        />

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            disabled={isScanning}
            aria-expanded={showSourceMenu}
            onClick={() => setShowSourceMenu((v) => !v)}
            className="inline-flex items-center justify-center gap-2 min-h-[46px] px-5 py-2.5 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
            <span>Upload or Capture Photo</span>
          </button>

          {showSourceMenu && (
            <div role="group" aria-label="Choose photo source" className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-md border border-teal-700 text-teal-800 dark:text-teal-300 text-sm font-bold cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Take Photo</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-md border border-teal-700 text-teal-800 dark:text-teal-300 text-sm font-bold cursor-pointer"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span>Choose from Files / Gallery</span>
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={isScanning}
            onClick={onAddManual}
            className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add Medicine Manually</span>
          </button>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Quick Demo Scans
          </p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => onRunDemoScan("prescription")}
              className="inline-flex items-center justify-center sm:justify-start gap-2 min-h-[44px] px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-200 text-sm font-medium hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer disabled:opacity-60"
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
              className="inline-flex items-center justify-center sm:justify-start gap-2 min-h-[44px] px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-200 text-sm font-medium hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer disabled:opacity-60"
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
            aria-live="polite"
            className="flex items-center gap-3 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 p-4 text-sm font-medium text-teal-900 dark:text-teal-200"
          >
            <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
            <span>
              Reading image and rating Low, Medium, or High accuracy for each medicine...
            </span>
          </div>
        )}

        {(scanError || localFileError) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-900 dark:text-red-200"
          >
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{scanError || localFileError}</span>
          </div>
        )}
      </div>

      {/* Side-by-Side Source Reference */}
      <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Scanned Source Image
          </h3>
          {doctorOrClinic && (
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
              {doctorOrClinic}
            </span>
          )}
        </div>

        {previewImage ? (
          <div className="space-y-2">
            <div className="rounded-md overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 aspect-[4/3]">
              <StripImage
                src={previewImage}
                alt={scanLabel || "Scanned prescription"}
                title={scanLabel || "Prescription Image"}
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">{scanLabel}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full aspect-[4/3] rounded-md border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 flex flex-col items-center justify-center gap-3 p-6 text-center hover:border-teal-600 dark:hover:border-teal-400 transition-colors cursor-pointer"
          >
            <Upload className="w-8 h-8 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Upload a photo to compare side-by-side while verifying
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Or test immediately using a sample prescription or blister strip
              </p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}
