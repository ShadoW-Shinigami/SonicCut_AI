import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AudioAnalysis, Character, Location, VideoPlan, AspectRatio, HierarchyTree, HierarchyNode, TransformationDelta } from "../types";

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

/**
 * Add text label at the top of an image using canvas
 */
const addTextLabelToImage = async (
  base64Data: string,
  label: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const labelHeight = 40;
      canvas.width = img.width;
      canvas.height = img.height + labelHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Black bar at top
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, labelHeight);

      // White text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, canvas.width / 2, labelHeight / 2);

      // Draw original image below
      ctx.drawImage(img, 0, labelHeight);

      const labeledDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = labeledDataUrl.split(',')[1];
      resolve(base64);
    };

    img.onerror = () => reject(new Error("Failed to load image for labeling"));
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
      theme: { type: Type.STRING, description: "The emotional theme or mood AND the gender of the singer if applicable" },
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
      model: "gemini-3-flash-preview", 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: file.type || "audio/mp3",
              data: base64Audio
            }
          },
          {
            text: "Analyze this audio file. Return the Genre, Theme (Include the gender of the singer in the theme), Instruments, estimated BPM, and Lyrics (if any with proper formatting). Double check and ensure that the JSON is valid. Pay extra close attention to the lyrics section."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
		thinkingConfig: {
			thinkingLevel: 'HIGH',
      }
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
  aspectRatio: AspectRatio,
  userFeedback?: string
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
      locations: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            description: {
              type: Type.STRING,
              description: "Visual description emphasizing architectural elements, environment, spatial layout for wide-angle reference. Be specific about the type of location."
            }
          },
          required: ["id", "name", "description"]
        }
      },
      scenes: {
        type: Type.ARRAY,
        description: `Must generate exactly ${cutCount} shots. This is critical - the number must match exactly.`,
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "Visual description of this specific shot/frame." },
            interpolationPrompt: { type: Type.STRING, description: "A prompt for a video model to interpolate FROM this shot TO the next shot." },
            characterIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of 'id's of characters that appear in this specific shot. Leave empty if no specific character is present."
            },
            locationIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Array of location IDs where this shot takes place"
            }
          },
          required: ["description", "interpolationPrompt", "characterIds", "locationIds"]
        }
      }
    },
    required: ["narrativeSummary", "characters", "locations", "scenes"]
  };

  const feedbackSection = userFeedback
    ? `\n\nUser Feedback/Direction: ${userFeedback}\nPlease incorporate this feedback into the narrative plan.`
    : '';

  const prompt = `Plan a music video for a song with exactly ${cutCount} shots.

Theme: ${analysis.theme}
Genre: ${analysis.genre}
Lyrics/Context: ${analysis.lyrics}

Requirements:
1. Exactly ${cutCount} shots - CRITICAL: Generate exactly ${cutCount} shots, no more, no less
2. Define the characters needed with objective physical descriptions (gender, age, ethnicity, hair, objective outfit) and assign them unique IDs
3. Define locations with detailed environmental descriptions (architecture, environment, spatial layout) and assign it a locationID
4. For each shot: list characterIds AND locationIds (both arrays)
5. No dialogue, pure visual storytelling
6. Flow smoothly, designed for morphing/interpolation between shots
7. Output JSON.${feedbackSection}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingLevel: 'HIGH'  // High-level thinking for better reasoning
      }
    } as any
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

/**
 * Fix shot count mismatch by asking Gemini to adjust the existing plan
 */
export const adjustShotCount = async (
  videoPlan: VideoPlan,
  targetCount: number
): Promise<VideoPlan> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const currentCount = videoPlan.scenes.length;
  const diff = targetCount - currentCount;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      scenes: {
        type: Type.ARRAY,
        description: `Adjusted shots array with exactly ${targetCount} shots`,
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            interpolationPrompt: { type: Type.STRING },
            characterIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            locationIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["description", "interpolationPrompt", "characterIds", "locationIds"]
        }
      }
    },
    required: ["scenes"]
  };

  let prompt;
  if (diff > 0) {
    // Need to add shots
    prompt = `
You created a music video storyboard with ${currentCount} shots, but we need exactly ${targetCount} shots (${diff} more).

Current narrative: ${videoPlan.narrativeSummary}

Characters (use these exact IDs when assigning to shots):
${videoPlan.characters.map(c => `- ID: "${c.id}", Name: ${c.name}, Description: ${c.description}`).join('\n')}

