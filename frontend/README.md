# NaniCare Frontend

NaniCare is a family medication and wellness companion. The frontend provides separate caregiver and grandparent experiences so caregivers can review medicine details and older adults can follow a clear, accessible schedule.

## What’s in the project

- **Caregiver mode:** Upload or capture a prescription or medicine-strip image, review the extracted medicine details, and confirm which medicines are safe to share. Caregivers can also manage emergency contact information and check dose activity.
- **Grandparents mode:** View caregiver-verified medicines, filter by time of day, hear instructions read aloud, and mark doses as taken. Voice commands support English, Hindi, and Marathi where the browser provides speech recognition and speech synthesis.
- **Vitals:** Record temperature, blood pressure, weight, and notes; view a summary and prepare a daily report to share through WhatsApp.
- **Shared profile:** A share code connects caregiver and grandparents views to the same medicine schedule, dose status, emergency contact, and vitals.
- **Interface options:** Light and dark themes, sample prescription and medicine-strip images, and responsive layouts.

Prescription image analysis is handled by the Express server in `server.ts` using the Gemini API. Extracted information is presented for caregiver review; the app is designed to show and read aloud only caregiver-verified medicines. Follow the prescribing clinician’s instructions.

## Tech stack

- React 19 and TypeScript
- Vite 8 with Tailwind CSS 4
- Express server for the Gemini-powered prescription scan endpoint
- Lucide icons and Motion animations

## Run locally

**Requirements:** Node.js and npm.

From this directory (`frontend/`):

```bash
npm install
```

Create a `.env` file in this directory (see `.env.example`):

```env
# Recommended: connect to FastAPI backend
VITE_API_URL=http://localhost:8000

# Optional: only needed in standalone Express preview mode (when VITE_API_URL is unset)
# GEMINI_API_KEY=your_gemini_api_key
# GEMINI_MODEL=gemini-3.5-flash
```

Start the app and server together:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development server runs Express and mounts Vite middleware; the scan endpoint is available at `POST /api/scan`, and `GET /api/health` reports server health.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Express server with Vite in development mode. |
| `npm run build` | Build the frontend into `dist/`. |
| `npm run preview` | Preview the Vite production build. |
| `npm start` | Start the server in production mode. Set `NODE_ENV=production` and build first. |
| `npm run lint` | Run TypeScript type checking (`tsc --noEmit`). |
| `npm run clean` | Remove the generated `dist/` directory and `server.js`. |

The server listens on port `3000`. In production mode it serves the `dist/` build when that directory exists.
