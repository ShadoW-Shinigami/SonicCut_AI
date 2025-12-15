import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AudioAnalysis, Character, VideoPlan, AspectRatio } from "../types";

const parseAudioToBase64 = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:audio/mp3;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getApiKey = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }
  return apiKey;
};

/**
 * Compress base64 image to JPEG at specified quality
 * This ensures true JPEG compression and smaller file sizes
 */
const compressToJPEG = async (base64Data: string, quality: number = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Create image element
    const img = new Image();

    img.onload = () => {
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Draw image to canvas
      ctx.drawImage(img, 0, 0);

      // Export as JPEG with quality setting
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

      // Remove data URL prefix and return base64
      const base64 = compressedDataUrl.split(',')[1];
      resolve(base64);
    };

    img.onerror = () => reject(new Error("Failed to load image for compression"));

    // Load image from base64
    img.src = `data:image/jpeg;base64,${base64Data}`;
  });
};

// Helper to map app aspect ratios to supported API ratios
// Supported: '1:1', '3:4', '4:3', '9:16', '16:9'
const getSupportedAspectRatio = (ratio: AspectRatio): string => {
    const supported = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    return supported.includes(ratio) ? ratio : '16:9';
};

export const analyzeAudioCreatively = async (file: File): Promise<AudioAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const base64Audio = await parseAudioToBase64(file);

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      genre: { type: Type.STRING, description: "The musical genre of the track" },
      theme: { type: Type.STRING, description: "The emotional theme or mood" },
      instruments: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of 3 main instruments present or simulated"
      },
      bpm: { type: Type.INTEGER, description: "Estimated BPM of the track" },
      lyrics: { type: Type.STRING, description: "If there are vocals, provide the lyrics (or a summary of spoken word). If instrumental, say 'Instrumental'. Format lyrics properly" }
    },
    required: ["genre", "theme", "instruments", "lyrics"]
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: file.type || "audio/mp3",
              data: base64Audio
            }
          },
          {
            text: "Analyze this audio file. Return the Genre, Theme, Instruments, estimated BPM, and Lyrics (if any)."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text) as AudioAnalysis;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return {
      genre: "Unknown",
      theme: "Analysis Failed",
      instruments: ["Unknown"],
      lyrics: "Could not retrieve lyrics."
    };
  }
};

// --- PHASE 2: VIDEO PLANNER SERVICES ---