Locations (use these exact IDs when assigning to shots):
${videoPlan.locations.map(loc => `- ID: "${loc.id}", Name: ${loc.name}, Description: ${loc.description}`).join('\n')}

Current shots:
${videoPlan.scenes.map((s, i) => `${i + 1}. ${s.description} [CharacterIDs: ${JSON.stringify(s.characterIds || [])}, LocationIDs: ${JSON.stringify(s.locationIds || [])}]`).join('\n')}

TASK: Add ${diff} more shot(s) to make it exactly ${targetCount} shots total. The new shots should:
1. Fit naturally into the narrative flow
2. Be inserted at logical points (not just at the end)
3. Maintain character consistency
4. Keep the story coherent

IMPORTANT - Attribution:
- Each shot MUST have a characterIds array AND a locationIds array
- Use ONLY the character/location IDs listed above
- If a shot has no characters/locations, use an empty array: []
- Make sure appearances make narrative sense

Return ALL ${targetCount} shots (including the original ones) in the correct order.
`;
  } else {
    // Need to remove shots (diff is negative)
    const toRemove = Math.abs(diff);
    prompt = `
You created a music video storyboard with ${currentCount} shots, but we need exactly ${targetCount} shots (${toRemove} fewer).

Current narrative: ${videoPlan.narrativeSummary}

Characters (use these exact IDs when assigning to shots):
${videoPlan.characters.map(c => `- ID: "${c.id}", Name: ${c.name}, Description: ${c.description}`).join('\n')}

Locations (use these exact IDs when assigning to shots):
${videoPlan.locations.map(loc => `- ID: "${loc.id}", Name: ${loc.name}, Description: ${loc.description}`).join('\n')}

Current shots:
${videoPlan.scenes.map((s, i) => `${i + 1}. ${s.description} [CharacterIDs: ${JSON.stringify(s.characterIds || [])}, LocationIDs: ${JSON.stringify(s.locationIds || [])}]`).join('\n')}

TASK: Remove or merge ${toRemove} shot(s) to make it exactly ${targetCount} shots total. When removing:
1. Keep the most important/impactful shots
2. Merge similar consecutive shots if possible
3. Maintain narrative flow
4. Keep character consistency

IMPORTANT - Attribution:
- Each shot MUST have a characterIds array AND a locationIds array
- Use ONLY the character/location IDs listed above
- If a shot has no characters/locations, use an empty array: []
- Make sure appearances make narrative sense

Return exactly ${targetCount} shots in the correct order.
`;
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingLevel: 'HIGH'  // High-level thinking for better reasoning
      }
    } as any
  });

  const text = response.text;
  if (!text) throw new Error("Failed to adjust shot count");

  const result = JSON.parse(text);

  // Map result with IDs
  const adjustedScenes = result.scenes.map((s: any, index: number) => ({
    ...s,
    id: `scene-${index}`,
    markerId: index.toString(),
    startTime: 0
  }));

  return {
    ...videoPlan,
    scenes: adjustedScenes
  };
};

export const generateCharacterSheet = async (
  char: Character,
  style: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `Create a 2x2 grid character reference sheet with 4 views of the same character.

Character: ${char.description}
Style: ${style}

CRITICAL REQUIREMENTS:
- 2x2 grid layout: top-left = face closeup, top-right = 3/4 view, bottom-left = full body front, bottom-right = full body back
- Same outfit across all 4 views
- Neutral expression in all views
- Neutral lighting (soft, even)
- Plain neutral background
- Suitable for reference matching in other images
- No text or labels in the generated image
- Maintain exact same visual identity across all 4 views`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [
        { text: prompt }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
		imageSize: "2K",
		output_mime_type: "image/jpeg"
      } as any
    }
  });

  // Extract image
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      // Compress to true JPEG at 85% quality
      const compressedBase64 = await compressToJPEG(part.inlineData.data, 0.85);
      // Add character name label at top
      return await addTextLabelToImage(compressedBase64, char.name);
    }
  }
  throw new Error("No image generated for character");
};

/**
 * Generate single wide-angle location reference image
 */
export const generateLocationReference = async (
  location: Location,
  style: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const prompt = `Create a wide-angle establishing shot of this location:

Location: ${location.description}
Style: ${style}

