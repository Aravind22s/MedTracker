import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function getChatResponse(history: ChatMessage[], message: string) {
  const chat = ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction: "You are a helpful medical assistant for the MedTrack AI app. You help users understand their medications, provide general health advice, and answer questions about medicine adherence. Always remind users to consult with a professional doctor for serious medical concerns. You have access to the user's current context if provided.",
    },
  });

  // Convert history to Gemini format
  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const response = await chat.sendMessage({
    message: message,
  });

  return response.text;
}