export const generateVideoNarrative = async (
  analysis: AudioAnalysis,
  cutCount: number,
  aspectRatio: AspectRatio
): Promise<VideoPlan> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      narrativeSummary: { type: Type.STRING, description: "A summary of the music video story (no dialogue)." },
      characters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            description: { type: Type.STRING, description: "Visual description for generating a character sheet." }
          },
          required: ["id", "name", "description"]
        }
      },
      scenes: {
        type: Type.ARRAY,
        description: `Exactly ${cutCount} scenes.`,
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "Visual description of this specific frame/shot." },
            interpolationPrompt: { type: Type.STRING, description: "A prompt for a video model to interpolate FROM this scene TO the next scene." },
            characterIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of 'id's of characters that appear in this specific scene. Leave empty if no specific character is present."
            }
          },
          required: ["description", "interpolationPrompt", "characterIds"]
        }
      }
    },
    required: ["narrativeSummary", "characters", "scenes"]
  };

  const prompt = `
    Plan a music video for a song with the following details:
    Theme: ${analysis.theme}
    Genre: ${analysis.genre}
    Lyrics/Context: ${analysis.lyrics}

    Constraints:
    1. The video must have exactly ${cutCount} shots (scenes).
    2. No dialogue. Pure visual storytelling.
	3. The Lyrics only exist to provide you context. The narrative does not have to be 1:1 what is in the lyrics or show whatever is in the lyrics as is. Just convey the feeling. This is for a music video. It can be a completely different story as long as the song makes sense when played under it. Lyrics are just a guide to give you an idea of what the music video is about.
    4. The narrative should flow smoothly, designed for morphing/interpolation between shots.
    5. Define the characters needed and assign them unique IDs.
    6. For each scene, you MUST list the 'characterIds' of any characters present.
    7. Output JSON.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });

  const text = response.text;
  if (!text) throw new Error("Failed to generate narrative");
  
  // Map result to ensure IDs align with markers if needed, though we just need the list order
  const result = JSON.parse(text);
  
  // We need to inject IDs into scenes to match later
  const mappedScenes = result.scenes.map((s: any, index: number) => ({
      ...s,
      id: `scene-${index}`,
      markerId: index.toString(), // placeholder
      startTime: 0 // placeholder
  }));

  return { ...result, scenes: mappedScenes };
};

export const generateCharacterSheet = async (
  char: Character,
  style: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [
        { text: `You will be provided with a style and a character description, go through it, understand what the character must look like and create a 2X2 grid character sheet of the character with a closeup, mid body shot, a full body shot and a backview shot of the character standing against a neutral background . Style: ${style}. ${char.description}` }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
		imageSize: "2K",
		output_mime_type: "image/jpeg"
      }
    }
  });

  // Extract image
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      // Compress to true JPEG at 85% quality
      return await compressToJPEG(part.inlineData.data, 0.85);
    }
  }
  throw new Error("No image generated for character");
};

export const generateFirstFrame = async (
  description: string,
  aspectRatio: AspectRatio,
  activeCharacters: Character[],
  style: string,
  promptModifier: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const parts: any[] = [];

  // Use the characters passed in arguments. Do not filter by text description.
  // The caller (VideoPlanner) determines who is in the shot based on the Plan.
  const validChars = activeCharacters.filter(c => c.imageUrl);

  if (validChars.length > 0) {
      // Add all character sheets as input images
      validChars.forEach(c => {
          if (c.imageUrl) {
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: c.imageUrl
                }
            });
          }
      });

      // Construct Prompt mapping images to names
      let charRefText = "The provided images are Character Reference Sheets: ";
      validChars.forEach((c, idx) => {
          charRefText += `Image ${idx + 1} represents "${c.name}". `;
      });

      parts.push({ 
          text: `Generate a scene matching the following description: "${description} ${promptModifier}".
          IMPORTANT: ${charRefText}
          You MUST ensure the characters in the generated scene look exactly like their reference images (same facial features, hair, clothing style).
          Style: ${style}. Aspect Ratio: ${aspectRatio}.` 
      });
  } else {
      // Standard generation
      parts.push({ 
          text: `Cinematic shot, ${aspectRatio}, high resolution. Style: ${style}. ${description} ${promptModifier}` 
      });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: getSupportedAspectRatio(aspectRatio),
        imageSize: "2K",
		output_mime_type: "image/jpeg"
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      // Compress to true JPEG at 85% quality
      return await compressToJPEG(part.inlineData.data, 0.85);
    }
  }
  throw new Error("No image generated for first frame");
};

/**
 * Sanitize a prompt to be safer for content moderation
 * Used for both image and video generation retries
 */
export const sanitizePrompt = async (
  originalPrompt: string,
  safetyLevel: 'moderate' | 'strict'
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const instruction = safetyLevel === 'moderate'
    ? `Rewrite this prompt to be safe for work while keeping the same narrative intent and emotional tone.
       Remove any explicit violence, sexual content, or controversial themes.
       Replace with metaphorical or artistic equivalents.
       Keep it cinematic and engaging.

       Original prompt: "${originalPrompt}"

       Respond with ONLY the rewritten prompt, nothing else.`
    : `Rewrite this prompt in an abstract, minimalist, artistic style.
       Focus on emotion, color, movement, and atmosphere rather than explicit content.
       Remove all potentially controversial elements.
       Make it poetic and safe.

       Original prompt: "${originalPrompt}"

       Respond with ONLY the rewritten prompt, nothing else.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: instruction
    });

    const rewritten = response.text?.trim();
    if (!rewritten) {
      console.warn("Failed to sanitize prompt, using fallback");
      return safetyLevel === 'moderate'
        ? `Artistic interpretation: ${originalPrompt}`
        : `Abstract, minimalist visual representation`;
    }

    return rewritten;
  } catch (e) {
    console.error("Prompt sanitization failed:", e);
    // Fallback to original with safety note
    return safetyLevel === 'moderate'
      ? `Safe, artistic version: ${originalPrompt}`
      : `Abstract, minimalist interpretation`;
  }
};

export const generateNextFrame = async (
  prevFrameBase64: string,
  description: string,
  aspectRatio: AspectRatio,
  activeCharacters: Character[],
  style: string,
  promptModifier: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  // Start with previous frame (Input 1)
  const parts: any[] = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: prevFrameBase64
      }
    }
  ];

  // Use the characters passed in arguments.
  const validChars = activeCharacters.filter(c => c.imageUrl);
  
  if (validChars.length > 0) {
     // Add character sheets (Input 2, 3...)
     validChars.forEach(c => {
         if (c.imageUrl) {
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: c.imageUrl
                }
            });
         }
     });

     // Construct Prompt
     let charRefText = "";
     validChars.forEach((c, idx) => {
         // +2 because Image 1 is the previous frame. So first char sheet is Image 2.
         charRefText += `Image ${idx + 2} is the Character Reference for "${c.name}". `;
     });

     parts.push({
         text: `Edit the first image (Previous Frame) to transition into this new scene: "${description} ${promptModifier}". 
         ${charRefText}
         Ensure all characters in the new scene maintain the visual identity defined in their respective reference images.
         Style: ${style}.`
     });
  } else {
     parts.push({
         text: `Edit the provided image to match this next scene description: "${description} ${promptModifier}". Maintain consistent style: ${style}.`
     });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: { parts },
    config: {
      imageConfig: {
          aspectRatio: getSupportedAspectRatio(aspectRatio),
		  imageSize: "2K",
		  output_mime_type: "image/jpeg"
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      // Compress to true JPEG at 85% quality
      return await compressToJPEG(part.inlineData.data, 0.85);
    }
  }
  throw new Error("No image generated for next frame");
};