CRITICAL REQUIREMENTS:
- Wide-angle view showing maximum context and spatial layout
- Capture key architectural elements and environmental features
- Neutral, balanced composition
- Show enough detail for closer shots to be derived from this view
- No characters or people in the shot
- No text or labels in the generated image
- Cinematographic quality appropriate for music video`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "2K",
        output_mime_type: "image/jpeg"
      } as any
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      const compressedBase64 = await compressToJPEG(part.inlineData.data, 0.85);
      return await addTextLabelToImage(compressedBase64, location.name);
    }
  }
  throw new Error("No image generated for location");
};

export const generateFirstFrame = async (
  description: string,
  aspectRatio: AspectRatio,
  activeCharacters: Character[],
  activeLocations: Location[],
  style: string,
  promptModifier: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const parts: any[] = [];

  // Use the characters and locations passed in arguments. Do not filter by text description.
  // The caller (VideoPlanner) determines what's in the shot based on the Plan.
  const validChars = activeCharacters.filter(c => c.imageUrl);
  const validLocs = activeLocations.filter(loc => loc.imageUrl);

  if (validChars.length > 0 || validLocs.length > 0) {
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

      // Add location references
      validLocs.forEach(loc => {
          if (loc.imageUrl) {
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: loc.imageUrl
                }
            });
          }
      });

      // Construct Prompt mapping images to names
      let charRefText = "The provided images are Character Reference Sheets: ";
      validChars.forEach((c, idx) => {
          charRefText += `Image ${idx + 1} represents "${c.name}". `;
      });

      let locRefText = "";
      if (validLocs.length > 0) {
          locRefText = "Location References: ";
          validLocs.forEach((loc, idx) => {
              locRefText += `Image ${validChars.length + idx + 1} shows "${loc.name}". `;
          });
      }

      parts.push({
          text: `Generate a scene matching the following description: "${description} ${promptModifier}".

${charRefText}
${locRefText}

You MUST match the visual identity of characters and the environment/architecture of locations from their reference images.
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
      } as any
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

/**
 * Generate vision-based edit instructions using best practices
 */
export const generateEditInstructions = async (
  parentImageBase64: string,
  childDescription: string,
  activeCharacters: Character[],
  activeLocations: Location[]
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  let characterContext = "";
  if (activeCharacters.length > 0) {
    const names = activeCharacters.map(c => c.name).join(", ");
    characterContext = `\nCharacters in scene: ${names}`;
  }

  let locationContext = "";
  if (activeLocations.length > 0) {
    locationContext = `\nLocation: ${activeLocations.map(loc => loc.name).join(", ")}`;
  }

  const prompt = `You are an expert image editing prompter for AI image-to-image models.

ANALYZE the provided image and generate PRECISE edit instructions to transform it into the target scene.

Target Scene: ${childDescription}${characterContext}${locationContext}

IMPORTANT: The image contains labeled character sheets and location references. You can refer to characters BY NAME since they have labels.

BEST PRACTICES FOR EDIT PROMPTS:
1. Start with "Edit the image:" prefix
2. Specify what to KEEP (preserve background, maintain character identity by name)
3. Specify what to CHANGE (camera angle, framing, position, action)
4. State EXACT character count (e.g., "EXACTLY 2 characters visible")
5. Frame as incremental change from current image (zoom in, pan left, etc.)
6. Use character names to refer to them (since character sheets are labeled)
7. Explicit camera operations (dolly in/out, zoom, pan, tilt)
8. Include negative constraints

GOOD EXAMPLE:
"Edit the image: Keep the cyberpunk street background and neon lighting. Zoom in 2x to frame Luna more closely, making her face occupy 50% of frame height. EXACTLY 1 character visible. Maintain Luna's exact appearance. DO NOT duplicate characters. DO NOT change background style."

BAD EXAMPLE:
"Show the character closer up in the street" (vague, no name, no preservation details)

Generate complete edit prompt following these best practices:`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: parentImageBase64
          }
        },
        { text: prompt }
      ]
    },
    config: {
      thinkingConfig: {
        thinkingLevel: 'HIGH'
      }
    }
  });

  const editInstructions = response.text?.trim();
  if (!editInstructions) {
    throw new Error("No edit instructions generated");
  }

  return editInstructions;
};

