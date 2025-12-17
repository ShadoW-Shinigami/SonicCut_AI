import React, { useState, useRef, useEffect } from 'react';
import { AudioAnalysis, Marker, AspectRatio, VideoPlan, StoryboardFrame, Character, Location, VideoClip, VideoGenerationState, HierarchyTree } from '../types';
import { generateVideoNarrative, generateCharacterSheet, generateLocationReference, generateFirstFrame, generateNextFrame, sanitizePrompt, generateHierarchicalPlan, generateTransformationDelta, generateFrameFromParent, adjustShotCount } from '../services/geminiService';
import { generateVideoClip, selectVideoDuration, calculateSpeedFactor, fetchVideoAsBlob } from '../services/klingService';
import { generateBlackFrame, applySpeedRamp, stitchVideos, getFFmpeg, isFFmpegLoaded, createVideoUrl, revokeVideoUrl } from '../services/videoProcessingService';
import { Clapperboard, Film, User, Loader2, PlaySquare, ArrowRight, LayoutTemplate, Package, StopCircle, RefreshCw, PlayCircle, AlertTriangle, Video, Download, Pause, Play, X, MessageSquare, MapPin } from 'lucide-react';
import { FrameCard } from './FrameCard';
import { DetailsPanel } from './DetailsPanel';
import JSZip from 'jszip';

interface VideoPlannerProps {
  analysis: AudioAnalysis;
  markers: Marker[];
  audioDuration: number;
  // Phase 2 state (controlled by parent)
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  visualStyle: string;
  setVisualStyle: (style: string) => void;
  videoPlan: VideoPlan | null;
  setVideoPlan: (plan: VideoPlan | null) => void;
  storyboard: StoryboardFrame[];
  setStoryboard: (frames: StoryboardFrame[]) => void;
  // Hierarchy state (controlled by parent)
  hierarchyTree: HierarchyTree | null;
  setHierarchyTree: (tree: HierarchyTree | null) => void;
  useHierarchy: boolean;
  setUseHierarchy: (use: boolean) => void;
  // Phase 3 state (controlled by parent)
  videoClips: VideoClip[];
  setVideoClips: (clips: VideoClip[]) => void;
  finalVideoBlob: Blob | null;
  setFinalVideoBlob: (blob: Blob | null) => void;
  onStoryboardUpdate?: () => Promise<void>;
}

