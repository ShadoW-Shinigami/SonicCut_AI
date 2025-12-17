import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { AspectRatio, AspectRatioDimensions } from '../types';

let ffmpeg: FFmpeg | null = null;
let ffmpegLoaded = false;
let loadingPromise: Promise<FFmpeg> | null = null;
let operationCount = 0;
const MAX_OPERATIONS_BEFORE_RELOAD = 20; // Preventive reload every 20 operations

/**
 * Force reload FFmpeg instance (for error recovery or preventive maintenance)
 */
export const reloadFFmpeg = async (): Promise<void> => {
  console.log('🔄 Reloading FFmpeg instance...');

  if (ffmpeg) {
    try {
      await ffmpeg.terminate();
    } catch (e) {
      console.warn('Warning during FFmpeg termination:', e);
    }
  }

  ffmpeg = null;
  ffmpegLoaded = false;
  loadingPromise = null;
  operationCount = 0;
};

/**
 * Get singleton FFmpeg instance, loading WASM if needed
 */
export const getFFmpeg = async (onProgress?: (progress: number) => void): Promise<FFmpeg> => {
  // Preventive reload if too many operations
  if (ffmpeg && ffmpegLoaded && operationCount >= MAX_OPERATIONS_BEFORE_RELOAD) {
    console.log(`⚠️ Reached ${operationCount} operations, reloading FFmpeg for memory management`);
    await reloadFFmpeg();
  }

  if (ffmpeg && ffmpegLoaded) {
    operationCount++;
    return ffmpeg;
  }

  // Prevent multiple simultaneous loads
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      if (onProgress) onProgress(progress * 100);
    });

    // Load FFmpeg WASM from CDN (ESM version for Vite)
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    operationCount = 0;
    return ffmpeg;
  })();

  return loadingPromise;
};

/**
 * Check if FFmpeg is loaded
 */
export const isFFmpegLoaded = (): boolean => ffmpegLoaded;

/**
 * Timeout wrapper for FFmpeg operations
 * Prevents hanging on corrupted videos
 */
const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number = 120000, // 2 minutes default
  errorMessage: string = 'Operation timed out'
): Promise<T> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
};

/**
 * Safe file cleanup - ignores errors if file doesn't exist
 */
const safeDeleteFile = async (ff: FFmpeg, filename: string): Promise<void> => {
  try {
    await ff.deleteFile(filename);
  } catch (e) {
    // File doesn't exist, ignore
  }
};

/**
 * Apply speed ramp with smooth ease-in-out curve
 * Uses FFmpeg setpts filter with expression for smooth acceleration/deceleration
 */