export const generateNextFrame = async (
  prevFrameBase64: string,
  description: string,
  aspectRatio: AspectRatio,
  activeCharacters: Character[],
  activeLocations: Location[],
  style: string,
  promptModifier: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  // Generate vision-based edit instructions
  const editInstructions = await generateEditInstructions(
    prevFrameBase64,
    description,
    activeCharacters,
    activeLocations
  );

  // Start with previous frame (Input 1)
  const parts: any[] = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: prevFrameBase64
      }
    }
  ];

  // Add character sheets
  const validChars = activeCharacters.filter(c => c.imageUrl);
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

  // Add location references
  const validLocs = activeLocations.filter(loc => loc.imageUrl);
  validLocs.forEach(loc => {
    if (loc.imageUrl) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: loc.imageUrl
        }
      });
    }
  });

  // Build reference text
  let referenceText = "";
  let imageIndex = 2; // Image 1 is previous frame

  validChars.forEach((c) => {
    referenceText += `Image ${imageIndex} is Character Reference: ${c.description}. `;
    imageIndex++;
  });

  validLocs.forEach((loc) => {
    referenceText += `Image ${imageIndex} is Location Reference: ${loc.description}. `;
    imageIndex++;
  });

  parts.push({
    text: `${editInstructions}

${referenceText ? `REFERENCES:\n${referenceText}\n` : ''}
Match references exactly for character identity and location environment.
${promptModifier ? `\nModifier: ${promptModifier}` : ''}
Style: ${style}.

CRITICAL CONSTRAINTS:
- DO NOT duplicate characters
- DO NOT change background style unless edit instructions specify
- DO NOT add new people beyond specified count
- DO NOT alter character count`
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: { parts },
    config: {
      imageConfig: {
          aspectRatio: getSupportedAspectRatio(aspectRatio),
		  imageSize: "2K",
		  output_mime_type: "image/jpeg"
      } as any
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

/**
 * Helper function to build HierarchyTree from Gemini's response
 */
const buildHierarchyTree = (
  geminiResult: any,
  sceneCount: number
): HierarchyTree => {
  const nodes: HierarchyNode[] = new Array(sceneCount);
  const parentSet = new Set(geminiResult.parentIndices);

  // Initialize all nodes
  for (let i = 0; i < sceneCount; i++) {
    const isParent = parentSet.has(i);
    nodes[i] = {
      frameIndex: i,
      depth: isParent ? 0 : -1, // Will calculate depth later
      parentIndex: isParent ? null : -1,
      childIndices: [],
      transformationDelta: null,
      isReady: isParent, // Parents are immediately ready
      score: undefined
    };
  }

  // Set scores for parents
  geminiResult.anchorScores.forEach((scoreData: any) => {
    if (nodes[scoreData.frameIndex]) {
      nodes[scoreData.frameIndex].score = scoreData.score;
    }
  });

  // Build relationships
  geminiResult.relationships.forEach((rel: any) => {
    const childIdx = rel.childIndex;
    const parentIdx = rel.parentIndex;

    if (nodes[childIdx] && nodes[parentIdx]) {
      nodes[childIdx].parentIndex = parentIdx;
      nodes[parentIdx].childIndices.push(childIdx);
    }
  });

  // Calculate depths properly (after all relationships are set)
  const calculateDepth = (nodeIndex: number): number => {
    const node = nodes[nodeIndex];
    if (node.depth >= 0) return node.depth; // Already calculated
    if (node.parentIndex === null) {
      node.depth = 0;
      return 0;
    }
    node.depth = calculateDepth(node.parentIndex) + 1;
    return node.depth;
  };

  // Calculate depth for all nodes
  for (let i = 0; i < sceneCount; i++) {
    if (nodes[i].depth === -1) {
      calculateDepth(i);
    }
  }

  // Validate and fix circular references
  const fixedNodes = new Set<number>();

  nodes.forEach((node, idx) => {
    // Fix nodes at depth 0 with non-null parents
    if (node.depth === 0 && node.parentIndex !== null) {
      console.warn(`⚠️ Node ${idx} at depth 0 has parent ${node.parentIndex}. Fixing to make it a true parent.`);

      // Remove this node from its parent's childIndices (circular reference)
      const oldParent = nodes[node.parentIndex];
      if (oldParent) {
        oldParent.childIndices = oldParent.childIndices.filter(childIdx => childIdx !== idx);
      }

      node.parentIndex = null;
      fixedNodes.add(idx);
    }

    // Remove self-references from childIndices (node cannot be its own child)
    node.childIndices = node.childIndices.filter(childIdx => childIdx !== idx);
  });

  // Detect and break circular references in parent chains
  const detectCycle = (nodeIndex: number, visited: Set<number>): boolean => {
    if (visited.has(nodeIndex)) return true; // Cycle detected
    if (nodes[nodeIndex].parentIndex === null) return false; // Reached root

    visited.add(nodeIndex);
    return detectCycle(nodes[nodeIndex].parentIndex!, visited);
  };

  nodes.forEach((node, idx) => {
    if (node.parentIndex !== null) {
      const visited = new Set<number>();
      if (detectCycle(idx, visited)) {
        console.warn(`⚠️ Node ${idx} has circular parent chain. Making it a root parent.`);

        // Remove from old parent's children
        if (node.parentIndex >= 0 && nodes[node.parentIndex]) {
          nodes[node.parentIndex].childIndices = nodes[node.parentIndex].childIndices.filter(
            childIdx => childIdx !== idx
          );
        }

        // Make it a parent
        node.parentIndex = null;
        node.depth = 0;
        fixedNodes.add(idx);
      }
    }
  });

  // Calculate max depth
  const maxDepth = Math.max(...nodes.map(n => n.depth));

  return {
    nodes,
    parentIndices: Array.from(new Set([...geminiResult.parentIndices, ...Array.from(fixedNodes)])),
    maxDepth
  };
};

/**
 * Generate hierarchical plan by analyzing narrative and identifying anchor frames
 */
export const generateHierarchicalPlan = async (
  videoPlan: VideoPlan
): Promise<HierarchyTree> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      parentIndices: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description: "Array of frame indices that should be anchor/parent frames (0-indexed)"
      },
      relationships: {
        type: Type.ARRAY,
        description: "Parent-child relationships",
        items: {
          type: Type.OBJECT,
          properties: {
            childIndex: { type: Type.INTEGER },
            parentIndex: { type: Type.INTEGER },
            reason: { type: Type.STRING, description: "Why this parent was chosen" }
          },
          required: ["childIndex", "parentIndex", "reason"]
        }
      },
      anchorScores: {
        type: Type.ARRAY,
        description: "Score for each parent (0-100)",
        items: {
          type: Type.OBJECT,
          properties: {
            frameIndex: { type: Type.INTEGER },
            score: { type: Type.INTEGER }
          },
          required: ["frameIndex", "score"]
        }
      }
    },
    required: ["parentIndices", "relationships", "anchorScores"]
  };

  const prompt = `
You are a shot optimization specialist. Organize these shots into parent-child relationships for efficient AI image generation using edit models.

## CRITICAL RULE
Parent shot must contain equal or greater visual context than its children. Image edit models can CROP/ZOOM IN but cannot EXPAND CONTEXT.

## Shots to Organize:
${videoPlan.scenes.map((s, i) => `[${i}] ${s.description}`).join('\n')}

Narrative context: ${videoPlan.narrativeSummary}

## Task: Create Multi-Level Hierarchy

### Parent Selection (Based on VISUAL CONTEXT, not timeline order)
A shot becomes a parent when it has the MOST visual context for a location + character group.

**Context Levels:** WIDE > MEDIUM > CLOSE-UP > EXTREME CLOSE-UP

**Process:**
1. Group shots by location + character set
2. Identify the WIDEST shot in each group = parent
3. Narrower shots = children of that parent
4. Children can themselves be parents of even narrower shots (multi-level)

### Multi-Level Hierarchy Example
Progressive cropping creates depth:
- Parent (WIDE): Full environment
  ├─ Child (MEDIUM): Cropped region
  │  ├─ Grandchild (CLOSE): Crop from medium
  │  │  └─ Great-grandchild (EXTREME): Crop from close
  │  └─ Grandchild (CLOSE): Different crop from medium
  └─ Child (MEDIUM): Different area of parent

### When to Create New Parent
ONLY create new parent when:
- Different location (cannot derive from existing parents)
- No overlapping visual context with existing parents
- Major environmental change (same location but unrecognizable)

**Red Flag:** 5+ parents for same location = probably wrong. Most locations need 1-2 parents.

### Cross-Scene Relationships
Shots from different scenes CAN share parents if same location + characters.
Example: SHOT_5 and SHOT_67 both in cafe → use SHOT_5 (wide cafe) as parent for SHOT_67 (close-up in cafe)

## Output Requirements
For each non-parent shot:
- Assign to the parent with the CLOSEST matching context
- If shot can be cropped from an existing child → make it a grandchild (deeper hierarchy)
- Build deepest hierarchy possible using progressive cropping

Prefer FEWER parents with DEEPER hierarchies over MANY parents with shallow hierarchies.
`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingLevel: 'HIGH'  // High-level thinking for better reasoning
      }
    } as any
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini for hierarchical plan");

  const result = JSON.parse(text);

  // Debug logging
  console.log("Hierarchy generation result:", {
    parentIndices: result.parentIndices,
    relationshipCount: result.relationships.length,
    sceneCount: videoPlan.scenes.length
  });

  // Build HierarchyTree from Gemini's response
  const tree = buildHierarchyTree(result, videoPlan.scenes.length);

  console.log("Built hierarchy tree:", {
    parentCount: tree.parentIndices.length,
    maxDepth: tree.maxDepth,
    depths: tree.nodes.map(n => n.depth)
  });

  return tree;
};

