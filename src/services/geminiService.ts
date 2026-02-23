import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ParsedMedicine {
  name: string;
  dosage: string;
  frequency: string;
  time_of_day: string;
  instructions: string;
  duration_days?: number;
}

export async function parseMedicineInput(input: string): Promise<ParsedMedicine> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Parse the following natural language medicine instruction into a structured JSON object: "${input}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Name of the medicine" },
          dosage: { type: Type.STRING, description: "Dosage amount (e.g., 500mg, 2 pills)" },
          frequency: { type: Type.STRING, description: "How often to take it (e.g., daily, twice a day, every 6 hours)" },
          time_of_day: { type: Type.STRING, description: "Specific times (e.g., morning, 8 AM, before bed)" },
          instructions: { type: Type.STRING, description: "Any special instructions (e.g., with food, avoid alcohol)" },
          duration_days: { type: Type.NUMBER, description: "Number of days to take it, if specified" },
        },
        required: ["name", "dosage", "frequency"],
      },
    },
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("Could not understand the medicine instructions. Please try again.");
  }
}