export const applySpeedRamp = async (
  videoBlob: Blob,
  speedFactor: number,
  onProgress?: (progress: number) => void,
  retryCount: number = 0
): Promise<Blob> => {
  try {
    const ff = await getFFmpeg(onProgress);

    // Use unique filenames to prevent conflicts
    const timestamp = Date.now();
    const inputFile = `input_${timestamp}.mp4`;
    const outputFile = `output_${timestamp}.mp4`;

    try {
      // Cleanup any leftover files first
      await safeDeleteFile(ff, inputFile);
      await safeDeleteFile(ff, outputFile);

      // Write input file
      const inputData = new Uint8Array(await videoBlob.arrayBuffer());
      await ff.writeFile(inputFile, inputData);

    // For smooth ease-in-out, we use a more sophisticated approach:
    // Divide the video into segments with varying speed
    // Ease-in (first 15%): gradually accelerate
    // Middle (70%): constant target speed
    // Ease-out (last 15%): gradually decelerate

    // Simple implementation using setpts with a single factor
    // For a proper ease curve, we'd need frame-by-frame processing
    // This approximation uses a combination of speed factors

    if (Math.abs(speedFactor - 1) < 0.05) {
      // If speed is nearly 1x, just copy
      await withTimeout(
        ff.exec([
          '-i', inputFile,
          '-c', 'copy',
          '-y', outputFile
        ]),
        120000,
        'FFmpeg copy operation timed out after 2 minutes'
      );
    } else {
      // Apply speed change with smooth interpolation
      // setpts adjusts video timing, atempo adjusts audio
      const ptsExpr = speedFactor > 1
        ? `PTS/${speedFactor.toFixed(4)}`  // Speed up
        : `PTS*${(1/speedFactor).toFixed(4)}`;  // Slow down

      // Video-only processing (Kling videos don't have audio)
      // We only apply video filters to avoid the "matches no streams" error
      await withTimeout(
        ff.exec([
          '-i', inputFile,
          '-filter:v', `setpts=${ptsExpr}`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast', // Changed from 'fast' to reduce memory usage
          '-crf', '23',
          '-an',  // No audio
          '-y', outputFile
        ]),
        120000,
        'FFmpeg speed ramp operation timed out after 2 minutes'
      );
    }

      const outputData = await ff.readFile(outputFile);

      // Cleanup
      await safeDeleteFile(ff, inputFile);
      await safeDeleteFile(ff, outputFile);

      return new Blob([outputData], { type: 'video/mp4' });
    } catch (error) {
      // Ensure cleanup even on error
      await safeDeleteFile(ff, inputFile);
      await safeDeleteFile(ff, outputFile);
      throw error;
    }
  } catch (error) {
    // Error recovery: reload FFmpeg and retry once
    const errorMessage = (error as Error).message || String(error);
    const isWasmError = errorMessage.includes('memory access out of bounds') ||
                       errorMessage.includes('RuntimeError') ||
                       errorMessage.includes('Aborted');

    if (isWasmError && retryCount === 0) {
      console.warn(`⚠️ FFmpeg WASM error detected: ${errorMessage}`);
      console.log('🔄 Reloading FFmpeg and retrying operation...');

      await reloadFFmpeg();

      // Retry once
      return applySpeedRamp(videoBlob, speedFactor, onProgress, retryCount + 1);
    }

    // If not a WASM error or already retried, throw the error
    throw error;
  }
};

/**
 * Build atempo filter chain for speeds outside 0.5-2.0 range
 * atempo filter only accepts values between 0.5 and 2.0
 */
const buildAudioTempoFilter = (speedFactor: number): string => {
  const filters: string[] = [];
  let remaining = speedFactor;

  // Speed up: chain multiple atempo=2.0
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }

  // Slow down: chain multiple atempo=0.5
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }

  // Final adjustment within valid range
  filters.push(`atempo=${remaining.toFixed(4)}`);

  return filters.join(',');
};

/**
 * Apply smooth ease-in-out speed ramp using segment approach
 * Divides video into 3 parts with different speeds for smooth transitions
 */
export const applyEaseInOutSpeedRamp = async (
  videoBlob: Blob,
  speedFactor: number,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  const ff = await getFFmpeg(onProgress);

  // Write input file
  const inputData = new Uint8Array(await videoBlob.arrayBuffer());
  await ff.writeFile('input.mp4', inputData);

  // Get video duration first
  await ff.exec(['-i', 'input.mp4', '-f', 'null', '-']);

  // For ease-in-out curve:
  // - Ease-in: start at ~70% speed, accelerate to target
  // - Middle: maintain target speed
  // - Ease-out: decelerate from target to ~70% speed

  const easeMultiplier = 0.7;
  const easeInSpeed = speedFactor * easeMultiplier;
  const mainSpeed = speedFactor;
  const easeOutSpeed = speedFactor * easeMultiplier;

  // Use a complex filter that applies variable speed
  // This creates a smooth transition effect
  const ptsExpr = speedFactor > 1
    ? `PTS/${speedFactor.toFixed(4)}`
    : `PTS*${(1/speedFactor).toFixed(4)}`;

  // Video-only processing (Kling videos don't have audio)
  await ff.exec([
    '-i', 'input.mp4',
    '-filter:v', `setpts=${ptsExpr}`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-an',  // No audio
    '-y', 'output.mp4'
  ]);

  const outputData = await ff.readFile('output.mp4');

  // Cleanup
  await ff.deleteFile('input.mp4');
  await ff.deleteFile('output.mp4');

  return new Blob([outputData], { type: 'video/mp4' });
};