/**
 * Generate literal transformation instructions between parent and child frames
 */
export const generateTransformationDelta = async (
  parentDescription: string,
  childDescription: string,
  parentImageBase64: string
): Promise<TransformationDelta> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      cameraOperation: {
        type: Type.STRING,
        description: "Literal camera movement (dolly, pan, zoom, orbit, etc.)"
      },
      framingChange: {
        type: Type.STRING,
        description: "Objective framing changes (subject size, position in frame)"
      },
      backgroundElements: {
        type: Type.STRING,
        description: "Which background elements to maintain/modify"
      },
      literalInstructions: {
        type: Type.STRING,
        description: "Complete literal edit instructions combining all above"
      }
    },
    required: ["cameraOperation", "framingChange", "backgroundElements", "literalInstructions"]
  };

  const prompt = `
You are a cinematographer. Analyze this parent scene and generate LITERAL editing instructions to transform it into the child scene.

Parent Scene: ${parentDescription}
Child Scene: ${childDescription}

CRITICAL: Provide OBJECTIVE, TECHNICAL instructions, NOT poetic descriptions.

Think like a camera operator and compositor:
- Camera Operation: "Dolly forward 2x", "Pan left 45 degrees", "Zoom in 1.5x on subject"
- Framing Change: "Character occupies 60% frame height", "Subject moves from center to right third"
- Background Elements: "Maintain window in background", "Keep city skyline visible", "Blur foreground objects"

BAD (too poetic): "The scene darkens as tension builds"
GOOD (literal): "Reduce exposure by 1 stop, add warm orange grade to shadows"

BAD: "Camera approaches the subject"
GOOD: "Dolly forward 3 meters, character face fills 80% of frame"

Provide complete literal instructions that a compositor could execute.
`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: parentImageBase64
          }
        },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingLevel: 'HIGH'
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini for transformation delta");

  return JSON.parse(text) as TransformationDelta;
};

