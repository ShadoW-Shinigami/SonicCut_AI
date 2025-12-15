import React, { useState, useRef, useEffect } from 'react';
import { AudioAnalysis, Marker, AspectRatio, VideoPlan, StoryboardFrame, Character, VideoClip, VideoGenerationState } from '../types';
import { generateVideoNarrative, generateCharacterSheet, generateFirstFrame, generateNextFrame, sanitizePrompt } from '../services/geminiService';
import { generateVideoClip, selectVideoDuration, calculateSpeedFactor, fetchVideoAsBlob } from '../services/klingService';
import { generateBlackFrame, applySpeedRamp, stitchVideos, getFFmpeg, isFFmpegLoaded, createVideoUrl, revokeVideoUrl } from '../services/videoProcessingService';
import { Clapperboard, Film, User, Loader2, PlaySquare, ArrowRight, LayoutTemplate, Package, StopCircle, RefreshCw, PlayCircle, AlertTriangle, Video, Download, Pause, Play } from 'lucide-react';
import JSZip from 'jszip';

interface VideoPlannerProps {
  analysis: AudioAnalysis;
  markers: Marker[];
  audioDuration: number;
}

const VideoPlanner: React.FC<VideoPlannerProps> = ({ analysis, markers, audioDuration }) => {
  // State
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [visualStyle, setVisualStyle] = useState<string>("Cinematic, High Contrast, Neo-Noir");
  const [plan, setPlan] = useState<VideoPlan | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardFrame[]>([]);

  // Loading States
  const [isPlanning, setIsPlanning] = useState(false);
  const [isGeneratingChars, setIsGeneratingChars] = useState(false);
  const [isGeneratingFrames, setIsGeneratingFrames] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Stop Control
  const stopRef = useRef<boolean>(false);

  // Phase 3: Video Generation State
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
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

  // Step 1: Generate Plan (Text & Characters)
  const handleGeneratePlan = async () => {
    if (markers.length === 0) {
        alert("Please generate cuts first!");
        return;
    }
    setIsPlanning(true);
    try {
      const videoPlan = await generateVideoNarrative(analysis, markers.length, aspectRatio);
      
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

      // Trigger character generation immediately after plan is ready
      generateCharacters(videoPlan.characters);

    } catch (e) {
      console.error(e);
      alert("Failed to generate video plan.");
    } finally {
      setIsPlanning(false);
    }
  };

  const generateCharacters = async (chars: Character[]) => {
    setIsGeneratingChars(true);
    const updatedChars = [...chars];
    
    for (let i = 0; i < updatedChars.length; i++) {
        try {
            const base64 = await generateCharacterSheet(updatedChars[i], visualStyle);
            updatedChars[i].imageUrl = base64;
            // Update state incrementally to show progress
            setPlan(prev => prev ? { ...prev, characters: [...updatedChars] } : null);
        } catch (e) {
            console.error(`Failed to generate char ${updatedChars[i].name}`, e);
        }
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

        // Resolve active characters for this frame based on plan
        const activeChars = plan.characters.filter(c => frames[i].characterIds?.includes(c.id));

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
                    imageBase64 = await generateNextFrame(prevImage, description, aspectRatio, activeChars, visualStyle);
                 } else {
                    imageBase64 = await generateFirstFrame(description, aspectRatio, activeChars, visualStyle);
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
    }

    setIsGeneratingFrames(false);
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
        folder.file("First_Frame.png", firstFrameData, {base64: true});

        // Last Frame (Next frame's start, or black if end)
        const nextFrame = storyboard[index + 1];
        const lastFrameData = nextFrame?.imageUrl || blackFrame;
        folder.file("Last_Frame.png", lastFrameData, {base64: true});

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

  // Phase 3: Generate all videos
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

    // Step 1: Generate videos from Kling API
    for (let i = 0; i < clips.length; i++) {
      if (videoStopRef.current) break;

      const frame = storyboard[i];
      const nextFrame = storyboard[i + 1];

      clips[i].status = 'generating';
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
            duration: selectVideoDuration(clips[i].targetDuration)
          });

          clips[i].generatedVideoUrl = result.videoUrl;
          clips[i].status = 'processing';
          success = true;
          break; // Success, exit retry loop
        } catch (e) {
          console.warn(`Video generation for shot ${i + 1} attempt ${attempt + 1} failed:`, e);
        }
      }

      // If all attempts failed
      if (!success && !videoStopRef.current) {
        clips[i].status = 'error';
        clips[i].error = "Generation failed after 3 attempts";
      }

      setVideoClips([...clips]);
      setVideoState(prev => ({
        ...prev,
        progress: ((i + 1) / clips.length) * 33
      }));
    }

    // Step 2: Process speed ramping
    if (!videoStopRef.current) {
      await processSpeedRamping(clips);
    } else {
      setVideoState(prev => ({
        ...prev,
        isGenerating: false,
        currentPhase: 'idle'
      }));
    }
  };

  // Phase 3: Apply speed ramping to all clips
  const processSpeedRamping = async (clips: VideoClip[]) => {
    setVideoState(prev => ({
      ...prev,
      isProcessing: true,
      currentPhase: 'processing'
    }));

    for (let i = 0; i < clips.length; i++) {
      if (videoStopRef.current) break;
      if (clips[i].status !== 'processing' || !clips[i].generatedVideoUrl) continue;

      try {
        // Fetch video as blob
        const videoBlob = await fetchVideoAsBlob(clips[i].generatedVideoUrl!);

        // Apply speed ramp
        const processedBlob = await applySpeedRamp(
          videoBlob,
          clips[i].speedFactor
        );

        clips[i].processedVideoBlob = processedBlob;
        clips[i].status = 'ready';

        // Create URL for preview
        const previewUrl = createVideoUrl(processedBlob);
        setClipVideoUrls(prev => ({ ...prev, [clips[i].id]: previewUrl }));
      } catch (e) {
        console.error(`Speed processing failed for shot ${i + 1}:`, e);
        clips[i].status = 'error';
        clips[i].error = `Speed processing failed: ${(e as Error).message}`;
      }

      setVideoClips([...clips]);
      setVideoState(prev => ({
        ...prev,
        progress: 33 + ((i + 1) / clips.length) * 33
      }));
    }

    // Step 3: Stitch final video
    if (!videoStopRef.current) {
      await stitchFinalVideo(clips);
    } else {
      setVideoState(prev => ({
        ...prev,
        isProcessing: false,
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
              
              {/* Narrative & Characters */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Narrative */}
                  <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                      <h3 className="text-lg font-semibold text-slate-200 mb-2">Narrative Arc</h3>
                      <p className="text-slate-400 leading-relaxed text-sm">{plan.narrativeSummary}</p>
                      
                      <div className="mt-6 flex flex-wrap items-center gap-4">
                           {/* Generate / Stop Controls */}
                           {!isGeneratingFrames ? (
                               <button 
                                    onClick={() => processFrames(0)}
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

                  {/* Characters */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-semibold text-slate-200">Cast</h3>
                          {isGeneratingChars && <Loader2 className="w-4 h-4 text-pink-400 animate-spin" />}
                      </div>
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                          {plan.characters.map((char) => (
                              <div key={char.id} className="flex gap-3 items-start bg-slate-950 p-3 rounded-lg border border-slate-800">
                                  <div className="w-12 h-12 bg-slate-900 rounded-md flex-shrink-0 overflow-hidden border border-slate-700">
                                      {char.imageUrl ? (
                                          <img src={`data:image/png;base64,${char.imageUrl}`} alt={char.name} className="w-full h-full object-cover" />
                                      ) : (
                                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                                              <User className="w-6 h-6" />
                                          </div>
                                      )}
                                  </div>
                                  <div>
                                      <div className="text-sm font-medium text-slate-200">{char.name}</div>
                                      <div className="text-xs text-slate-500 line-clamp-2">{char.description}</div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>

              {/* Timeline / Storyboard Strip */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 overflow-hidden">
                  <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                      <Film className="w-5 h-5 text-slate-400" /> Storyboard Timeline
                  </h3>
                  
                  <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                      {storyboard.map((frame, index) => (
                          <div key={frame.id} className="flex-shrink-0 flex items-center">
                              {/* The Frame Card */}
                              <div className="w-64 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col relative group/card">
                                   
                                   {/* Header */}
                                   <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                                       <span className="text-xs font-mono text-pink-400">Shot {index + 1}</span>
                                       <span className="text-xs font-mono text-slate-500">{frame.startTime.toFixed(2)}s</span>
                                   </div>
                                   
                                   {/* Image Area */}
                                   <div className={`w-full aspect-video bg-black relative flex items-center justify-center ${aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : ''}`}>
                                       {/* Active Characters Tag - Visual Verification */}
                                       <div className="absolute top-2 left-2 flex gap-1 flex-wrap z-10 pointer-events-none">
                                            {frame.characterIds?.map(cid => {
                                                const char = plan.characters.find(c => c.id === cid);
                                                return char ? (
                                                    <span key={cid} className="text-[8px] bg-black/60 text-white px-2 py-0.5 rounded backdrop-blur-md border border-white/10">
                                                        {char.name}
                                                    </span>
                                                ) : null;
                                            })}
                                       </div>

                                       {frame.imageUrl ? (
                                           <img src={`data:image/png;base64,${frame.imageUrl}`} alt="Scene" className="w-full h-full object-cover" />
                                       ) : frame.isGenerating ? (
                                           <div className="flex flex-col items-center gap-2">
                                               <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
                                               <span className="text-xs text-pink-500 font-mono">Generating...</span>
                                           </div>
                                       ) : frame.error ? (
                                            <div className="flex flex-col items-center gap-2 text-red-400 p-2 text-center">
                                                <AlertTriangle className="w-8 h-8" />
                                                <span className="text-xs font-bold">Failed</span>
                                                <span className="text-[10px] opacity-70">After 3 attempts</span>
                                            </div>
                                       ) : (
                                           <span className="text-xs text-slate-600">Waiting to render</span>
                                       )}
                                       
                                       {/* Hover Desc */}
                                       <div className="absolute inset-0 bg-black/80 p-4 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col items-center justify-center text-center">
                                           <p className="text-xs text-slate-300 mb-2">{frame.description}</p>
                                           
                                           {/* Action Buttons on Hover */}
                                           <div className="flex gap-2 mt-2">
                                              <button 
                                                  onClick={() => processFrames(index)}
                                                  disabled={isGeneratingFrames}
                                                  title="Regenerate this frame (and continue)"
                                                  className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded-full text-white disabled:opacity-50"
                                              >
                                                  <RefreshCw className="w-4 h-4" />
                                              </button>
                                              <button
                                                  onClick={() => processFrames(index)}
                                                  disabled={isGeneratingFrames}
                                                  title="Continue generating from here"
                                                  className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded-full text-white disabled:opacity-50"
                                              >
                                                  <PlayCircle className="w-4 h-4" />
                                              </button>
                                           </div>
                                       </div>
                                   </div>

                                   {/* Footer */}
                                   <div className="p-3 bg-slate-900 relative">
                                       <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Transition Prompt</div>
                                       <p className="text-xs text-indigo-300 line-clamp-3">{frame.interpolationPrompt}</p>
                                       
                                       {/* Manual Retry Button if Error */}
                                       {frame.error && !isGeneratingFrames && (
                                            <button 
                                                onClick={() => processFrames(index)}
                                                className="absolute inset-0 bg-slate-900/90 flex items-center justify-center gap-2 text-red-400 hover:text-red-300 font-bold text-xs transition-colors"
                                            >
                                                <RefreshCw className="w-3 h-3" /> Retry Frame
                                            </button>
                                       )}
                                   </div>
                              </div>

                              {/* Arrow to next */}
                              {index < storyboard.length - 1 && (
                                  <div className="mx-2 text-slate-700">
                                      <ArrowRight className="w-6 h-6" />
                                  </div>
                              )}
                          </div>
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
                            <div className="px-3 py-2 text-[10px] text-slate-500 flex justify-between">
                              <span>Target: {clip.targetDuration.toFixed(1)}s</span>
                              <span>Speed: {clip.speedFactor.toFixed(2)}x</span>
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

    </div>
  );
};

export default VideoPlanner;