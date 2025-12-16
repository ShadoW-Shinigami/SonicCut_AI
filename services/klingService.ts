import { fal } from "@fal-ai/client";

// Get FAL API Key from environment
const getFalKey = (): string => {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY not found in environment variables");
  }
  return key;
};

// Configure fal client on first use
let configured = false;
const configureFal = () => {
  if (!configured) {
    fal.config({ credentials: getFalKey() });
    configured = true;
  }
};

export interface KlingGenerationInput {
  prompt: string;
  firstFrameBase64: string;
  lastFrameBase64?: string;
  duration: '5' | '10';
  negativePrompt?: string;
  cfgScale?: number;
}

export interface KlingGenerationResult {
  videoUrl: string;
}

export interface KlingQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  logs?: { message: string }[];
}

/**
 * Generate a video clip using Kling 2.5 Turbo Pro via fal.ai
 * Uses image-to-video with first frame and optional last frame (tail image)
 */
export const generateVideoClip = async (
  input: KlingGenerationInput,
  onProgress?: (status: KlingQueueStatus) => void
): Promise<KlingGenerationResult> => {
  configureFal();

  const result = await fal.subscribe("fal-ai/kling-video/v2.5-turbo/pro/image-to-video", {
    input: {
      prompt: input.prompt,
      image_url: `data:image/jpeg;base64,${input.firstFrameBase64}`,
      tail_image_url: input.lastFrameBase64
        ? `data:image/jpeg;base64,${input.lastFrameBase64}`
        : undefined,
      duration: input.duration,
      negative_prompt: input.negativePrompt || "blur, distort, and low quality",
      cfg_scale: input.cfgScale ?? 0.5
    } as any,
    logs: true,
    onQueueUpdate: (update) => {
      if (onProgress) {
        onProgress({
          status: update.status as KlingQueueStatus['status'],
          logs: update.status === 'IN_PROGRESS' ? update.logs : undefined
        });
      }
    }
  });

  const videoUrl = (result.data as any)?.video?.url;
  if (!videoUrl) {
    throw new Error("No video URL in Kling response");
  }

  return { videoUrl };
};

/**
 * Determine video duration based on shot timing
 * If shot is less than 5 seconds, generate 5s video (will be sped up)
 * If shot is 5 seconds or more, generate 10s video (will be adjusted)
 */
export const selectVideoDuration = (shotDuration: number): '5' | '10' => {
  return shotDuration < 5 ? '5' : '10';
};

/**
 * Calculate the speed factor needed to match target duration
 * speedFactor > 1 means speed up, < 1 means slow down
 */
export const calculateSpeedFactor = (
  generatedDuration: number,
  targetDuration: number
): number => {
  if (targetDuration <= 0) return 1;
  return generatedDuration / targetDuration;
};

/**
 * Fetch a video from URL and return as Blob with retry logic
 * Needed for FFmpeg processing
 */
export const fetchVideoAsBlob = async (
  videoUrl: string,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<Blob> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.blob();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Fetch attempt ${attempt + 1}/${maxRetries} failed:`, error);

      // Don't wait after the last attempt
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 2s, 4s, 8s...
        const delay = retryDelay * Math.pow(2, attempt);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed to fetch video after ${maxRetries} attempts: ${lastError?.message}`);
};
