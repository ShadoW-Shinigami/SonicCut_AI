import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AudioAnalysis, Character, VideoPlan, AspectRatio, HierarchyTree, HierarchyNode, TransformationDelta } from "../types";

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
            }
          },
          required: ["description", "interpolationPrompt", "characterIds"]
        }
      }
    },
    required: ["narrativeSummary", "characters", "scenes"]
  };

  const feedbackSection = userFeedback
    ? `\n\nUser Feedback/Direction: ${userFeedback}\nPlease incorporate this feedback into the narrative plan.`
    : '';

  const prompt = `
    Plan a music video for a song with the following details:
    Theme: ${analysis.theme}
    Genre: ${analysis.genre}
    Lyrics/Context: ${analysis.lyrics}

    Constraints:
    1. The video must have exactly ${cutCount} shots. CRITICAL: Generate exactly ${cutCount} shots, no more, no less.
    2. Each shot is a single frame/image in the storyboard.
    3. No dialogue. Pure visual storytelling.
    4. The Lyrics only exist to provide you context. The narrative does not have to be 1:1 what is in the lyrics or show whatever is in the lyrics as is. Just convey the feeling. This is for a music video. It can be a completely different story as long as the song makes sense when played under it. Lyrics are just a guide to give you an idea of what the music video is about.
    5. The narrative should flow smoothly, designed for morphing/interpolation between shots.
    6. Define the characters needed and assign them unique IDs.
    7. For each shot, you MUST list the 'characterIds' of any characters present.
    8. Output JSON.${feedbackSection}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingBudget: -1  // Unlimited thinking for better reasoning
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
            }
          },
          required: ["description", "interpolationPrompt", "characterIds"]
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

Current shots:
${videoPlan.scenes.map((s, i) => `${i + 1}. ${s.description} [CharacterIDs: ${JSON.stringify(s.characterIds || [])}]`).join('\n')}

TASK: Add ${diff} more shot(s) to make it exactly ${targetCount} shots total. The new shots should:
1. Fit naturally into the narrative flow
2. Be inserted at logical points (not just at the end)
3. Maintain character consistency
4. Keep the story coherent

IMPORTANT - Character Attribution:
- Each shot MUST have a characterIds array listing which characters appear in that shot
- Use ONLY the character IDs listed above (e.g., "${videoPlan.characters[0]?.id || 'char-0'}")
- If a shot has no characters visible, use an empty array: []
- Make sure character appearances make narrative sense

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

Current shots:
${videoPlan.scenes.map((s, i) => `${i + 1}. ${s.description} [CharacterIDs: ${JSON.stringify(s.characterIds || [])}]`).join('\n')}

TASK: Remove or merge ${toRemove} shot(s) to make it exactly ${targetCount} shots total. When removing:
1. Keep the most important/impactful shots
2. Merge similar consecutive shots if possible
3. Maintain narrative flow
4. Keep character consistency

IMPORTANT - Character Attribution:
- Each shot MUST have a characterIds array listing which characters appear in that shot
- Use ONLY the character IDs listed above
- If a shot has no characters visible, use an empty array: []
- Make sure character appearances make narrative sense

Return exactly ${targetCount} shots in the correct order.
`;
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingBudget: -1  // Unlimited thinking for better reasoning
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
      } as any
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

  // Validate: all nodes at depth 0 should have parentIndex === null
  nodes.forEach((node, idx) => {
    if (node.depth === 0 && node.parentIndex !== null) {
      console.warn(`⚠️ Node ${idx} at depth 0 has parent ${node.parentIndex}. Fixing to make it a true parent.`);
      node.parentIndex = null;
    }
  });

  // Calculate max depth
  const maxDepth = Math.max(...nodes.map(n => n.depth));

  return {
    nodes,
    parentIndices: geminiResult.parentIndices,
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
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingBudget: -1  // Unlimited thinking for better reasoning
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
    model: "gemini-2.5-pro",
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
      responseSchema: schema
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
  if (validChars.length > 0) {
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

    let charRefText = "";
    validChars.forEach((c, idx) => {
      charRefText += `Image ${idx + 2} is the Character Reference for "${c.name}". `;
    });

    parts.push({
      text: `Edit Image 1 (parent frame) using these LITERAL transformation instructions:

${transformationDelta.literalInstructions}

Target scene description: ${childDescription} ${promptModifier}

${charRefText}
Ensure all characters maintain visual identity from their reference images.
Style: ${style}.

IMPORTANT: Follow the transformation instructions PRECISELY. Do not deviate from the specified camera operations and framing changes.`
    });
  } else {
    parts.push({
      text: `Edit the provided image using these LITERAL transformation instructions:

${transformationDelta.literalInstructions}

Target scene: ${childDescription} ${promptModifier}
Style: ${style}.

IMPORTANT: Follow the transformation instructions PRECISELY.`
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
      return await compressToJPEG(part.inlineData.data, 0.85);
    }
  }
  throw new Error("No image generated from parent transformation");
};