const VideoPlanner: React.FC<VideoPlannerProps> = ({
  analysis,
  markers,
  audioDuration,
  aspectRatio,
  setAspectRatio,
  visualStyle,
  setVisualStyle,
  videoPlan,
  setVideoPlan,
  storyboard,
  setStoryboard,
  hierarchyTree,
  setHierarchyTree,
  useHierarchy,
  setUseHierarchy,
  videoClips,
  setVideoClips,
  finalVideoBlob,
  setFinalVideoBlob,
  onStoryboardUpdate
}) => {
  // Rename plan to videoPlan for consistency with props
  const plan = videoPlan;
  const setPlan = setVideoPlan;

  // Loading States
  const [isPlanning, setIsPlanning] = useState(false);
  const [isGeneratingChars, setIsGeneratingChars] = useState(false);
  const [isGeneratingFrames, setIsGeneratingFrames] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Feedback Dialog State
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  // Stop Control
  const stopRef = useRef<boolean>(false);

  // Selection State (local)
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  // Phase 3: Video Generation State (UI only)
  // videoClips and finalVideoBlob are now controlled by parent
  const [videoState, setVideoState] = useState<VideoGenerationState>({
    clips: [],
    isGenerating: false,
    isProcessing: false,
    isStitching: false,
    progress: 0,
    currentPhase: 'idle'
  });
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [clipVideoUrls, setClipVideoUrls] = useState<{ [key: string]: string }>({});
  const videoStopRef = useRef<boolean>(false);

  // Recreate blob URLs from saved blobs on mount/load
  useEffect(() => {
    // Recreate final video URL from blob
    if (finalVideoBlob && !finalVideoUrl) {
      const url = createVideoUrl(finalVideoBlob);
      setFinalVideoUrl(url);
    }

    // Recreate clip URLs from blobs
    const newClipUrls: { [key: string]: string } = {};
    videoClips.forEach(clip => {
      if (clip.processedVideoBlob && !clipVideoUrls[clip.id]) {
        newClipUrls[clip.id] = createVideoUrl(clip.processedVideoBlob);
      }
    });
    if (Object.keys(newClipUrls).length > 0) {
      setClipVideoUrls(prev => ({ ...prev, ...newClipUrls }));
    }
  }, [finalVideoBlob, videoClips]);

  // Step 1: Generate Plan (Text & Characters)
  const handleGeneratePlan = async () => {
    if (markers.length === 0) {
        alert("Please generate cuts first!");
        return;
    }
    setIsPlanning(true);
    try {
      let videoPlan = await generateVideoNarrative(analysis, markers.length, aspectRatio);

      // Auto-fix shot count mismatch
      if (videoPlan.scenes.length !== markers.length) {
        console.warn(`Shot count mismatch: ${videoPlan.scenes.length} shots vs ${markers.length} markers. Auto-fixing...`);
        try {
          videoPlan = await adjustShotCount(videoPlan, markers.length);
          console.log(`✓ Fixed! Now have ${videoPlan.scenes.length} shots`);
        } catch (e) {
          console.error("Failed to adjust shot count:", e);
          alert(`Error: Generated ${videoPlan.scenes.length} shots but expected ${markers.length}, and auto-fix failed. Please try again.`);
          return;
        }
      }

      // Inject time from markers
      const scenesWithTime = videoPlan.scenes.map((scene, idx) => ({
          ...scene,
          markerId: markers[idx].id,
          startTime: markers[idx].time,
          imageUrl: undefined,
          isGenerating: false
      }));

      setPlan({ ...videoPlan, scenes: scenesWithTime });
      setStoryboard(scenesWithTime);

      // Generate hierarchy if enabled
      console.log("useHierarchy flag:", useHierarchy);
      if (useHierarchy) {
        console.log("Starting hierarchy generation...");
        try {
          const hierarchy = await generateHierarchicalPlan(videoPlan);
          setHierarchyTree(hierarchy);
          console.log("Hierarchy generated and set successfully");
        } catch (e) {
          console.error("Failed to generate hierarchy:", e);
          alert("Failed to generate hierarchical structure. Falling back to sequential generation.");
          setUseHierarchy(false);
          setHierarchyTree(null);
        }
      } else {
        console.log("Hierarchy disabled, skipping hierarchy generation");
        setHierarchyTree(null);
      }

      // Trigger character and location generation immediately after plan is ready
      generateCharacters(videoPlan.characters);
      if (videoPlan.locations && videoPlan.locations.length > 0) {
        generateLocations(videoPlan.locations);
      }

    } catch (e) {
      console.error(e);
      alert("Failed to generate video plan.");
    } finally {
      setIsPlanning(false);
    }
  };

  const handleRegeneratePlan = async () => {
    // Check if storyboard has any generated frames
    const hasGeneratedFrames = storyboard.some(f => f.imageUrl);

    if (hasGeneratedFrames) {
      const confirmed = window.confirm(
        "Regenerating the narrative will reset all storyboard frames. This action cannot be undone. Continue?"
      );
      if (!confirmed) return;
    }

    // Show feedback dialog
    setFeedbackText(''); // Reset feedback
    setShowFeedbackDialog(true);
  };

  const performRegeneratePlan = async (feedback?: string) => {
    setShowFeedbackDialog(false);
    setIsPlanning(true);
    try {
      let videoPlan = await generateVideoNarrative(analysis, markers.length, aspectRatio, feedback);

      // Auto-fix shot count mismatch
      if (videoPlan.scenes.length !== markers.length) {
        console.warn(`Shot count mismatch: ${videoPlan.scenes.length} shots vs ${markers.length} markers. Auto-fixing...`);
        try {
          videoPlan = await adjustShotCount(videoPlan, markers.length);
          console.log(`✓ Fixed! Now have ${videoPlan.scenes.length} shots`);
        } catch (e) {
          console.error("Failed to adjust shot count:", e);
          alert(`Error: Generated ${videoPlan.scenes.length} shots but expected ${markers.length}, and auto-fix failed. Please try again.`);
          return;
        }
      }

      // Inject time from markers
      const scenesWithTime = videoPlan.scenes.map((scene, idx) => ({
          ...scene,
          markerId: markers[idx].id,
          startTime: markers[idx].time,
          imageUrl: undefined,
          isGenerating: false
      }));

      setPlan({ ...videoPlan, scenes: scenesWithTime });
      setStoryboard(scenesWithTime);

      // Generate hierarchy if enabled
      console.log("useHierarchy flag:", useHierarchy);
      if (useHierarchy) {
        console.log("Starting hierarchy generation...");
        try {
          const hierarchy = await generateHierarchicalPlan(videoPlan);
          setHierarchyTree(hierarchy);
          console.log("Hierarchy generated and set successfully");
        } catch (e) {
          console.error("Failed to generate hierarchy:", e);
          alert("Failed to generate hierarchical structure. Falling back to sequential generation.");
          setUseHierarchy(false);
          setHierarchyTree(null);
        }
      } else {
        console.log("Hierarchy disabled, skipping hierarchy generation");
        setHierarchyTree(null);
      }

      // Trigger character and location generation immediately after plan is ready
      generateCharacters(videoPlan.characters);
      if (videoPlan.locations && videoPlan.locations.length > 0) {
        generateLocations(videoPlan.locations);
      }

    } catch (e) {
      console.error(e);
      alert("Failed to regenerate video plan.");
    } finally {
      setIsPlanning(false);
    }
  };

  const generateCharacters = async (chars: Character[]) => {
    setIsGeneratingChars(true);
    const updatedChars = [...chars];

    // Generate in batches of 3 parallel requests
    const MAX_CONCURRENT = 3;
    for (let i = 0; i < updatedChars.length; i += MAX_CONCURRENT) {
        const batch = updatedChars.slice(i, i + MAX_CONCURRENT);
        await Promise.all(
            batch.map(async (char, batchIndex) => {
                const actualIndex = i + batchIndex;
                try {
                    const base64 = await generateCharacterSheet(char, visualStyle);
                    updatedChars[actualIndex].imageUrl = base64;
                    // Update state incrementally to show progress
                    setPlan(prev => prev ? { ...prev, characters: [...updatedChars] } : null);
                } catch (e) {
                    console.error(`Failed to generate char ${char.name}`, e);
                }
            })
        );
    }
    setIsGeneratingChars(false);
  };

  const regenerateCharacter = async (charIndex: number) => {
    if (!plan) return;

    setIsGeneratingChars(true);
    const updatedChars = [...plan.characters];

    try {
      const base64 = await generateCharacterSheet(updatedChars[charIndex], visualStyle);
      updatedChars[charIndex].imageUrl = base64;
      setPlan({ ...plan, characters: updatedChars });
    } catch (e) {
      console.error(`Failed to regenerate char ${updatedChars[charIndex].name}`, e);
    }

    setIsGeneratingChars(false);
  };

  const generateLocations = async (locs: Location[]) => {
    if (locs.length === 0) return;

    setIsGeneratingChars(true); // Reuse same loading state
    const updatedLocs = [...locs];

    // Generate in batches of 3 parallel requests
    const MAX_CONCURRENT = 3;
    for (let i = 0; i < updatedLocs.length; i += MAX_CONCURRENT) {
      const batch = updatedLocs.slice(i, i + MAX_CONCURRENT);
      await Promise.all(
        batch.map(async (loc, batchIndex) => {
          const actualIndex = i + batchIndex;
          try {
            const base64 = await generateLocationReference(loc, visualStyle);
            updatedLocs[actualIndex].imageUrl = base64;
            setPlan(prev => prev ? { ...prev, locations: [...updatedLocs] } : null);
          } catch (e) {
            console.error(`Failed to generate location ${loc.name}`, e);
          }
        })
      );
    }
    setIsGeneratingChars(false);
  };

  const regenerateLocation = async (locIndex: number) => {
    if (!plan) return;

    setIsGeneratingChars(true);
    const updatedLocs = [...plan.locations];

    try {
      const base64 = await generateLocationReference(updatedLocs[locIndex], visualStyle);
      updatedLocs[locIndex].imageUrl = base64;
      setPlan({ ...plan, locations: updatedLocs });
    } catch (e) {
      console.error(`Failed to regenerate location ${updatedLocs[locIndex].name}`, e);
    }

    setIsGeneratingChars(false);
  };

  // Step 2: Generate Storyboard (Sequential Images)
  const processFrames = async (startIndex: number = 0) => {
    if (!plan) return;
    
    stopRef.current = false;
    setIsGeneratingFrames(true);
    setGenerationProgress(0);

    const frames = [...storyboard];

    for (let i = startIndex; i < frames.length; i++) {
        if (stopRef.current) break;

        // Reset state for this frame
        frames[i].isGenerating = true;
        frames[i].error = undefined;
        setStoryboard([...frames]); // Force update UI

        let success = false;
        // Logic: Try to use previous frame for "Edit", unless it failed or doesn't exist, then "Generate New"
        const prevImage = (i > 0 && !frames[i-1].error && frames[i-1].imageUrl) ? frames[i-1].imageUrl : null;

        // Resolve active characters and locations for this frame based on plan
        const activeChars = plan.characters.filter(c => frames[i].characterIds?.includes(c.id));
        const activeLocs = plan.locations.filter(loc => frames[i].locationIds?.includes(loc.id));

        // Retry Loop
        for (let attempt = 0; attempt < 3; attempt++) {
             if (stopRef.current) break;
             try {
                 // Sanitize description for retries using Gemini
                 let description = frames[i].description;
                 if (attempt === 1) {
                    description = await sanitizePrompt(frames[i].description, 'moderate');
                 } else if (attempt === 2) {
                    description = await sanitizePrompt(frames[i].description, 'strict');
                 }

                 let imageBase64: string;
                 if (prevImage) {
                    imageBase64 = await generateNextFrame(prevImage, description, aspectRatio, activeChars, activeLocs, visualStyle);
                 } else {
                    imageBase64 = await generateFirstFrame(description, aspectRatio, activeChars, activeLocs, visualStyle);
                 }

                 frames[i].imageUrl = imageBase64;
                 success = true;
                 break; // Success, exit retry loop
             } catch (e) {
                 console.warn(`Frame ${i} attempt ${attempt + 1} failed`, e);
             }
        }

        frames[i].isGenerating = false;
        
        if (!success && !stopRef.current) {
            frames[i].error = "Generation Failed";
            frames[i].imageUrl = undefined;
            setStoryboard([...frames]);
            // If a frame fails completely, we stop the sequence so the user can intervene.
            alert(`Generation stopped at Shot ${i+1}. Please check the error, maybe adjust the description or style, and retry.`);
            break; 
        }

        setGenerationProgress(((i + 1) / frames.length) * 100);
        setStoryboard([...frames]);

        // Trigger autosave after each frame
        if (onStoryboardUpdate) {
          await onStoryboardUpdate();
        }
    }

    setIsGeneratingFrames(false);
  };

  // Hierarchical frame generation with tiered/phased approach
  const processFramesHierarchical = async () => {
    if (!plan || !hierarchyTree) return;

    stopRef.current = false;
    setIsGeneratingFrames(true);
    setGenerationProgress(0);

    const frames = [...storyboard];
    const totalFrames = frames.length;
    let completedCount = 0;
    const MAX_CONCURRENT = 3;

    // Helper to generate a single frame
    const generateFrame = async (frameIndex: number): Promise<boolean> => {
      if (stopRef.current) return false;

      const node = hierarchyTree.nodes[frameIndex];

      // Skip if already generated (for selective regeneration)
      if (frames[frameIndex].imageUrl && !frames[frameIndex].error) {
        return true;
      }

      frames[frameIndex].isGenerating = true;
      frames[frameIndex].error = undefined;
      setStoryboard([...frames]);

      let success = false;

      // 3-attempt retry with progressive sanitization
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stopRef.current) break;

        try {
          let description = frames[frameIndex].description;
          if (attempt === 1) {
            description = await sanitizePrompt(description, 'moderate');
          } else if (attempt === 2) {
            description = await sanitizePrompt(description, 'strict');
          }

          const activeChars = plan.characters.filter(c =>
            frames[frameIndex].characterIds?.includes(c.id)
          );
          const activeLocs = plan.locations.filter(loc =>
            frames[frameIndex].locationIds?.includes(loc.id)
          );

          let imageBase64: string;

          if (node.parentIndex === null) {
            // This is a parent - generate normally
            imageBase64 = await generateFirstFrame(
              description,
              aspectRatio,
              activeChars,
              activeLocs,
              visualStyle
            );
          } else {
            // This is a child - use vision-based edit (same as linear mode now)
            const parentFrame = frames[node.parentIndex];

            // Validate parent has image (should always be true due to phased generation)
            if (!parentFrame.imageUrl) {
              throw new Error(`Parent frame ${node.parentIndex} missing image`);
            }

            // Use vision-based edit instructions (same approach as linear mode)
            imageBase64 = await generateNextFrame(
              parentFrame.imageUrl,
              description,
              aspectRatio,
              activeChars,
              activeLocs,
              visualStyle
            );
          }

          frames[frameIndex].imageUrl = imageBase64;
          success = true;
          break;
        } catch (e) {
          console.warn(`Frame ${frameIndex} attempt ${attempt + 1} failed`, e);
        }
      }

      frames[frameIndex].isGenerating = false;

      if (!success && !stopRef.current) {
        frames[frameIndex].error = "Generation Failed";
        frames[frameIndex].imageUrl = undefined;
      }

      setStoryboard([...frames]);

      if (onStoryboardUpdate) {
        await onStoryboardUpdate();
      }

      return success;
    };

    // Generate frames phase by phase (depth 0, then 1, then 2, etc.)
    for (let currentDepth = 0; currentDepth <= hierarchyTree.maxDepth; currentDepth++) {
      if (stopRef.current) break;

      // Get all frames at this depth
      const framesAtDepth = hierarchyTree.nodes
        .filter(node => node.depth === currentDepth)
        .map(node => node.frameIndex);

      if (framesAtDepth.length === 0) continue;

      console.log(`Phase ${currentDepth}: Generating ${framesAtDepth.length} frames (depth ${currentDepth})`);

      // Generate frames at this depth in batches of 3 (parallel)
      for (let i = 0; i < framesAtDepth.length; i += MAX_CONCURRENT) {
        if (stopRef.current) break;

        const batch = framesAtDepth.slice(i, i + MAX_CONCURRENT);

        // Generate batch in parallel
        await Promise.all(batch.map(frameIdx => generateFrame(frameIdx)));

        completedCount += batch.length;
        setGenerationProgress((completedCount / totalFrames) * 100);
      }
    }

    setIsGeneratingFrames(false);
  };

  // Cascade regeneration - regenerate frame and all descendants
  const handleRegenerateFrame = async (frameIndex: number) => {
    if (!hierarchyTree || !plan) return;

    const collectDescendants = (idx: number): number[] => {
      const descendants: number[] = [];
      const queue = [...hierarchyTree.nodes[idx].childIndices];

      while (queue.length > 0) {
        const childIdx = queue.shift()!;
        descendants.push(childIdx);
        queue.push(...hierarchyTree.nodes[childIdx].childIndices);
      }

      return descendants;
    };

    const descendants = collectDescendants(frameIndex);
    const totalAffected = 1 + descendants.length;

    // Always cascade - confirm with user
    if (descendants.length > 0) {
      const confirmed = window.confirm(
        `Regenerating this frame will also regenerate ${descendants.length} dependent frame${descendants.length > 1 ? 's' : ''} (${totalAffected} total). Continue?`
      );
      if (!confirmed) return;
    }

    // Clear images for this frame + all descendants
    const frames = [...storyboard];
    [frameIndex, ...descendants].forEach(idx => {
      frames[idx].imageUrl = undefined;
      frames[idx].error = undefined;
    });
    setStoryboard(frames);

    // Regenerate using hierarchical generation
    await processFramesHierarchical();
  };

  const handleStop = () => {
      stopRef.current = true;
  }

  const handleExportZip = async () => {
    const zip = new JSZip();
    const master = zip.folder("MASTER");

    // Generate proper-sized black frame based on aspect ratio
    const blackFrame = generateBlackFrame(aspectRatio);

    // Use for loop to handle async operations properly
    for (let index = 0; index < storyboard.length; index++) {
        const frame = storyboard[index];
        const folderName = `Shot_${String(index + 1).padStart(3, '0')}`;
        const folder = master?.folder(folderName);

        if (!folder) continue;

        // First Frame
        const firstFrameData = frame.imageUrl || blackFrame;
        folder.file("First_Frame.jpg", firstFrameData, {base64: true});

        // Last Frame (Next frame's start, or black if end)
        const nextFrame = storyboard[index + 1];
        const lastFrameData = nextFrame?.imageUrl || blackFrame;
        folder.file("Last_Frame.jpg", lastFrameData, {base64: true});

        // Prompt
        folder.file("Prompt.txt", frame.interpolationPrompt || "No prompt generated");

        // Videos (Phase 3 only - skip if not generated yet)
        if (videoClips.length > 0) {
            const clip = videoClips.find(c => c.shotIndex === index);

            if (clip) {
                // Processed video (final, speed-ramped version)
                if (clip.processedVideoBlob) {
                    folder.file("Processed_Video.mp4", clip.processedVideoBlob);
                }

                // Generated video (original from Kling)
                if (clip.generatedVideoUrl) {
                    try {
                        const response = await fetch(clip.generatedVideoUrl);
                        const blob = await response.blob();
                        folder.file("Generated_Video.mp4", blob);
                    } catch (e) {
                        console.warn(`Could not fetch generated video for shot ${index + 1}`, e);
                        // Continue with export even if video fetch fails
                    }
                }
            }
        }
    }

    const content = await zip.generateAsync({type:"blob"});
    const url = window.URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = "SonicCut_Production_Package.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };
  
  const canExport = storyboard.length > 0 && storyboard.some(f => f.imageUrl);

  // Phase 3: Calculate shot duration
  const getShotDuration = (index: number): number => {
    const currentMarker = markers[index];
    const nextMarker = markers[index + 1];
    if (!nextMarker) {
      return audioDuration - currentMarker.time;
    }
    return nextMarker.time - currentMarker.time;
  };

  // Phase 3: Initialize video clips from storyboard
  const initializeVideoClips = (): VideoClip[] => {
    return storyboard.map((frame, index) => {
      const targetDuration = getShotDuration(index);
      const generatedDuration = parseInt(selectVideoDuration(targetDuration)) as 5 | 10;
      return {
        id: `video-${frame.id}`,
        frameId: frame.id,
        shotIndex: index,
        targetDuration,
        generatedDuration,
        speedFactor: calculateSpeedFactor(generatedDuration, targetDuration),
        status: 'pending'
      };
    });
  };

  // Phase 3: Pre-load FFmpeg
  const preloadFFmpeg = async () => {
    if (isFFmpegLoaded()) return;
    setFfmpegLoading(true);
    try {
      await getFFmpeg();
    } finally {
      setFfmpegLoading(false);
    }
  };

  // Phase 3: Generate all videos with pipelined processing
  const handleGenerateVideos = async () => {
    if (!plan || storyboard.length === 0) return;
    if (!storyboard.every(f => f.imageUrl)) {
      alert("Please generate all storyboard frames first!");
      return;
    }

    // Pre-load FFmpeg
    await preloadFFmpeg();

    const clips = initializeVideoClips();
    setVideoClips(clips);
    videoStopRef.current = false;

    setVideoState(prev => ({
      ...prev,
      clips,
      isGenerating: true,
      currentPhase: 'generating',
      progress: 0
    }));

    // Pipelined generation + processing
    const CONCURRENT_GENERATIONS = 2;

    // Processing queue
    const processingQueue: number[] = [];
    let isProcessing = false;
    let generatedCount = 0;
    let processedCount = 0;

    // Process clips from queue sequentially
    const processQueuedClips = async () => {
      if (isProcessing) return; // Already processing
      isProcessing = true;

      while (processingQueue.length > 0 && !videoStopRef.current) {
        const clipIndex = processingQueue.shift()!;

        try {
          clips[clipIndex].status = 'processing';
          setVideoClips([...clips]);

          console.log(`🎬 Processing shot ${clipIndex + 1} (speed factor: ${clips[clipIndex].speedFactor.toFixed(2)}x)`);

          // Fetch video as blob
          const videoBlob = await fetchVideoAsBlob(clips[clipIndex].generatedVideoUrl!);
          console.log(`📥 Fetched video blob: ${(videoBlob.size / 1024 / 1024).toFixed(2)}MB`);

          // Apply speed ramp (FFmpeg - must be serialized)
          const processedBlob = await applySpeedRamp(
            videoBlob,
            clips[clipIndex].speedFactor
          );

          clips[clipIndex].processedVideoBlob = processedBlob;
          clips[clipIndex].status = 'ready';

          // Create URL for preview
          const previewUrl = createVideoUrl(processedBlob);
          setClipVideoUrls(prev => ({ ...prev, [clips[clipIndex].id]: previewUrl }));

          processedCount++;
          setVideoClips([...clips]);

          // Update progress (generation 50%, processing 50%)
          const totalProgress = (generatedCount / clips.length) * 50 + (processedCount / clips.length) * 50;
          setVideoState(prev => ({ ...prev, progress: totalProgress }));

          console.log(`✅ Shot ${clipIndex + 1} processed successfully`);

          // Small delay to allow FFmpeg WASM to fully clean up memory
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (e) {
          console.error(`❌ Speed processing failed for shot ${clipIndex + 1}:`, e);
          clips[clipIndex].status = 'error';
          clips[clipIndex].error = `Speed processing failed: ${(e as Error).message}`;
          setVideoClips([...clips]);
        }
      }

      isProcessing = false;
    };

    // Step 1: Generate videos with immediate processing
    for (let i = 0; i < clips.length; i += CONCURRENT_GENERATIONS) {
      if (videoStopRef.current) break;

      // Process batch of clips (up to 2 at a time)
      const batchIndices = [];
      for (let j = i; j < Math.min(i + CONCURRENT_GENERATIONS, clips.length); j++) {
        batchIndices.push(j);
      }

      // Generate videos in parallel for this batch
      await Promise.all(batchIndices.map(async (clipIndex) => {
        if (videoStopRef.current) return;

        const frame = storyboard[clipIndex];
        const nextFrame = storyboard[clipIndex + 1];

        clips[clipIndex].status = 'generating';
        setVideoClips([...clips]);

        const lastFrameBase64 = nextFrame?.imageUrl || generateBlackFrame(aspectRatio);
        let success = false;

        // Retry loop with progressively safer prompts
        for (let attempt = 0; attempt < 3; attempt++) {
          if (videoStopRef.current) break;

          try {
            // Sanitize interpolation prompt for retries using Gemini
            let prompt = frame.interpolationPrompt;
            if (attempt === 1) {
              prompt = await sanitizePrompt(frame.interpolationPrompt, 'moderate');
            } else if (attempt === 2) {
              prompt = await sanitizePrompt(frame.interpolationPrompt, 'strict');
            }

            const result = await generateVideoClip({
              prompt: prompt,
              firstFrameBase64: frame.imageUrl!,
              lastFrameBase64: lastFrameBase64,
              duration: selectVideoDuration(clips[clipIndex].targetDuration)
            });

            clips[clipIndex].generatedVideoUrl = result.videoUrl;
            success = true;
            generatedCount++;

            // Add to processing queue and start processing if not already running
            processingQueue.push(clipIndex);
            processQueuedClips(); // Will return immediately if already processing

            break; // Success, exit retry loop
          } catch (e) {
            console.warn(`Video generation for shot ${clipIndex + 1} attempt ${attempt + 1} failed:`, e);
          }
        }

        // If all attempts failed
        if (!success && !videoStopRef.current) {
          clips[clipIndex].status = 'error';
          clips[clipIndex].error = "Generation failed after 3 attempts";
          generatedCount++;
        }

        setVideoClips([...clips]);
      }));
    }

    // Wait for all processing to complete
    while (isProcessing || processingQueue.length > 0) {
      if (videoStopRef.current) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 2: Stitch final video
    if (!videoStopRef.current) {
      await stitchFinalVideo(clips);
    } else {
      setVideoState(prev => ({
        ...prev,
        isGenerating: false,
        currentPhase: 'idle'
      }));
    }
  };

  // Phase 3: Stitch all clips together
  const stitchFinalVideo = async (clips: VideoClip[]) => {
    setVideoState(prev => ({
      ...prev,
      isStitching: true,
      currentPhase: 'stitching'
    }));

    const readyClips = clips.filter(c => c.status === 'ready' && c.processedVideoBlob);

    if (readyClips.length === 0) {
      setVideoState(prev => ({
        ...prev,
        isStitching: false,
        isGenerating: false,
        isProcessing: false,
        currentPhase: 'idle',
        progress: 0
      }));
      alert("No videos were successfully generated to stitch together.");
      return;
    }

    try {
      const blobs = readyClips.map(c => c.processedVideoBlob!);
      const finalBlob = await stitchVideos(blobs);
      const url = createVideoUrl(finalBlob);

      // Revoke old URL if exists
      if (finalVideoUrl) {
        revokeVideoUrl(finalVideoUrl);
      }

      setFinalVideoUrl(url);
      setFinalVideoBlob(finalBlob); // Save blob to parent state for persistence
      setVideoState(prev => ({
        ...prev,
        currentPhase: 'complete',
        progress: 100
      }));
    } catch (e) {
      console.error("Stitching failed:", e);
      alert(`Failed to stitch videos: ${(e as Error).message}`);
    } finally {
      setVideoState(prev => ({
        ...prev,
        isGenerating: false,
        isProcessing: false,
        isStitching: false
      }));
    }
  };

  // Phase 3: Stop video generation
  const handleVideoStop = () => {
    videoStopRef.current = true;
  };

  // Phase 3: Regenerate a single shot
  const regenerateSingleShot = async (clipIndex: number) => {
    const clips = [...videoClips];
    const frame = storyboard[clipIndex];
    const nextFrame = storyboard[clipIndex + 1];

    clips[clipIndex].status = 'generating';
    clips[clipIndex].error = undefined;
    setVideoClips([...clips]);

    const lastFrameBase64 = nextFrame?.imageUrl || generateBlackFrame(aspectRatio);
    let success = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let prompt = frame.interpolationPrompt;
        if (attempt === 1) {
          prompt = await sanitizePrompt(frame.interpolationPrompt, 'moderate');
        } else if (attempt === 2) {
          prompt = await sanitizePrompt(frame.interpolationPrompt, 'strict');
        }

        const result = await generateVideoClip({
          prompt: prompt,
          firstFrameBase64: frame.imageUrl!,
          lastFrameBase64: lastFrameBase64,
          duration: selectVideoDuration(clips[clipIndex].targetDuration)
        });

        clips[clipIndex].generatedVideoUrl = result.videoUrl;
        clips[clipIndex].status = 'processing';
        success = true;
        break;
      } catch (e) {
        console.warn(`Regenerate attempt ${attempt + 1} failed:`, e);
      }
    }

    if (!success) {
      clips[clipIndex].status = 'error';
      clips[clipIndex].error = "Regeneration failed after 3 attempts";
    }

    setVideoClips([...clips]);
  };

  // Phase 3: Reprocess a single shot (fetch + speed ramp)
  const reprocessSingleShot = async (clipIndex: number) => {
    const clips = [...videoClips];

    if (!clips[clipIndex].generatedVideoUrl) {
      alert("No generated video URL found. Please regenerate this shot first.");
      return;
    }

    clips[clipIndex].status = 'processing';
    clips[clipIndex].error = undefined;
    setVideoClips([...clips]);

    try {
      const videoBlob = await fetchVideoAsBlob(clips[clipIndex].generatedVideoUrl!);
      const processedBlob = await applySpeedRamp(videoBlob, clips[clipIndex].speedFactor);

      clips[clipIndex].processedVideoBlob = processedBlob;
      clips[clipIndex].status = 'ready';

      const previewUrl = createVideoUrl(processedBlob);
      setClipVideoUrls(prev => ({ ...prev, [clips[clipIndex].id]: previewUrl }));
    } catch (e) {
      console.error(`Reprocess failed for shot ${clipIndex + 1}:`, e);
      clips[clipIndex].status = 'error';
      clips[clipIndex].error = `Reprocess failed: ${(e as Error).message}`;
    }

    setVideoClips([...clips]);
  };

  // Phase 3: Cleanup URLs on unmount only
  // Store refs to track all created URLs for proper cleanup
  const urlsToCleanupRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Track URLs for cleanup
    Object.values(clipVideoUrls).forEach(url => urlsToCleanupRef.current.add(url));
    if (finalVideoUrl) urlsToCleanupRef.current.add(finalVideoUrl);
  }, [clipVideoUrls, finalVideoUrl]);

  useEffect(() => {
    // Cleanup all tracked URLs only on unmount
    return () => {
      urlsToCleanupRef.current.forEach(url => {
        try {
          revokeVideoUrl(url);
        } catch (e) {
          console.warn('Failed to revoke URL:', e);
        }
      });
    };
  }, []); // Empty deps - only cleanup on unmount

  // Debug helper: expose stitch function to console
  useEffect(() => {
    (window as any).__stitchFinalVideo = () => {
      console.log('🎬 Stitching', videoClips.length, 'clips...');
      console.log('Ready clips:', videoClips.filter(c => c.status === 'ready').length);
      stitchFinalVideo(videoClips);
    };

    (window as any).__videoClips = videoClips;

    return () => {
      delete (window as any).__stitchFinalVideo;
      delete (window as any).__videoClips;
    };
  }, [videoClips]);

  // Check if we can show Phase 3
  const canGenerateVideos = storyboard.length > 0 && storyboard.every(f => f.imageUrl);
  const isVideoGenerating = videoState.isGenerating || videoState.isProcessing || videoState.isStitching;

  return (
    <div className="mt-12 border-t border-slate-800 pt-12 animate-fade-in">
      <div className="flex items-center gap-3 mb-8">
        <Film className="w-8 h-8 text-pink-500" />
        <div>
            <h2 className="text-2xl font-bold text-slate-100">Video Planner (Phase 2)</h2>
            <p className="text-slate-400 text-sm">Turn your cuts into a storyboard with AI-generated frames.</p>
        </div>
      </div>

      {/* Step 1: Configuration */}
      {!plan && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
              <Clapperboard className="w-16 h-16 text-slate-700 mb-4" />
              <h3 className="text-xl font-semibold text-slate-200 mb-6">Start Your Production</h3>
              
              <div className="flex flex-col sm:flex-row gap-4 mb-6 w-full max-w-2xl">
                 <div className="flex-1">
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-2 text-left">Aspect Ratio</label>
                    <select 
                        value={aspectRatio} 
                        onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                        className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-4 py-3 focus:ring-2 focus:ring-pink-500 focus:outline-none"
                    >
                        <option value="16:9">16:9 (Landscape)</option>
                        <option value="9:16">9:16 (Portrait)</option>
                        <option value="4:3">4:3 (Retro)</option>
                        <option value="1:1">1:1 (Square)</option>
                        <option value="21:9">21:9 (Cinematic)</option>
                    </select>
                 </div>
                 <div className="flex-[2]">
                    <label className="block text-xs text-slate-500 uppercase font-bold mb-2 text-left">Visual Style</label>
                    <input 
                        type="text"
                        value={visualStyle}
                        onChange={(e) => setVisualStyle(e.target.value)}
                        placeholder="e.g. Cyberpunk, Watercolor, Realistic 4K..."
                        className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-4 py-3 focus:ring-2 focus:ring-pink-500 focus:outline-none"
                    />
                 </div>
              </div>

              <div className="mb-6 w-full max-w-2xl">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useHierarchy}
                    onChange={(e) => setUseHierarchy(e.target.checked)}
                    className="w-5 h-5 bg-slate-950 border-slate-700 rounded text-pink-500 focus:ring-2 focus:ring-pink-500"
                  />
                  <div className="flex-1">
                    <span className="text-slate-200 font-medium">Use Hierarchical Generation</span>
                    <p className="text-xs text-slate-500">Generate anchor frames first, then derive children for 3x faster generation</p>
                  </div>
                </label>
              </div>

              <button
                onClick={handleGeneratePlan}
                disabled={isPlanning}
                className="btn-primary px-8 py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-xl font-semibold shadow-lg shadow-pink-900/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPlanning ? <Loader2 className="animate-spin" /> : <LayoutTemplate className="w-5 h-5" />}
                {isPlanning ? "Dreaming up Narrative..." : "Draft Narrative Plan"}
              </button>
          </div>
      )}

      {/* Step 2 & 3: Execution */}
      {plan && (
          <div className="space-y-8">
              
              {/* Narrative, Characters & Locations */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Narrative */}
                  <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-semibold text-slate-200">Narrative Arc</h3>
                        <button
                          onClick={handleRegeneratePlan}
                          disabled={isPlanning || isGeneratingFrames}
                          className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Regenerate narrative"
                        >
                          <RefreshCw className={`w-4 h-4 text-pink-400 ${isPlanning ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                      <p className="text-slate-400 leading-relaxed text-sm">{plan.narrativeSummary}</p>

                      {/* Settings - Always Editable */}
                      <div className="mt-4 space-y-3 pb-4 border-b border-slate-800">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="flex-1">
                            <label className="block text-xs text-slate-500 uppercase font-bold mb-1">Aspect Ratio</label>
                            <select
                              value={aspectRatio}
                              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                            >
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                              <option value="4:3">4:3</option>
                              <option value="1:1">1:1</option>
                              <option value="21:9">21:9</option>
                            </select>
                          </div>
                          <div className="flex-[2]">
                            <label className="block text-xs text-slate-500 uppercase font-bold mb-1">Visual Style</label>
                            <input
                              type="text"
                              value={visualStyle}
                              onChange={(e) => setVisualStyle(e.target.value)}
                              placeholder="e.g. Cyberpunk, Watercolor..."
                              className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-pink-500 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Hierarchy Toggle */}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useHierarchy}
                            onChange={(e) => setUseHierarchy(e.target.checked)}
                            className="w-4 h-4 bg-slate-950 border-slate-700 rounded text-pink-500 focus:ring-2 focus:ring-pink-500"
                          />
                          <div className="flex-1">
                            <span className="text-slate-200 font-medium text-sm">Use Hierarchical Generation</span>
                            <p className="text-xs text-slate-500">Anchor frames + parallel generation (3x faster)</p>
                          </div>
                        </label>
                      </div>

                      <div className="mt-6 flex flex-wrap items-center gap-4">
                           {/* Generate / Stop Controls */}
                           {!isGeneratingFrames ? (
                               <button
                                    onClick={() => useHierarchy && hierarchyTree ? processFramesHierarchical() : processFrames(0)}
                                    className="px-6 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-semibold shadow-lg shadow-pink-900/20 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    <PlaySquare className="w-5 h-5" />
                                    {storyboard.some(f => f.imageUrl) ? "Regenerate All Frames" : "Generate Storyboard Frames"}
                               </button>
                           ) : (
                               <button 
                                    onClick={handleStop}
                                    className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold shadow-lg shadow-red-900/20 transition-all flex items-center gap-2"
                                >
                                    <StopCircle className="w-5 h-5" />
                                    Stop Generation
                               </button>
                           )}
                           
                           {canExport && (
                               <button 
                                    onClick={handleExportZip}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
                               >
                                   <Package className="w-5 h-5" />
                                   Export Package
                               </button>
                           )}

                           {isGeneratingFrames && (
                               <div className="flex-1 min-w-[200px]">
                                   <div className="flex justify-between text-xs text-slate-400 mb-1">
                                       <span>Rendering...</span>
                                       <span>{generationProgress.toFixed(0)}%</span>
                                   </div>
                                   <div className="w-full bg-slate-800 rounded-full h-2">
                                       <div className="bg-pink-500 h-2 rounded-full transition-all duration-300" style={{ width: `${generationProgress}%` }}></div>
                                   </div>
                               </div>
                           )}
                      </div>
                  </div>

                  {/* Right Column: Characters & Locations */}
                  <div className="space-y-6">
                      {/* Characters */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                          <div className="flex justify-between items-center mb-4">
                              <h3 className="text-lg font-semibold text-slate-200">Cast</h3>
                              <div className="flex items-center gap-2">
                                  {isGeneratingChars && <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />}
                                  <button
                                      onClick={() => generateCharacters(plan.characters)}
                                      disabled={isGeneratingChars}
                                      className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1"
                                      title="Regenerate all characters (3 at a time)"
                                  >
                                      <RefreshCw className="w-3 h-3 text-pink-400" />
                                      <span className="text-pink-400">All</span>
                                  </button>
                              </div>
                          </div>
                          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                              {plan.characters.map((char, charIndex) => (
                                  <div key={char.id} className="flex gap-3 items-start bg-slate-950 p-3 rounded-lg border border-slate-800">
                                      <div className="w-12 h-12 bg-slate-900 rounded-md flex-shrink-0 overflow-hidden border border-slate-700 relative">
                                          {char.imageUrl ? (
                                              <img src={`data:image/jpeg;base64,${char.imageUrl}`} alt={char.name} className="w-full h-full object-cover" />
                                          ) : (
                                              <div className="w-full h-full flex items-center justify-center text-slate-600">
                                                  <User className="w-6 h-6" />
                                              </div>
                                          )}
                                      </div>
                                      <div className="flex-1">
                                          <div className="text-sm font-medium text-slate-200">{char.name}</div>
                                          <div className="text-xs text-slate-500 line-clamp-2">{char.description}</div>
                                      </div>
                                      {/* Generate/Regenerate button - always visible */}
                                      <button
                                          onClick={() => regenerateCharacter(charIndex)}
                                          disabled={isGeneratingChars}
                                          className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                          title={char.imageUrl ? "Regenerate character" : "Generate character"}
                                      >
                                          <RefreshCw className="w-3 h-3 text-pink-400" />
                                      </button>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* Locations */}
                      {plan.locations && plan.locations.length > 0 && (
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-slate-200">Locations</h3>
                                <div className="flex items-center gap-2">
                                    {isGeneratingChars && <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />}
                                    <button
                                        onClick={() => generateLocations(plan.locations)}
                                        disabled={isGeneratingChars}
                                        className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center gap-1"
                                        title="Regenerate all locations (3 at a time)"
                                    >
                                        <RefreshCw className="w-3 h-3 text-pink-400" />
                                        <span className="text-pink-400">All</span>
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                                {plan.locations.map((loc, locIndex) => (
                                    <div key={loc.id} className="flex gap-3 items-start bg-slate-950 p-3 rounded-lg border border-slate-800">
                                        <div className="w-12 h-12 bg-slate-900 rounded-md flex-shrink-0 overflow-hidden border border-slate-700 relative">
                                            {loc.imageUrl ? (
                                                <img src={`data:image/jpeg;base64,${loc.imageUrl}`} alt={loc.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-600">
                                                    <MapPin className="w-6 h-6" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-slate-200">{loc.name}</div>
                                            <div className="text-xs text-slate-500 line-clamp-2">{loc.description}</div>
                                        </div>
                                        {/* Generate/Regenerate button - always visible */}
                                        <button
                                            onClick={() => regenerateLocation(locIndex)}
                                            disabled={isGeneratingChars}
                                            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                            title={loc.imageUrl ? "Regenerate location" : "Generate location"}
                                        >
                                            <RefreshCw className="w-3 h-3 text-pink-400" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                      )}
                  </div>
              </div>

              {/* Split View: Timeline (70%) + Details Panel (30%) */}
              <div className="flex gap-6">
                {/* Left: Timeline Grid (70%) */}
                <div className={`bg-slate-950 border border-slate-800 rounded-2xl p-6 overflow-hidden ${selectedFrameIndex !== null ? 'flex-[7]' : 'flex-1'}`}>
                  <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                    <Film className="w-5 h-5 text-slate-400" /> Storyboard Timeline
                    {hierarchyTree && (
                      <span className="text-xs text-slate-500 ml-2">
                        ({hierarchyTree.parentIndices.length} anchors, depth {hierarchyTree.maxDepth})
                      </span>
                    )}
                  </h3>

                  <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                    {storyboard.map((frame, index) => (
                      <React.Fragment key={frame.id}>
                        <FrameCard
                          frame={frame}
                          index={index}
                          hierarchyNode={hierarchyTree?.nodes[index]}
                          characters={plan.characters}
                          locations={plan.locations || []}
                          aspectRatio={aspectRatio}
                          isSelected={selectedFrameIndex === index}
                          isGenerating={isGeneratingFrames}
                          onSelect={() => setSelectedFrameIndex(selectedFrameIndex === index ? null : index)}
                          onRegenerate={() => useHierarchy && hierarchyTree ? handleRegenerateFrame(index) : processFrames(index)}
                        />

                        {/* Arrow to next */}
                        {index < storyboard.length - 1 && (
                          <div className="mx-2 text-slate-700 flex-shrink-0">
                            <ArrowRight className="w-6 h-6" />
                          </div>
                        )}
                      </React.Fragment>
                    ))}

                    {/* Fade Out Block */}
                    <div className="flex-shrink-0 flex items-center ml-2">
                      <ArrowRight className="w-6 h-6 text-slate-700 mr-4" />
                      <div className="w-40 bg-black rounded-xl border border-slate-800 flex flex-col items-center justify-center aspect-video opacity-50">
                        <span className="text-xs text-slate-500">Fade Out</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Details Panel (30%) */}
                {selectedFrameIndex !== null && (
                  <div className="flex-[3]">
                    <DetailsPanel
                      frame={storyboard[selectedFrameIndex]}
                      frameIndex={selectedFrameIndex}
                      hierarchyNode={hierarchyTree?.nodes[selectedFrameIndex]}
                      hierarchyTree={hierarchyTree}
                      allFrames={storyboard}
                      aspectRatio={aspectRatio}
                      onSelectFrame={setSelectedFrameIndex}
                      onRegenerate={handleRegenerateFrame}
                      isGenerating={isGeneratingFrames}
                    />
                  </div>
                )}
              </div>

              {/* Phase 3: Video Generation */}
              {canGenerateVideos && (
                <div className="bg-slate-950 border border-emerald-900/50 rounded-2xl p-6 mt-8">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                      <Video className="w-5 h-5 text-emerald-400" />
                      Video Generation (Phase 3)
                    </h3>

                    <div className="flex items-center gap-4">
                      {ffmpegLoading && (
                        <span className="text-xs text-slate-400 flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading FFmpeg...
                        </span>
                      )}

                      {videoState.currentPhase === 'idle' && (
                        <button
                          onClick={handleGenerateVideos}
                          disabled={ffmpegLoading}
                          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          <Video className="w-5 h-5" />
                          {videoClips.some(c => c.status === 'ready') ? 'Regenerate Videos' : 'Generate Videos'}
                        </button>
                      )}

                      {isVideoGenerating && (
                        <button
                          onClick={handleVideoStop}
                          className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold shadow-lg shadow-red-900/20 transition-all flex items-center gap-2"
                        >
                          <StopCircle className="w-5 h-5" />
                          Stop
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {isVideoGenerating && (
                    <div className="mb-6">
                      <div className="flex justify-between text-xs text-slate-400 mb-2">
                        <span>
                          {videoState.currentPhase === 'generating' && 'Generating video clips...'}
                          {videoState.currentPhase === 'processing' && 'Applying speed ramps...'}
                          {videoState.currentPhase === 'stitching' && 'Stitching final video...'}
                        </span>
                        <span>{videoState.progress.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${videoState.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Video Clips Grid */}
                  {videoClips.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-slate-400 mb-3">Shot Videos</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {videoClips.map((clip, index) => (
                          <div
                            key={clip.id}
                            className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden"
                          >
                            {/* Header */}
                            <div className="px-3 py-2 bg-slate-800/50 flex justify-between items-center">
                              <span className="text-xs font-mono text-emerald-400">Shot {index + 1}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                clip.status === 'ready' ? 'bg-emerald-900/50 text-emerald-300' :
                                clip.status === 'error' ? 'bg-red-900/50 text-red-300' :
                                clip.status === 'generating' ? 'bg-amber-900/50 text-amber-300' :
                                clip.status === 'processing' ? 'bg-blue-900/50 text-blue-300' :
                                'bg-slate-700 text-slate-400'
                              }`}>
                                {clip.status}
                              </span>
                            </div>

                            {/* Video Area */}
                            <div className={`w-full aspect-video bg-black relative flex items-center justify-center`}>
                              {clipVideoUrls[clip.id] ? (
                                <video
                                  src={clipVideoUrls[clip.id]}
                                  className="w-full h-full object-cover"
                                  controls
                                  muted
                                  playsInline
                                />
                              ) : clip.status === 'generating' || clip.status === 'processing' ? (
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                                  <span className="text-[10px] text-emerald-400 font-mono">
                                    {clip.status === 'generating' ? 'Generating...' : 'Processing...'}
                                  </span>
                                </div>
                              ) : clip.status === 'error' ? (
                                <div className="flex flex-col items-center gap-1 text-red-400 p-2 text-center">
                                  <AlertTriangle className="w-5 h-5" />
                                  <span className="text-[10px]">Failed</span>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600">Pending</span>
                              )}
                            </div>

                            {/* Footer */}
                            <div className="px-3 py-2 text-[10px] text-slate-500">
                              <div className="flex justify-between mb-2">
                                <span>Target: {clip.targetDuration.toFixed(1)}s</span>
                                <span>Speed: {clip.speedFactor.toFixed(2)}x</span>
                              </div>

                              {/* Action Buttons */}
                              {!isVideoGenerating && (
                                <div className="flex gap-1 mt-2">
                                  <button
                                    onClick={() => regenerateSingleShot(index)}
                                    className="flex-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[9px] font-medium transition-colors flex items-center justify-center gap-1"
                                    title="Regenerate this video"
                                  >
                                    <Video className="w-3 h-3" />
                                    Regen
                                  </button>
                                  <button
                                    onClick={() => reprocessSingleShot(index)}
                                    disabled={!clip.generatedVideoUrl}
                                    className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[9px] font-medium transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Reprocess speed ramp"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    Process
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Final Video Player */}
                  {finalVideoUrl && (
                    <div className="bg-slate-900 rounded-2xl border border-emerald-800/50 p-4">
                      <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                        <PlayCircle className="w-4 h-4" /> Final Music Video
                      </h4>
                      <video
                        src={finalVideoUrl}
                        className="w-full rounded-lg max-h-[500px]"
                        controls
                        playsInline
                      />
                      <div className="mt-3 flex gap-3">
                        <a
                          href={finalVideoUrl}
                          download="SonicCut_Final_Video.mp4"
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download Video
                        </a>
                        <button
                          onClick={() => stitchFinalVideo(videoClips)}
                          disabled={isVideoGenerating}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                          title="Re-stitch video with current clips"
                        >
                          <RefreshCw className="w-4 h-4" /> Re-stitch
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Empty State */}
                  {videoClips.length === 0 && videoState.currentPhase === 'idle' && (
                    <div className="text-center py-8 text-slate-500">
                      <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Click "Generate Videos" to create video clips from your storyboard frames.</p>
                      <p className="text-xs mt-2 text-slate-600">Videos will be generated using Kling AI, then speed-ramped and stitched together.</p>
                    </div>
                  )}
                </div>
              )}
          </div>
      )}

      {/* Feedback Dialog Modal */}
      {showFeedbackDialog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-2xl w-full p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-pink-400" />
                <h3 className="text-lg font-semibold text-slate-200">Provide Feedback (Optional)</h3>
              </div>
              <button
                onClick={() => setShowFeedbackDialog(false)}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <p className="text-sm text-slate-400 mb-4">
              Tell the AI what you'd like to change or improve in the narrative. Be specific about characters, scenes, themes, or style. Leave blank to regenerate without guidance.
            </p>

            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="e.g., 'Make it more cyberpunk themed', 'Add a car chase scene', 'Less abstract, more literal', 'Include a sunset in the final scene'..."
              className="w-full h-32 bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-4 py-3 focus:ring-2 focus:ring-pink-500 focus:outline-none resize-none"
            />

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => performRegeneratePlan(feedbackText.trim() || undefined)}
                disabled={isPlanning}
                className="flex-1 px-6 py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-semibold shadow-lg shadow-pink-900/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPlanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isPlanning ? "Regenerating..." : "Regenerate Narrative"}
              </button>
              <button
                onClick={() => setShowFeedbackDialog(false)}
                disabled={isPlanning}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg font-semibold transition-all disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default VideoPlanner;