/**
 * Generate frame from parent using literal transformation instructions
 */
export const generateFrameFromParent = async (
  parentFrameBase64: string,
  transformationDelta: TransformationDelta,
  childDescription: string,
  aspectRatio: AspectRatio,
  activeCharacters: Character[],
  activeLocations: Location[],
  style: string,
  promptModifier: string = ""
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const parts: any[] = [
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: parentFrameBase64
      }
    }
  ];

  // Add character sheets if present
  const validChars = activeCharacters.filter(c => c.imageUrl);
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

  // Add location references
  const validLocs = activeLocations.filter(loc => loc.imageUrl);
  validLocs.forEach(loc => {
    if (loc.imageUrl) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: loc.imageUrl
        }
      });
    }
  });

  // Build reference text
  let referenceText = "";
  let imageIndex = 2; // Image 1 is parent frame

  validChars.forEach((c) => {
    referenceText += `Image ${imageIndex} is Character Reference for "${c.name}". `;
    imageIndex++;
  });

  validLocs.forEach((loc) => {
    referenceText += `Image ${imageIndex} is Location Reference for "${loc.name}". `;
    imageIndex++;
  });

  parts.push({
    text: `Edit Image 1 (parent frame) using these LITERAL transformation instructions:

${transformationDelta.literalInstructions}

Target scene description: ${childDescription} ${promptModifier}

${referenceText ? `REFERENCES:\n${referenceText}\n` : ''}
Ensure all characters maintain visual identity and locations match environment from reference images.
Style: ${style}.

IMPORTANT: Follow the transformation instructions PRECISELY. Do not deviate from the specified camera operations and framing changes.`
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: { parts },
    config: {
      imageConfig: {
        aspectRatio: getSupportedAspectRatio(aspectRatio),
        imageSize: "2K",
        output_mime_type: "image/jpeg"
      } as any
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return await compressToJPEG(part.inlineData.data, 0.85);
    }
  }
  throw new Error("No image generated from parent transformation");
};