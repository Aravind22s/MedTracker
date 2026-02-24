import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function getChatResponse(history: ChatMessage[], message: string, language: string = 'en') {
  const chat = ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction: `You are a helpful medical assistant for the MedTrack AI app. You help users understand their medications, provide general health advice, and answer questions about medicine adherence. Always remind users to consult with a professional doctor for serious medical concerns. You have access to the user's current context if provided. Please respond in ${language} language. Use Markdown formatting (bolding, lists, etc.) to make your responses clear and easy to read.`,
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

export async function getBehavioralAnalysisInsights(stats: any, language: string = 'en') {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following medicine intake behavior data and provide 3-4 actionable insights or observations. 
    Data: ${JSON.stringify(stats)}
    
    Focus on:
    1. Consistency (Are they taking it on time?)
    2. Patterns (Are certain days or medicines more problematic?)
    3. Encouragement (Highlight what they are doing well)
    
    Please respond in ${language} language. Use Markdown for formatting. Keep it concise and supportive. Always include a disclaimer.`,
  });
  
  return response.text;
}

export async function translateText(text: string, targetLanguage: string) {
  if (!text || !targetLanguage || targetLanguage === 'en') return text;
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Translate the following text to ${targetLanguage}. Return ONLY the translated text without any explanations or extra characters: "${text}"`,
  });
  
  return response.text || text;
}

export async function getMedicineInsights(medicineName: string, dosage: string, frequency: string, instructions?: string, language: string = 'en') {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Provide a brief, helpful insight and usage guide for the following medication:
    Name: ${medicineName}
    Dosage: ${dosage}
    Frequency: ${frequency}
    Instructions: ${instructions || 'None'}
    
    Please respond in ${language} language. Use Markdown for formatting. Keep it concise (under 150 words). Always include a disclaimer that this is AI-generated and not professional medical advice.`,
  });
  
  return response.text;
}