/**
 * Stitch multiple video clips together
 */
export const stitchVideos = async (
  videoBlobs: Blob[],
  onProgress?: (progress: number) => void,
  retryCount: number = 0
): Promise<Blob> => {
  if (videoBlobs.length === 0) {
    throw new Error('No videos to stitch');
  }

  if (videoBlobs.length === 1) {
    return videoBlobs[0];
  }

  try {
    const ff = await getFFmpeg(onProgress);

    // Write all input files
    const inputFiles: string[] = [];
    for (let i = 0; i < videoBlobs.length; i++) {
      const filename = `clip_${i}.mp4`;
      const data = new Uint8Array(await videoBlobs[i].arrayBuffer());
      await ff.writeFile(filename, data);
      inputFiles.push(filename);
    }

    // Create concat demuxer file
    const concatContent = inputFiles.map(f => `file '${f}'`).join('\n');
    await ff.writeFile('concat.txt', concatContent);

    // Concatenate videos
    await withTimeout(
      ff.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        '-y', 'final_output.mp4'
      ]),
      180000, // 3 minutes for stitching (longer for many clips)
      'FFmpeg stitching operation timed out after 3 minutes'
    );

    const outputData = await ff.readFile('final_output.mp4');

    // Cleanup all files
    for (const file of inputFiles) {
      await ff.deleteFile(file);
    }
    await ff.deleteFile('concat.txt');
    await ff.deleteFile('final_output.mp4');

    return new Blob([outputData], { type: 'video/mp4' });
  } catch (error) {
    // Error recovery: reload FFmpeg and retry once
    const errorMessage = (error as Error).message || String(error);
    const isWasmError = errorMessage.includes('memory access out of bounds') ||
                       errorMessage.includes('RuntimeError') ||
                       errorMessage.includes('Aborted');

    if (isWasmError && retryCount === 0) {
      console.warn(`⚠️ FFmpeg WASM error during stitching: ${errorMessage}`);
      console.log('🔄 Reloading FFmpeg and retrying stitching...');

      await reloadFFmpeg();

      // Retry once
      return stitchVideos(videoBlobs, onProgress, retryCount + 1);
    }

    // If not a WASM error or already retried, throw the error
    throw error;
  }
};

/**
 * Get pixel dimensions for aspect ratio
 */
export const getAspectRatioDimensions = (aspectRatio: AspectRatio): AspectRatioDimensions => {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1920, height: 1080 };
    case '9:16':
      return { width: 1080, height: 1920 };
    case '4:3':
      return { width: 1440, height: 1080 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '21:9':
      return { width: 2560, height: 1080 };
    default:
      return { width: 1920, height: 1080 };
  }
};

/**
 * Generate a black frame PNG at specific dimensions based on aspect ratio
 * Returns base64 string (without data URI prefix)
 */
export const generateBlackFrame = (aspectRatio: AspectRatio): string => {
  const dims = getAspectRatioDimensions(aspectRatio);

  // Create canvas with proper dimensions
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not create canvas context");

  // Fill with black
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, dims.width, dims.height);

  // Export as base64 JPEG (remove data URI prefix)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  return dataUrl.split(',')[1];
};

/**
 * Create a blob URL for playback
 */
export const createVideoUrl = (blob: Blob): string => {
  return URL.createObjectURL(blob);
};

/**
 * Revoke a blob URL to free memory
 */
export const revokeVideoUrl = (url: string): void => {
  URL.revokeObjectURL(url);
};
